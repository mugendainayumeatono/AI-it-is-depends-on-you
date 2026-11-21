import { Redis } from '@upstash/redis'
import prisma from '@/lib/prisma'
import {
  applyMutation,
  buildMediaUrl,
  createDefaultSnapshot,
  isInlineDataUrl,
  isMediaProxyUrl,
  parseNonNegativeInt,
} from '@/lib/gameEngine'
import {
  getUpstashConfig,
  scheduleAfter,
  UPSTASH_PUBSUB_CHANNEL,
} from '@/lib/realtime'
import type {
  GameMutation,
  GameState,
  GameStatus,
  Member,
  NormalizedGameSnapshot,
  RealtimeEvent,
  SnapshotEvent,
  StateDelta,
  TeamSummary,
} from '@/types'

export type StoreKind = 'upstash' | 'prisma' | 'memory'

export type StoreMutationResult =
  | {
      ok: true
      snapshot: NormalizedGameSnapshot
      event: RealtimeEvent
      delta?: StateDelta
      alreadyApplied?: boolean
      pickedMemberId?: string
      publishedToRedis?: boolean
    }
  | {
      ok: false
      status: 400 | 409
      error: string
      code: string
      snapshot: NormalizedGameSnapshot
    }

export interface StateStore {
  getSnapshot(): Promise<NormalizedGameSnapshot>
  mutate(mutation: GameMutation, opts?: { nowMs?: number }): Promise<StoreMutationResult>
  getMedia(memberId: string, field: 'avatar' | 'background'): Promise<string | null>
  getEventsSince(sinceVersion: number): Promise<RealtimeEvent[] | null>
  getStoreKind(): StoreKind
}

export const REDIS_STATE_KEY = 'banpick:state'
export const REDIS_EVENTS_KEY = 'banpick:events'
export const REDIS_IDEMP_PREFIX = 'banpick:idemp:'
export const REDIS_MEDIA_PREFIX = 'banpick:media:'

const INLINE_MEDIA_SENTINEL = '__INLINE_MEDIA__'
const MAX_RING_EVENTS = 200
const IDEMPOTENCY_TTL_MS = 120_000
const IDEMPOTENCY_TTL_SEC = 120

const MEMBER_METADATA_SELECT = {
  id: true,
  name: true,
  info: true,
  avatarUrl: true,
  backgroundUrl: true,
  mediaVersion: true,
  teamId: true,
  isBanned: true,
  pickedAt: true,
  order: true,
} as const

function generateId(): string {
  if (typeof globalThis.crypto !== 'undefined' && typeof globalThis.crypto.randomUUID === 'function') {
    return globalThis.crypto.randomUUID()
  }
  return `id_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`
}

function isPrismaConfigured(): boolean {
  return Boolean(process.env.POSTGRES_PRISMA_URL)
}

function makeSnapshotEvent(
  snapshot: NormalizedGameSnapshot,
  nowMs: number,
  mutationId?: string | null,
  clientId?: string | null
): SnapshotEvent {
  return {
    kind: 'snapshot',
    version: snapshot.version,
    serverTime: nowMs,
    mutationId: mutationId ?? snapshot.lastMutationId ?? null,
    clientId: clientId ?? null,
    snapshot,
  }
}

function cloneSnapshot(snapshot: NormalizedGameSnapshot, nowMs?: number): NormalizedGameSnapshot {
  return {
    version: snapshot.version,
    serverTime: nowMs ?? snapshot.serverTime,
    lastMutationId: snapshot.lastMutationId ?? null,
    gameState: { ...snapshot.gameState },
    teams: snapshot.teams.map((t) => ({ ...t })),
    members: snapshot.members.map((m) => ({ ...m })),
  }
}

function normalizeRawSnapshot(raw: unknown): NormalizedGameSnapshot {
  const obj = (raw ?? {}) as Record<string, unknown>
  const gs = (obj.gameState ?? {}) as Record<string, unknown>
  const version = typeof obj.version === 'number' ? obj.version : typeof gs.version === 'number' ? gs.version : 1
  const serverTime = typeof obj.serverTime === 'number' ? obj.serverTime : Date.now()
  const teams = Array.isArray(obj.teams) ? (obj.teams as TeamSummary[]) : []
  const members = Array.isArray(obj.members) ? (obj.members as Member[]) : []

  const gameState: GameState = {
    id: typeof gs.id === 'string' ? gs.id : 'singleton',
    version,
    currentTeamIndex: typeof gs.currentTeamIndex === 'number' ? gs.currentTeamIndex : 0,
    turnStartTime: typeof gs.turnStartTime === 'string' ? gs.turnStartTime : null,
    status: (gs.status === 'PICKING' || gs.status === 'COMPLETED' ? gs.status : 'CONFIGURING') as GameStatus,
    turnDuration: typeof gs.turnDuration === 'number' ? gs.turnDuration : 30,
    totalReserveTime: typeof gs.totalReserveTime === 'number' ? gs.totalReserveTime : 120,
    teamCount: typeof gs.teamCount === 'number' ? gs.teamCount : 2,
  }

  return {
    version,
    serverTime,
    lastMutationId: typeof obj.lastMutationId === 'string' ? obj.lastMutationId : null,
    gameState,
    teams,
    members,
  }
}

function normalizeRealtimeEvent(raw: unknown): RealtimeEvent {
  const obj = (raw ?? {}) as Record<string, unknown>
  if (obj.kind === 'snapshot') {
    return {
      kind: 'snapshot',
      version: Number(obj.version ?? 1),
      serverTime: Number(obj.serverTime ?? Date.now()),
      mutationId: typeof obj.mutationId === 'string' ? obj.mutationId : null,
      clientId: typeof obj.clientId === 'string' ? obj.clientId : null,
      snapshot: normalizeRawSnapshot(obj.snapshot),
    }
  }
  if (obj.kind === 'delta') {
    return obj as unknown as StateDelta
  }
  return {
    kind: 'invalidate',
    version: Number(obj.version ?? 0),
    serverTime: Number(obj.serverTime ?? Date.now()),
    mutationId: typeof obj.mutationId === 'string' ? obj.mutationId : null,
  }
}

function parseJsonSafe<T>(value: unknown): T | null {
  if (value === null || value === undefined) return null
  if (typeof value === 'string') {
    try {
      return JSON.parse(value) as T
    } catch {
      return null
    }
  }
  if (typeof value === 'object') {
    return value as T
  }
  return null
}

function extractContiguousEvents(
  events: RealtimeEvent[],
  sinceVersion: number,
  currentVersion: number
): RealtimeEvent[] | null {
  if (sinceVersion >= currentVersion) return []
  if (events.length === 0) return null

  const filtered = events
    .filter((e) => e.version > sinceVersion)
    .sort((a, b) => a.version - b.version)

  if (filtered.length === 0) return null

  // Verify strict contiguity from sinceVersion + 1 up to currentVersion
  let expected = sinceVersion + 1
  const contiguous: RealtimeEvent[] = []
  for (const ev of filtered) {
    if (ev.version < expected) continue
    if (ev.version > expected) {
      return null
    }
    contiguous.push(ev)
    expected++
  }

  if (contiguous.length === 0 || expected - 1 < currentVersion) {
    return null
  }

  return contiguous
}

// ---------------------------------------------------------------------------
// Shared Ring Buffer & Idempotency Helpers (on globalThis)
// ---------------------------------------------------------------------------

interface IdempotencyEntry {
  result: StoreMutationResult
  expiresAt: number
}

interface MemoryStoreData {
  snapshot: NormalizedGameSnapshot
  media: Map<string, string>
  idempotency: Map<string, IdempotencyEntry>
  events: RealtimeEvent[]
}

interface PrismaCacheData {
  idempotency: Map<string, IdempotencyEntry>
  events: RealtimeEvent[]
}

declare global {
  var __banpickMemoryStore: MemoryStoreData | undefined
  var __banpickPrismaCache: PrismaCacheData | undefined
  var __banpickStateStoreOverride: StateStore | null | undefined
  var __banpickStateStoreCached: { key: string; store: StateStore } | undefined
  var __banpickLegacyMediaBackfilled: boolean | undefined
  var __banpickLegacyMediaBackfillPromise: Promise<void> | undefined
}

function getMemoryStoreData(): MemoryStoreData {
  if (!globalThis.__banpickMemoryStore) {
    globalThis.__banpickMemoryStore = {
      snapshot: createDefaultSnapshot(),
      media: new Map<string, string>(),
      idempotency: new Map<string, IdempotencyEntry>(),
      events: [],
    }
  }
  return globalThis.__banpickMemoryStore
}

function getPrismaCacheData(): PrismaCacheData {
  if (!globalThis.__banpickPrismaCache) {
    globalThis.__banpickPrismaCache = {
      idempotency: new Map<string, IdempotencyEntry>(),
      events: [],
    }
  }
  return globalThis.__banpickPrismaCache
}

function pushRingEvent(events: RealtimeEvent[], event: RealtimeEvent): void {
  events.push(event)
  if (events.length > MAX_RING_EVENTS) {
    events.splice(0, events.length - MAX_RING_EVENTS)
  }
}

function getCachedIdempotency(
  map: Map<string, IdempotencyEntry>,
  mutationId: string,
  nowMs: number
): StoreMutationResult | null {
  const entry = map.get(mutationId)
  if (!entry) return null
  if (entry.expiresAt <= nowMs) {
    map.delete(mutationId)
    return null
  }
  if (entry.result.ok) {
    return { ...entry.result, alreadyApplied: true }
  }
  return entry.result
}

function setCachedIdempotency(
  map: Map<string, IdempotencyEntry>,
  mutationId: string,
  result: StoreMutationResult,
  nowMs: number
): void {
  if (!mutationId) return
  map.set(mutationId, { result, expiresAt: nowMs + IDEMPOTENCY_TTL_MS })
  if (map.size > 500) {
    for (const [k, v] of map.entries()) {
      if (v.expiresAt <= nowMs) {
        map.delete(k)
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Prisma Mapping & Write-Behind Helpers
// ---------------------------------------------------------------------------

interface PrismaMemberMetaRow {
  id: string
  name: string
  info: string | null
  avatarUrl?: string | null
  backgroundUrl?: string | null
  avatar?: string | null
  background?: string | null
  mediaVersion?: number | null
  teamId: string | null
  isBanned: boolean
  pickedAt: Date | string | null
  order?: number | null
}

function mapPrismaMemberRow(row: PrismaMemberMetaRow): Member {
  const mv = row.mediaVersion ?? 0
  const rawAvatar = row.avatarUrl !== undefined ? row.avatarUrl : row.avatar ?? null
  const rawBg = row.backgroundUrl !== undefined ? row.backgroundUrl : row.background ?? null
  const avatar = rawAvatar && isInlineDataUrl(rawAvatar) ? buildMediaUrl(row.id, 'avatar', mv) : rawAvatar
  const background = rawBg && isInlineDataUrl(rawBg) ? buildMediaUrl(row.id, 'background', mv) : rawBg
  const pickedAt = row.pickedAt
    ? row.pickedAt instanceof Date
      ? row.pickedAt.toISOString()
      : String(row.pickedAt)
    : null

  return {
    id: row.id,
    name: row.name,
    info: row.info ?? null,
    avatar: avatar ?? null,
    background: background ?? null,
    teamId: row.teamId ?? null,
    isBanned: Boolean(row.isBanned),
    pickedAt,
    order: row.order ?? 0,
    mediaVersion: mv,
  }
}

/**
 * One-time-per-process, non-fatal cold-start SQL backfill for pre-existing
 * Neon Member rows that had `avatar`/`background` populated before `avatarUrl`,
 * `backgroundUrl`, and `mediaVersion` columns were added via `prisma db push`.
 */
async function ensureLegacyMediaUrlsBackfilled(): Promise<void> {
  if (globalThis.__banpickLegacyMediaBackfilled) return
  if (typeof prisma.$executeRaw !== 'function') {
    globalThis.__banpickLegacyMediaBackfilled = true
    return
  }

  if (!globalThis.__banpickLegacyMediaBackfillPromise) {
    globalThis.__banpickLegacyMediaBackfillPromise = (async () => {
      try {
        await prisma.$executeRaw`
          UPDATE "Member"
          SET
            "avatarUrl" = CASE
              WHEN "avatarUrl" IS NULL AND "avatar" IS NOT NULL AND "avatar" <> '' THEN
                CASE
                  WHEN "avatar" LIKE 'data:%' THEN '/api/members/' || "id" || '/media?field=avatar&v=' || GREATEST("mediaVersion", 1)::text
                  ELSE "avatar"
                END
              ELSE "avatarUrl"
            END,
            "backgroundUrl" = CASE
              WHEN "backgroundUrl" IS NULL AND "background" IS NOT NULL AND "background" <> '' THEN
                CASE
                  WHEN "background" LIKE 'data:%' THEN '/api/members/' || "id" || '/media?field=background&v=' || GREATEST("mediaVersion", 1)::text
                  ELSE "background"
                END
              ELSE "backgroundUrl"
            END,
            "mediaVersion" = GREATEST("mediaVersion", 1)
          WHERE
            ("avatar" IS NOT NULL AND "avatar" <> '' AND "avatarUrl" IS NULL)
            OR ("background" IS NOT NULL AND "background" <> '' AND "backgroundUrl" IS NULL)
        `
      } catch (error) {
        console.error('[banpick] non-fatal legacy media URL backfill error:', error)
      } finally {
        globalThis.__banpickLegacyMediaBackfilled = true
        globalThis.__banpickLegacyMediaBackfillPromise = undefined
      }
    })()
  }

  await globalThis.__banpickLegacyMediaBackfillPromise
}

async function loadSnapshotFromPrismaClient(
  client: Pick<typeof prisma, 'gameState' | 'team' | 'member'>,
  nowMs: number = Date.now()
): Promise<NormalizedGameSnapshot> {
  const [rawGameState, rawTeams, rawMembers] = await Promise.all([
    client.gameState.findUnique({ where: { id: 'singleton' } }),
    client.team.findMany({ orderBy: { order: 'asc' } }),
    client.member.findMany({
      select: MEMBER_METADATA_SELECT,
      orderBy: { name: 'asc' },
    }),
  ])

  let gs = rawGameState
  if (!gs) {
    gs = await client.gameState.upsert({
      where: { id: 'singleton' },
      create: {
        id: 'singleton',
        version: 1,
        status: 'CONFIGURING',
        currentTeamIndex: 0,
        turnStartTime: new Date(nowMs),
        turnDuration: 30,
        totalReserveTime: 120,
        teamCount: 2,
      },
      update: {},
    })
  }

  const version = typeof gs.version === 'number' ? gs.version : 1
  const status = (gs.status === 'PICKING' || gs.status === 'COMPLETED' ? gs.status : 'CONFIGURING') as GameStatus
  const turnStartIso =
    status === 'CONFIGURING'
      ? null
      : gs.turnStartTime instanceof Date
        ? gs.turnStartTime.toISOString()
        : gs.turnStartTime
          ? String(gs.turnStartTime)
          : new Date(nowMs).toISOString()

  const teams: TeamSummary[] = (rawTeams ?? []).map((t) => ({
    id: t.id,
    name: t.name,
    order: t.order,
    reserveTime: t.reserveTime,
  }))

  const members: Member[] = (rawMembers ?? []).map((m) => mapPrismaMemberRow(m as PrismaMemberMetaRow))

  return {
    version,
    serverTime: nowMs,
    lastMutationId: null,
    gameState: {
      id: gs.id || 'singleton',
      version,
      currentTeamIndex: gs.currentTeamIndex ?? 0,
      turnStartTime: turnStartIso,
      status,
      turnDuration: gs.turnDuration ?? 30,
      totalReserveTime: gs.totalReserveTime ?? 120,
      teamCount: gs.teamCount ?? 2,
    },
    teams,
    members,
  }
}

interface MediaUploadBlobs {
  memberId: string
  avatarBlob?: string | null
  avatarTouched?: boolean
  backgroundBlob?: string | null
  backgroundTouched?: boolean
}

async function persistSnapshotToPrisma(
  snapshot: NormalizedGameSnapshot,
  mutation: GameMutation,
  delta?: StateDelta,
  mediaUploads?: MediaUploadBlobs
): Promise<void> {
  const turnStartDate = snapshot.gameState.turnStartTime
    ? new Date(snapshot.gameState.turnStartTime)
    : new Date(snapshot.serverTime)

  await prisma.$transaction(async (tx) => {
    const existing = await tx.gameState.findUnique({
      where: { id: 'singleton' },
      select: { version: true },
    })

    // Never allow a delayed write-behind to clobber a newer version in Postgres,
    // EXCEPT still durably persist newly uploaded media blobs guarded by mediaVersion
    // so an out-of-order later after() reconciliation never causes media data loss.
    if (existing && existing.version >= snapshot.version) {
      if (mediaUploads && (mediaUploads.avatarTouched || mediaUploads.backgroundTouched)) {
        const uploadedMember = snapshot.members.find((m) => m.id === mediaUploads.memberId)
        if (uploadedMember) {
          const mediaPatch: {
            avatar?: string | null
            background?: string | null
          } = {}
          if (mediaUploads.avatarTouched) {
            mediaPatch.avatar = mediaUploads.avatarBlob ?? null
          }
          if (mediaUploads.backgroundTouched) {
            mediaPatch.background = mediaUploads.backgroundBlob ?? null
          }
          await tx.member.updateMany({
            where: {
              id: mediaUploads.memberId,
              mediaVersion: { lte: uploadedMember.mediaVersion ?? 0 },
            },
            data: mediaPatch,
          })
        }
      }
      return
    }

    const isContiguous = existing !== null && existing.version === snapshot.version - 1

    // Fast path 1: Contiguous hot delta (START / PICK / AUTO_PICK)
    if (isContiguous && delta) {
      await tx.gameState.update({
        where: { id: 'singleton' },
        data: {
          version: snapshot.version,
          currentTeamIndex: snapshot.gameState.currentTeamIndex,
          turnStartTime: turnStartDate,
          status: snapshot.gameState.status,
        },
      })
      if (delta.teamPatch) {
        await tx.team.update({
          where: { id: delta.teamPatch.id },
          data: { reserveTime: delta.teamPatch.reserveTime },
        })
      }
      if (delta.memberPatch) {
        await tx.member.update({
          where: { id: delta.memberPatch.id },
          data: {
            teamId: delta.memberPatch.teamId,
            pickedAt: delta.memberPatch.pickedAt ? new Date(delta.memberPatch.pickedAt) : null,
          },
        })
      }
      return
    }

    // Fast path 2: Contiguous MEMBER_ADD / MEMBER_UPDATE / MEMBER_DELETE
    if (isContiguous && mutation.type === 'MEMBER_ADD' && mediaUploads) {
      const created = snapshot.members.find((m) => m.id === mediaUploads.memberId)
      if (created) {
        await tx.gameState.update({
          where: { id: 'singleton' },
          data: { version: snapshot.version },
        })
        await tx.member.upsert({
          where: { id: created.id },
          create: {
            id: created.id,
            name: created.name,
            info: created.info,
            avatar: mediaUploads.avatarBlob ?? created.avatar,
            background: mediaUploads.backgroundBlob ?? created.background,
            avatarUrl: created.avatar,
            backgroundUrl: created.background,
            mediaVersion: created.mediaVersion ?? 0,
            teamId: null,
            isBanned: false,
            pickedAt: null,
            order: created.order ?? 0,
          },
          update: {
            name: created.name,
            info: created.info,
            ...(mediaUploads.avatarTouched ? { avatar: mediaUploads.avatarBlob ?? null } : {}),
            ...(mediaUploads.backgroundTouched ? { background: mediaUploads.backgroundBlob ?? null } : {}),
            avatarUrl: created.avatar,
            backgroundUrl: created.background,
            mediaVersion: created.mediaVersion ?? 0,
          },
        })
        return
      }
    }

    if (isContiguous && mutation.type === 'MEMBER_UPDATE' && mediaUploads) {
      const updated = snapshot.members.find((m) => m.id === mutation.id)
      if (updated) {
        await tx.gameState.update({
          where: { id: 'singleton' },
          data: { version: snapshot.version },
        })
        await tx.member.update({
          where: { id: updated.id },
          data: {
            name: updated.name,
            info: updated.info,
            avatarUrl: updated.avatar,
            backgroundUrl: updated.background,
            mediaVersion: updated.mediaVersion ?? 0,
            ...(mediaUploads.avatarTouched ? { avatar: mediaUploads.avatarBlob ?? null } : {}),
            ...(mediaUploads.backgroundTouched ? { background: mediaUploads.backgroundBlob ?? null } : {}),
          },
        })
        return
      }
    }

    if (isContiguous && mutation.type === 'MEMBER_DELETE') {
      await tx.gameState.update({
        where: { id: 'singleton' },
        data: { version: snapshot.version },
      })
      await tx.member.deleteMany({ where: { id: mutation.id } })
      return
    }

    // Full snapshot reconciliation (CONFIG / RANDOMIZE / catch-up after skipped background write)
    await tx.gameState.upsert({
      where: { id: 'singleton' },
      create: {
        id: 'singleton',
        version: snapshot.version,
        currentTeamIndex: snapshot.gameState.currentTeamIndex,
        turnStartTime: turnStartDate,
        status: snapshot.gameState.status,
        turnDuration: snapshot.gameState.turnDuration,
        totalReserveTime: snapshot.gameState.totalReserveTime,
        teamCount: snapshot.gameState.teamCount,
      },
      update: {
        version: snapshot.version,
        currentTeamIndex: snapshot.gameState.currentTeamIndex,
        turnStartTime: turnStartDate,
        status: snapshot.gameState.status,
        turnDuration: snapshot.gameState.turnDuration,
        totalReserveTime: snapshot.gameState.totalReserveTime,
        teamCount: snapshot.gameState.teamCount,
      },
    })

    const dbTeams = await tx.team.findMany({ select: { id: true } })
    const dbTeamIds = new Set(dbTeams.map((t) => t.id))
    const snapTeamIds = new Set(snapshot.teams.map((t) => t.id))
    const teamsChanged =
      dbTeamIds.size !== snapTeamIds.size ||
      snapshot.teams.some((t) => !dbTeamIds.has(t.id))

    if (teamsChanged) {
      await tx.member.updateMany({ data: { teamId: null, pickedAt: null } })
      await tx.team.deleteMany()
      if (snapshot.teams.length > 0) {
        await tx.team.createMany({
          data: snapshot.teams.map((t) => ({
            id: t.id,
            name: t.name,
            order: t.order,
            reserveTime: t.reserveTime,
          })),
        })
      }
    } else {
      for (const team of snapshot.teams) {
        await tx.team.update({
          where: { id: team.id },
          data: {
            name: team.name,
            order: team.order,
            reserveTime: team.reserveTime,
          },
        })
      }
    }

    const dbMembers = await tx.member.findMany({ select: { id: true } })
    const snapMemberIds = new Set(snapshot.members.map((m) => m.id))
    const removedIds = dbMembers.map((m) => m.id).filter((id) => !snapMemberIds.has(id))
    if (removedIds.length > 0) {
      await tx.member.deleteMany({ where: { id: { in: removedIds } } })
    }

    for (const member of snapshot.members) {
      const isUploadTarget = mediaUploads?.memberId === member.id
      const avatarCreate = isUploadTarget && mediaUploads.avatarTouched
        ? mediaUploads.avatarBlob ?? null
        : isMediaProxyUrl(member.avatar)
          ? null
          : member.avatar
      const bgCreate = isUploadTarget && mediaUploads.backgroundTouched
        ? mediaUploads.backgroundBlob ?? null
        : isMediaProxyUrl(member.background)
          ? null
          : member.background

      await tx.member.upsert({
        where: { id: member.id },
        create: {
          id: member.id,
          name: member.name,
          info: member.info,
          avatar: avatarCreate,
          background: bgCreate,
          avatarUrl: member.avatar,
          backgroundUrl: member.background,
          mediaVersion: member.mediaVersion ?? 0,
          teamId: member.teamId,
          isBanned: member.isBanned,
          pickedAt: member.pickedAt ? new Date(member.pickedAt) : null,
          order: member.order ?? 0,
        },
        update: {
          name: member.name,
          info: member.info,
          avatarUrl: member.avatar,
          backgroundUrl: member.background,
          mediaVersion: member.mediaVersion ?? 0,
          teamId: member.teamId,
          isBanned: member.isBanned,
          pickedAt: member.pickedAt ? new Date(member.pickedAt) : null,
          order: member.order ?? 0,
          ...(isUploadTarget && mediaUploads.avatarTouched ? { avatar: mediaUploads.avatarBlob ?? null } : {}),
          ...(isUploadTarget && mediaUploads.backgroundTouched ? { background: mediaUploads.backgroundBlob ?? null } : {}),
        },
      })
    }
  })
}

// ---------------------------------------------------------------------------
// Store 1: InMemoryStateStore (Zero-config Local Dev & Fast Tests)
// ---------------------------------------------------------------------------

export class InMemoryStateStore implements StateStore {
  getStoreKind(): StoreKind {
    return 'memory'
  }

  async getSnapshot(): Promise<NormalizedGameSnapshot> {
    const data = getMemoryStoreData()
    return cloneSnapshot(data.snapshot, Date.now())
  }

  async mutate(mutation: GameMutation, opts?: { nowMs?: number }): Promise<StoreMutationResult> {
    const data = getMemoryStoreData()
    const nowMs = opts?.nowMs ?? Date.now()

    const cached = getCachedIdempotency(data.idempotency, mutation.mutationId, nowMs)
    if (cached) {
      return cached
    }

    let preparedMutation: GameMutation = mutation
    if (mutation.type === 'MEMBER_ADD' && !mutation.id) {
      preparedMutation = { ...mutation, id: generateId() }
    }

    const applied = applyMutation(data.snapshot, preparedMutation, {
      nowMs,
      generateId,
      isOptimistic: false,
    })

    if (!applied.ok) {
      return {
        ok: false,
        status: applied.status,
        error: applied.error,
        code: applied.code,
        snapshot: cloneSnapshot(data.snapshot, nowMs),
      }
    }

    // Update in-memory media blobs
    if (preparedMutation.type === 'MEMBER_ADD') {
      const id = preparedMutation.id!
      if (isInlineDataUrl(preparedMutation.avatar)) {
        data.media.set(`${id}:avatar`, preparedMutation.avatar!)
      }
      if (isInlineDataUrl(preparedMutation.background)) {
        data.media.set(`${id}:background`, preparedMutation.background!)
      }
    } else if (preparedMutation.type === 'MEMBER_UPDATE') {
      const id = preparedMutation.id
      if (isInlineDataUrl(preparedMutation.avatar)) {
        data.media.set(`${id}:avatar`, preparedMutation.avatar!)
      } else if (preparedMutation.avatar === null || preparedMutation.avatar === '') {
        data.media.delete(`${id}:avatar`)
      }
      if (isInlineDataUrl(preparedMutation.background)) {
        data.media.set(`${id}:background`, preparedMutation.background!)
      } else if (preparedMutation.background === null || preparedMutation.background === '') {
        data.media.delete(`${id}:background`)
      }
    } else if (preparedMutation.type === 'MEMBER_DELETE') {
      data.media.delete(`${preparedMutation.id}:avatar`)
      data.media.delete(`${preparedMutation.id}:background`)
    }

    data.snapshot = applied.next
    if (!applied.alreadyApplied) {
      pushRingEvent(data.events, applied.event)
    }

    const result: StoreMutationResult = {
      ok: true,
      snapshot: cloneSnapshot(applied.next),
      event: applied.event,
      delta: applied.delta,
      alreadyApplied: applied.alreadyApplied,
      pickedMemberId: applied.pickedMemberId,
    }

    setCachedIdempotency(data.idempotency, mutation.mutationId, result, nowMs)
    return result
  }

  async getMedia(memberId: string, field: 'avatar' | 'background'): Promise<string | null> {
    const data = getMemoryStoreData()
    const blob = data.media.get(`${memberId}:${field}`)
    if (blob) return blob

    const member = data.snapshot.members.find((m) => m.id === memberId)
    const val = member?.[field] ?? null
    if (val && !isMediaProxyUrl(val)) {
      return val
    }
    return null
  }

  async getEventsSince(sinceVersion: number): Promise<RealtimeEvent[] | null> {
    const data = getMemoryStoreData()
    return extractContiguousEvents(data.events, sinceVersion, data.snapshot.version)
  }
}

// ---------------------------------------------------------------------------
// Store 2: PrismaStateStore (Optimized Neon Postgres Fallback — Zero Base64 in Hot Reads)
// ---------------------------------------------------------------------------

class PrismaVersionConflictError extends Error {
  constructor(
    public readonly status: 400 | 409,
    public readonly code: string,
    message: string
  ) {
    super(message)
  }
}

export class PrismaStateStore implements StateStore {
  getStoreKind(): StoreKind {
    return 'prisma'
  }

  async getSnapshot(): Promise<NormalizedGameSnapshot> {
    await ensureLegacyMediaUrlsBackfilled()
    return loadSnapshotFromPrismaClient(prisma, Date.now())
  }

  async mutate(mutation: GameMutation, opts?: { nowMs?: number }): Promise<StoreMutationResult> {
    await ensureLegacyMediaUrlsBackfilled()
    const cache = getPrismaCacheData()
    const nowMs = opts?.nowMs ?? Date.now()

    const cached = getCachedIdempotency(cache.idempotency, mutation.mutationId, nowMs)
    if (cached) {
      return cached
    }

    const maxAttempts =
      mutation.type === 'PICK' || mutation.type === 'AUTO_PICK' ? 1 : 3

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      try {
        const txResult = await prisma.$transaction(async (tx) => {
          const current = await loadSnapshotFromPrismaClient(tx, nowMs)

          let prepared: GameMutation = mutation
          if (mutation.type === 'MEMBER_ADD' && !mutation.id) {
            prepared = { ...mutation, id: generateId() }
          }

          const applied = applyMutation(current, prepared, {
            nowMs,
            generateId,
            isOptimistic: false,
          })

          if (!applied.ok) {
            return {
              ok: false as const,
              status: applied.status,
              error: applied.error,
              code: applied.code,
              snapshot: current,
            }
          }

          if (applied.alreadyApplied) {
            return {
              ok: true as const,
              snapshot: current,
              event: applied.event,
              alreadyApplied: true,
            }
          }

          const next = applied.next
          const turnStartDate = next.gameState.turnStartTime
            ? new Date(next.gameState.turnStartTime)
            : new Date(nowMs)

          // Acquire singleton row lock & verify optimistic version FIRST to serialize writers cleanly
          const locked = await tx.gameState.updateMany({
            where: { id: 'singleton', version: current.version },
            data: {
              version: next.version,
              currentTeamIndex: next.gameState.currentTeamIndex,
              turnStartTime: turnStartDate,
              status: next.gameState.status,
              turnDuration: next.gameState.turnDuration,
              totalReserveTime: next.gameState.totalReserveTime,
              teamCount: next.gameState.teamCount,
            },
          })

          if (locked.count === 0) {
            throw new PrismaVersionConflictError(409, 'VERSION_CONFLICT', 'Turn has already been taken')
          }

          // Persist minimal targeted entity changes inside the same transaction
          switch (prepared.type) {
            case 'START': {
              // GameState update above already persisted everything
              break
            }

            case 'PICK':
            case 'AUTO_PICK': {
              const memberPatch = applied.delta?.memberPatch
              const teamPatch = applied.delta?.teamPatch
              if (memberPatch) {
                const claimed = await tx.member.updateMany({
                  where: { id: memberPatch.id, teamId: null, isBanned: false },
                  data: {
                    teamId: memberPatch.teamId,
                    pickedAt: memberPatch.pickedAt ? new Date(memberPatch.pickedAt) : new Date(nowMs),
                  },
                })
                if (claimed.count === 0) {
                  throw new PrismaVersionConflictError(
                    409,
                    'MEMBER_UNAVAILABLE',
                    'Member is no longer available'
                  )
                }
              }
              if (teamPatch) {
                await tx.team.update({
                  where: { id: teamPatch.id },
                  data: { reserveTime: teamPatch.reserveTime },
                })
              }
              break
            }

            case 'RANDOMIZE': {
              const membersByTeam = new Map<string, string[]>()
              const prevAssigned = new Set(current.members.filter((m) => m.teamId).map((m) => m.id))
              for (const m of next.members) {
                if (m.teamId && !prevAssigned.has(m.id)) {
                  const list = membersByTeam.get(m.teamId) ?? []
                  list.push(m.id)
                  membersByTeam.set(m.teamId, list)
                }
              }
              const pickedDate = new Date(nowMs)
              for (const [teamId, memberIds] of membersByTeam.entries()) {
                await tx.member.updateMany({
                  where: { id: { in: memberIds }, teamId: null, isBanned: false },
                  data: { teamId, pickedAt: pickedDate },
                })
              }
              break
            }

            case 'CONFIG': {
              await tx.member.updateMany({
                data: { teamId: null, pickedAt: null, isBanned: false },
              })
              await tx.team.deleteMany()
              if (next.teams.length > 0) {
                await tx.team.createMany({
                  data: next.teams.map((t) => ({
                    id: t.id,
                    name: t.name,
                    order: t.order,
                    reserveTime: t.reserveTime,
                  })),
                })
              }
              break
            }

            case 'MEMBER_ADD': {
              const created = next.members.find((m) => m.id === prepared.id)
              if (created) {
                await tx.member.create({
                  data: {
                    id: created.id,
                    name: created.name,
                    info: created.info,
                    avatar: prepared.avatar ?? null,
                    background: prepared.background ?? null,
                    avatarUrl: created.avatar,
                    backgroundUrl: created.background,
                    mediaVersion: created.mediaVersion ?? 0,
                    teamId: null,
                    isBanned: false,
                    pickedAt: null,
                    order: 0,
                  },
                })
              }
              break
            }

            case 'MEMBER_UPDATE': {
              const updated = next.members.find((m) => m.id === prepared.id)
              if (updated) {
                const updateData: {
                  name: string
                  info: string | null
                  avatarUrl: string | null
                  backgroundUrl: string | null
                  mediaVersion: number
                  avatar?: string | null
                  background?: string | null
                } = {
                  name: updated.name,
                  info: updated.info,
                  avatarUrl: updated.avatar,
                  backgroundUrl: updated.background,
                  mediaVersion: updated.mediaVersion ?? 0,
                }

                if (prepared.avatar !== undefined && !isMediaProxyUrl(prepared.avatar)) {
                  updateData.avatar = prepared.avatar === '' ? null : prepared.avatar
                }
                if (prepared.background !== undefined && !isMediaProxyUrl(prepared.background)) {
                  updateData.background = prepared.background === '' ? null : prepared.background
                }

                await tx.member.update({
                  where: { id: updated.id },
                  data: updateData,
                })
              }
              break
            }

            case 'MEMBER_DELETE': {
              await tx.member.deleteMany({ where: { id: prepared.id } })
              break
            }
          }

          return {
            ok: true as const,
            snapshot: next,
            event: applied.event,
            delta: applied.delta,
            pickedMemberId: applied.pickedMemberId,
          }
        })

        if (txResult.ok) {
          if (!txResult.alreadyApplied) {
            pushRingEvent(cache.events, txResult.event)
          }
          setCachedIdempotency(cache.idempotency, mutation.mutationId, txResult, nowMs)
        }
        return txResult
      } catch (error) {
        if (error instanceof PrismaVersionConflictError) {
          const isRetryable = attempt + 1 < maxAttempts
          if (isRetryable) {
            continue
          }
          const latest = await this.getSnapshot()
          if (
            mutation.type === 'AUTO_PICK' &&
            mutation.expectedVersion !== undefined &&
            latest.version > mutation.expectedVersion
          ) {
            return {
              ok: true,
              snapshot: latest,
              event: makeSnapshotEvent(latest, nowMs, mutation.mutationId, mutation.clientId),
              alreadyApplied: true,
            }
          }
          return {
            ok: false,
            status: error.status,
            error: error.message,
            code: error.code,
            snapshot: latest,
          }
        }
        throw error
      }
    }

    const latest = await this.getSnapshot()
    return {
      ok: false,
      status: 409,
      error: 'Turn has already been taken',
      code: 'VERSION_CONFLICT',
      snapshot: latest,
    }
  }

  async getMedia(memberId: string, field: 'avatar' | 'background'): Promise<string | null> {
    if (field === 'avatar') {
      const row = await prisma.member.findUnique({
        where: { id: memberId },
        select: { avatar: true, avatarUrl: true },
      })
      if (!row) return null
      if (row.avatar) return row.avatar
      if (row.avatarUrl && !isMediaProxyUrl(row.avatarUrl)) return row.avatarUrl
      return null
    }

    const row = await prisma.member.findUnique({
      where: { id: memberId },
      select: { background: true, backgroundUrl: true },
    })
    if (!row) return null
    if (row.background) return row.background
    if (row.backgroundUrl && !isMediaProxyUrl(row.backgroundUrl)) return row.backgroundUrl
    return null
  }

  async getEventsSince(sinceVersion: number): Promise<RealtimeEvent[] | null> {
    const cache = getPrismaCacheData()
    const snapshot = await this.getSnapshot()
    return extractContiguousEvents(cache.events, sinceVersion, snapshot.version)
  }
}

// ---------------------------------------------------------------------------
// Store 3: UpstashRedisStateStore (1-RTT Atomic Lua + Async Neon Write-Behind)
// ---------------------------------------------------------------------------

/**
 * Single-RTT atomic Lua script executing all 8 BanPick mutations directly in
 * Upstash Redis, enforcing identical invariants to `src/lib/gameEngine.ts`:
 *  - KEYS[1]: state key (`banpick:state`)
 *  - KEYS[2]: stream key (`banpick:events`)
 *  - KEYS[3]: idempotency key (`banpick:idemp:<mutationId>`)
 *  - ARGV[1]: pubsub channel (`banpick:pubsub`)
 *  - ARGV[2]: JSON mutation payload (inline media replaced by `__INLINE_MEDIA__`)
 *  - ARGV[3]: nowMs (string integer)
 *  - ARGV[4]: nowIso (ISO-8601 UTC string)
 *  - ARGV[5]: randomFloat ([0, 1) string)
 *  - ARGV[6]: generatedId (UUID string for MEMBER_ADD)
 *  - ARGV[7]: JSON array of pre-generated team IDs (for CONFIG)
 */
export const LUA_MUTATION_SCRIPT = `
local stateKey = KEYS[1]
local streamKey = KEYS[2]
local idempKey = KEYS[3]

local pubsubChannel = ARGV[1]
local mut = cjson.decode(ARGV[2])
local nowMs = tonumber(ARGV[3])
local nowIso = ARGV[4]
local randomFloat = tonumber(ARGV[5]) or 0.5
local generatedId = ARGV[6]
local teamIds = cjson.decode(ARGV[7] or '[]')

local function is_null(v)
  return v == nil or v == cjson.null
end

local EMPTY_ARRAY_SENTINEL = '__BANPICK_EMPTY_ARRAY__'

local function as_array(t)
  if type(t) ~= 'table' or #t == 0 then
    return EMPTY_ARRAY_SENTINEL
  end
  return t
end

local function encode_json(obj)
  local encoded = cjson.encode(obj)
  return (encoded:gsub('"' .. EMPTY_ARRAY_SENTINEL .. '"', '[]'))
end

local function normalize_snap_arrays(s)
  if type(s) == 'table' then
    s.teams = as_array(s.teams)
    s.members = as_array(s.members)
  end
end

local function trim(s)
  if type(s) ~= 'string' then return '' end
  return (s:gsub('^%s+', ''):gsub('%s+$', ''))
end

local function url_encode(str)
  return (string.gsub(tostring(str), '([^%w%-_%.~])', function(c)
    return string.format('%%%02X', string.byte(c))
  end))
end

local function build_media_url(memberId, field, mediaVersion)
  return '/api/members/' .. url_encode(memberId) .. '/media?field=' .. field .. '&v=' .. tostring(mediaVersion)
end

local function parse_iso_ms(iso)
  if is_null(iso) or type(iso) ~= 'string' then return nil end
  local y, mo, d, h, mi, s, ms = iso:match('^(%d%d%d%d)%-(%d%d)%-(%d%d)[T ](%d%d):(%d%d):(%d%d)%.?(%d*)Z?$')
  if not y then return nil end
  y, mo, d, h, mi, s = tonumber(y), tonumber(mo), tonumber(d), tonumber(h), tonumber(mi), tonumber(s)
  local msec = 0
  if ms and #ms > 0 then
    msec = tonumber((ms .. '000'):sub(1, 3)) or 0
  end
  if mo <= 2 then y = y - 1 end
  local era = math.floor(y / 400)
  local yoe = y - era * 400
  local doy = math.floor((153 * (mo + (mo > 2 and -3 or 9)) + 2) / 5) + d - 1
  local doe = yoe * 365 + math.floor(yoe / 4) - math.floor(yoe / 100) + doy
  local days = era * 146097 + doe - 719468
  return (((days * 24 + h) * 60 + mi) * 60 + s) * 1000 + msec
end

local function sort_teams(teams)
  table.sort(teams, function(a, b)
    if a.order ~= b.order then return a.order < b.order end
    return tostring(a.id) < tostring(b.id)
  end)
end

local function sort_members(members)
  table.sort(members, function(a, b)
    local an = string.lower(tostring(a.name or ''))
    local bn = string.lower(tostring(b.name or ''))
    if an ~= bn then return an < bn end
    if tostring(a.name) ~= tostring(b.name) then return tostring(a.name) < tostring(b.name) end
    return tostring(a.id) < tostring(b.id)
  end)
end

local function clamp_unit(val)
  if val < 0 then return 0 end
  if val >= 1 then return 0.999999999 end
  return val
end

local function make_snapshot_event(snap, mutationId, clientId)
  return {
    kind = 'snapshot',
    version = snap.version,
    serverTime = nowMs,
    mutationId = is_null(mutationId) and cjson.null or mutationId,
    clientId = is_null(clientId) and cjson.null or clientId,
    snapshot = snap
  }
end

-- 1. Idempotency check
if idempKey and idempKey ~= '' then
  local cached = redis.call('GET', idempKey)
  if cached then
    local parsed = cjson.decode(cached)
    if parsed.ok then
      parsed.alreadyApplied = true
    end
    normalize_snap_arrays(parsed.snapshot)
    if type(parsed.event) == 'table' and type(parsed.event.snapshot) == 'table' then
      normalize_snap_arrays(parsed.event.snapshot)
    end
    return encode_json(parsed)
  end
end

-- 2. Load snapshot
local raw = redis.call('GET', stateKey)
if not raw then
  return cjson.encode({ cacheMiss = true })
end

local snap = cjson.decode(raw)
if type(snap.teams) ~= 'table' then snap.teams = {} end
if type(snap.members) ~= 'table' then snap.members = {} end
local gs = snap.gameState
local clientId = is_null(mut.clientId) and cjson.null or mut.clientId
local mutationId = is_null(mut.mutationId) and cjson.null or mut.mutationId

local function err_resp(status, errorMsg, code)
  normalize_snap_arrays(snap)
  return encode_json({
    ok = false,
    status = status,
    error = errorMsg,
    code = code,
    snapshot = snap
  })
end

local function already_resp()
  normalize_snap_arrays(snap)
  local ev = make_snapshot_event(snap, mutationId, clientId)
  return encode_json({
    ok = true,
    alreadyApplied = true,
    snapshot = snap,
    event = ev
  })
end

local function commit_resp(nextSnap, event, delta, pickedMemberId)
  normalize_snap_arrays(nextSnap)
  if type(event) == 'table' and type(event.snapshot) == 'table' then
    normalize_snap_arrays(event.snapshot)
  end
  local snapJson = encode_json(nextSnap)
  local eventJson = encode_json(event)

  redis.call('SET', stateKey, snapJson)
  redis.call('XADD', streamKey, 'MAXLEN', '~', '200', '*', 'version', tostring(nextSnap.version), 'event', eventJson)
  redis.call('PUBLISH', pubsubChannel, eventJson)

  local resultObj = {
    ok = true,
    snapshot = nextSnap,
    event = event
  }
  if delta ~= nil then resultObj.delta = delta end
  if pickedMemberId ~= nil then resultObj.pickedMemberId = pickedMemberId end

  local resJson = encode_json(resultObj)
  if idempKey and idempKey ~= '' then
    redis.call('SET', idempKey, resJson, 'EX', ${IDEMPOTENCY_TTL_SEC})
  end
  return resJson
end

local mtype = mut.type

if mtype == 'START' then
  if not is_null(mut.expectedVersion) and snap.version > mut.expectedVersion and gs.status ~= 'CONFIGURING' then
    return already_resp()
  end
  local prevVersion = snap.version
  local nextVersion = prevVersion + 1
  gs.version = nextVersion
  gs.status = 'PICKING'
  gs.currentTeamIndex = 0
  gs.turnStartTime = nowIso
  snap.version = nextVersion
  snap.serverTime = nowMs
  snap.lastMutationId = mutationId

  local delta = {
    kind = 'delta',
    version = nextVersion,
    prevVersion = prevVersion,
    serverTime = nowMs,
    mutationId = mutationId,
    clientId = clientId,
    op = 'START',
    gameState = gs
  }
  return commit_resp(snap, delta, delta, nil)

elseif mtype == 'PICK' then
  if gs.status ~= 'PICKING' then
    return err_resp(400, 'Not in picking phase', 'NOT_PICKING')
  end
  if not is_null(mut.expectedVersion) and snap.version ~= mut.expectedVersion then
    return err_resp(409, 'Turn has already been taken', 'VERSION_CONFLICT')
  end

  sort_teams(snap.teams)
  local currentTeam = snap.teams[gs.currentTeamIndex + 1]
  if not currentTeam then
    return err_resp(400, 'No teams configured', 'NO_TEAMS')
  end
  if currentTeam.id ~= mut.teamId then
    return err_resp(400, 'Not your turn', 'NOT_YOUR_TURN')
  end

  local targetMember = nil
  for _, m in ipairs(snap.members) do
    if m.id == mut.memberId then
      targetMember = m
      break
    end
  end
  if not targetMember or not is_null(targetMember.teamId) or targetMember.isBanned == true then
    return err_resp(409, 'Member is no longer available', 'MEMBER_UNAVAILABLE')
  end

  local turnStartMs = parse_iso_ms(gs.turnStartTime) or nowMs
  local elapsed = math.max(0, math.floor((nowMs - turnStartMs) / 1000))
  local extra = math.max(0, elapsed - (gs.turnDuration or 30))
  local newReserve = math.max(0, (currentTeam.reserveTime or 0) - extra)

  targetMember.teamId = currentTeam.id
  targetMember.pickedAt = nowIso
  currentTeam.reserveTime = newReserve

  local remaining = 0
  for _, m in ipairs(snap.members) do
    if is_null(m.teamId) and m.isBanned ~= true then
      remaining = remaining + 1
    end
  end

  local prevVersion = snap.version
  local nextVersion = prevVersion + 1
  gs.version = nextVersion
  gs.currentTeamIndex = (gs.currentTeamIndex + 1) % #snap.teams
  gs.turnStartTime = nowIso
  gs.status = (remaining == 0) and 'COMPLETED' or 'PICKING'

  snap.version = nextVersion
  snap.serverTime = nowMs
  snap.lastMutationId = mutationId

  local delta = {
    kind = 'delta',
    version = nextVersion,
    prevVersion = prevVersion,
    serverTime = nowMs,
    mutationId = mutationId,
    clientId = clientId,
    op = 'PICK',
    gameState = gs,
    teamPatch = { id = currentTeam.id, reserveTime = newReserve },
    memberPatch = { id = targetMember.id, teamId = currentTeam.id, pickedAt = nowIso }
  }
  return commit_resp(snap, delta, delta, targetMember.id)

elseif mtype == 'AUTO_PICK' then
  if not is_null(mut.expectedVersion) and snap.version > mut.expectedVersion then
    return already_resp()
  end
  if gs.status ~= 'PICKING' then
    return err_resp(400, 'Not in picking phase', 'NOT_PICKING')
  end

  sort_teams(snap.teams)
  local currentTeam = snap.teams[gs.currentTeamIndex + 1]
  if not currentTeam then
    return err_resp(400, 'No teams configured', 'NO_TEAMS')
  end
  if not is_null(mut.teamId) and mut.teamId ~= '' and currentTeam.id ~= mut.teamId then
    return err_resp(409, 'Turn has already been taken', 'TURN_ALREADY_TAKEN')
  end

  local available = {}
  for _, m in ipairs(snap.members) do
    if is_null(m.teamId) and m.isBanned ~= true then
      table.insert(available, m)
    end
  end
  if #available == 0 then
    return already_resp()
  end

  sort_members(available)
  local roll = clamp_unit(randomFloat)
  local pickIdx = math.floor(roll * #available) + 1
  if pickIdx < 1 then pickIdx = 1 end
  if pickIdx > #available then pickIdx = #available end
  local chosen = available[pickIdx]

  currentTeam.reserveTime = 0
  chosen.teamId = currentTeam.id
  chosen.pickedAt = nowIso

  local remaining = #available - 1
  local prevVersion = snap.version
  local nextVersion = prevVersion + 1
  gs.version = nextVersion
  gs.currentTeamIndex = (gs.currentTeamIndex + 1) % #snap.teams
  gs.turnStartTime = nowIso
  gs.status = (remaining == 0) and 'COMPLETED' or 'PICKING'

  snap.version = nextVersion
  snap.serverTime = nowMs
  snap.lastMutationId = mutationId

  local delta = {
    kind = 'delta',
    version = nextVersion,
    prevVersion = prevVersion,
    serverTime = nowMs,
    mutationId = mutationId,
    clientId = clientId,
    op = 'AUTO_PICK',
    gameState = gs,
    teamPatch = { id = currentTeam.id, reserveTime = 0 },
    memberPatch = { id = chosen.id, teamId = currentTeam.id, pickedAt = nowIso }
  }
  return commit_resp(snap, delta, delta, chosen.id)

elseif mtype == 'RANDOMIZE' then
  sort_teams(snap.teams)
  if #snap.teams == 0 then
    return err_resp(400, 'No teams configured', 'NO_TEAMS')
  end

  local available = {}
  local availableById = {}
  for _, m in ipairs(snap.members) do
    if is_null(m.teamId) and m.isBanned ~= true then
      table.insert(available, m)
      availableById[m.id] = m
    end
  end
  sort_members(available)

  local ordered = {}
  if type(mut.shuffledMemberIds) == 'table' and #mut.shuffledMemberIds > 0 then
    local seen = {}
    for _, id in ipairs(mut.shuffledMemberIds) do
      local found = availableById[id]
      if found and not seen[id] then
        seen[id] = true
        table.insert(ordered, found)
      end
    end
    for _, m in ipairs(available) do
      if not seen[m.id] then
        table.insert(ordered, m)
      end
    end
  else
    for i = 1, #available do ordered[i] = available[i] end
    local seed = math.floor(clamp_unit(randomFloat) * 2147483646) + 1
    for i = #ordered, 2, -1 do
      seed = (seed * 16807) % 2147483647
      local j = (seed % i) + 1
      ordered[i], ordered[j] = ordered[j], ordered[i]
    end
  end

  for i, m in ipairs(ordered) do
    local team = snap.teams[((i - 1) % #snap.teams) + 1]
    m.teamId = team.id
    m.pickedAt = nowIso
  end

  local nextVersion = snap.version + 1
  gs.version = nextVersion
  gs.status = 'COMPLETED'
  snap.version = nextVersion
  snap.serverTime = nowMs
  snap.lastMutationId = mutationId

  local ev = make_snapshot_event(snap, mutationId, clientId)
  return commit_resp(snap, ev, nil, nil)

elseif mtype == 'CONFIG' then
  local teamCount = math.max(1, math.floor(tonumber(mut.teamCount) or 2))
  local turnDuration = math.max(0, math.floor(tonumber(mut.turnDuration) or 30))
  local totalReserveTime = math.max(0, math.floor(tonumber(mut.totalReserveTime) or 120))
  local rawNames = type(mut.teamNames) == 'table' and mut.teamNames or {}

  local nextTeams = {}
  for i = 1, teamCount do
    local rawName = rawNames[i]
    local name = (type(rawName) == 'string' and trim(rawName) ~= '') and rawName or ('Team ' .. tostring(i))
    local tid = teamIds[i] or (generatedId .. '_' .. tostring(i))
    table.insert(nextTeams, {
      id = tid,
      name = name,
      order = i - 1,
      reserveTime = totalReserveTime
    })
  end

  for _, m in ipairs(snap.members) do
    m.teamId = cjson.null
    m.pickedAt = cjson.null
    m.isBanned = false
  end

  local nextVersion = snap.version + 1
  gs.version = nextVersion
  gs.teamCount = teamCount
  gs.turnDuration = turnDuration
  gs.totalReserveTime = totalReserveTime
  gs.status = 'CONFIGURING'
  gs.currentTeamIndex = 0
  gs.turnStartTime = cjson.null

  snap.version = nextVersion
  snap.serverTime = nowMs
  snap.lastMutationId = mutationId
  snap.teams = nextTeams

  local ev = make_snapshot_event(snap, mutationId, clientId)
  return commit_resp(snap, ev, nil, nil)

elseif mtype == 'MEMBER_ADD' then
  if is_null(mut.name) or trim(mut.name) == '' then
    return err_resp(400, 'Member name is required', 'INVALID_MEMBER_NAME')
  end

  local id = (not is_null(mut.id) and mut.id ~= '') and mut.id or generatedId
  local hasInline = (mut.avatar == '${INLINE_MEDIA_SENTINEL}') or (mut.background == '${INLINE_MEDIA_SENTINEL}')
  local mv = hasInline and 1 or 0

  local function resolve_add_media(val, field)
    if is_null(val) or val == '' then return cjson.null end
    if val == '${INLINE_MEDIA_SENTINEL}' then return build_media_url(id, field, mv) end
    return val
  end

  table.insert(snap.members, {
    id = id,
    name = mut.name,
    info = is_null(mut.info) and '' or mut.info,
    avatar = resolve_add_media(mut.avatar, 'avatar'),
    background = resolve_add_media(mut.background, 'background'),
    teamId = cjson.null,
    isBanned = false,
    pickedAt = cjson.null,
    order = 0,
    mediaVersion = mv
  })
  sort_members(snap.members)

  local nextVersion = snap.version + 1
  gs.version = nextVersion
  snap.version = nextVersion
  snap.serverTime = nowMs
  snap.lastMutationId = mutationId

  local ev = make_snapshot_event(snap, mutationId, clientId)
  return commit_resp(snap, ev, nil, nil)

elseif mtype == 'MEMBER_UPDATE' then
  local target = nil
  for _, m in ipairs(snap.members) do
    if m.id == mut.id then
      target = m
      break
    end
  end
  if not target then
    return err_resp(400, 'Member not found', 'MEMBER_NOT_FOUND')
  end
  if mut.name ~= nil and (mut.name == cjson.null or trim(mut.name) == '') then
    return err_resp(400, 'Member name is required', 'INVALID_MEMBER_NAME')
  end

  local hasNewInline = (mut.avatar == '${INLINE_MEDIA_SENTINEL}') or (mut.background == '${INLINE_MEDIA_SENTINEL}')
  local prevMv = tonumber(target.mediaVersion) or 0
  local nextMv = hasNewInline and (prevMv + 1) or prevMv

  local function resolve_upd_media(incoming, existing, field)
    if incoming == nil then return existing end
    if incoming == cjson.null or incoming == '' then return cjson.null end
    if incoming == '${INLINE_MEDIA_SENTINEL}' then return build_media_url(target.id, field, nextMv) end
    if type(incoming) == 'string' and string.sub(incoming, 1, 13) == '/api/members/' then
      return is_null(existing) and incoming or existing
    end
    return incoming
  end

  if mut.name ~= nil then target.name = mut.name end
  if mut.info ~= nil then target.info = mut.info end
  target.avatar = resolve_upd_media(mut.avatar, target.avatar, 'avatar')
  target.background = resolve_upd_media(mut.background, target.background, 'background')
  target.mediaVersion = nextMv
  sort_members(snap.members)

  local nextVersion = snap.version + 1
  gs.version = nextVersion
  snap.version = nextVersion
  snap.serverTime = nowMs
  snap.lastMutationId = mutationId

  local ev = make_snapshot_event(snap, mutationId, clientId)
  return commit_resp(snap, ev, nil, nil)

elseif mtype == 'MEMBER_DELETE' then
  local found = false
  local nextMembers = {}
  for _, m in ipairs(snap.members) do
    if m.id == mut.id then
      found = true
    else
      table.insert(nextMembers, m)
    end
  end
  if not found then
    return already_resp()
  end

  snap.members = nextMembers
  local nextVersion = snap.version + 1
  gs.version = nextVersion
  snap.version = nextVersion
  snap.serverTime = nowMs
  snap.lastMutationId = mutationId

  local ev = make_snapshot_event(snap, mutationId, clientId)
  return commit_resp(snap, ev, nil, nil)
end

return err_resp(400, 'Unsupported mutation type', 'INVALID_MUTATION')
`

interface RawLuaResponse {
  cacheMiss?: boolean
  ok?: boolean
  status?: 400 | 409
  error?: string
  code?: string
  alreadyApplied?: boolean
  pickedMemberId?: string
  snapshot?: unknown
  event?: unknown
  delta?: StateDelta
}

export class UpstashRedisStateStore implements StateStore {
  private readonly redis: Redis
  private readonly script: ReturnType<Redis['createScript']>

  constructor(redisClient?: Redis) {
    if (redisClient) {
      this.redis = redisClient
    } else {
      const cfg = getUpstashConfig()
      if (!cfg) {
        throw new Error('Upstash Redis credentials are not configured')
      }
      this.redis = new Redis({
        url: cfg.url,
        token: cfg.token,
        automaticDeserialization: false,
      })
    }
    this.script = this.redis.createScript<string>(LUA_MUTATION_SCRIPT)
  }

  getStoreKind(): StoreKind {
    return 'upstash'
  }

  private async hydrateRedisSnapshot(nowMs: number): Promise<NormalizedGameSnapshot> {
    let initial: NormalizedGameSnapshot
    if (isPrismaConfigured()) {
      await ensureLegacyMediaUrlsBackfilled()
      initial = await loadSnapshotFromPrismaClient(prisma, nowMs)
    } else {
      initial = createDefaultSnapshot(nowMs)
    }

    // Use NX so concurrent cold hydrations never overwrite a newer mutation
    await this.redis.set(REDIS_STATE_KEY, JSON.stringify(initial), { nx: true })

    const raw = await this.redis.get<string>(REDIS_STATE_KEY)
    const parsed = parseJsonSafe<unknown>(raw)
    return parsed ? normalizeRawSnapshot(parsed) : initial
  }

  async getSnapshot(): Promise<NormalizedGameSnapshot> {
    const nowMs = Date.now()
    const raw = await this.redis.get<string>(REDIS_STATE_KEY)
    const parsed = parseJsonSafe<unknown>(raw)
    if (parsed) {
      const snap = normalizeRawSnapshot(parsed)
      return { ...snap, serverTime: nowMs }
    }
    return this.hydrateRedisSnapshot(nowMs)
  }

  async mutate(mutation: GameMutation, opts?: { nowMs?: number }): Promise<StoreMutationResult> {
    const nowMs = opts?.nowMs ?? Date.now()
    const nowIso = new Date(nowMs).toISOString()
    const randomFloat = Math.random()
    const generatedId = generateId()

    let prepared: GameMutation = mutation
    let mediaUploads: MediaUploadBlobs | undefined
    const mediaDeletes: string[] = []
    let sanitizedForLua: Record<string, unknown>

    if (mutation.type === 'CONFIG') {
      const teamCount = parseNonNegativeInt(mutation.teamCount, 2, 1)
      const turnDuration = parseNonNegativeInt(mutation.turnDuration, 30, 0)
      const totalReserveTime = parseNonNegativeInt(mutation.totalReserveTime, 120, 0)
      prepared = {
        ...mutation,
        teamCount,
        turnDuration,
        totalReserveTime,
      }
      sanitizedForLua = { ...prepared }
    } else if (mutation.type === 'MEMBER_ADD') {
      const memberId = mutation.id || generatedId
      prepared = { ...mutation, id: memberId }
      const uploads: Promise<unknown>[] = []
      const luaCopy: Record<string, unknown> = { ...prepared }
      const hasValidName = typeof mutation.name === 'string' && mutation.name.trim() !== ''

      if (hasValidName) {
        mediaUploads = { memberId }
        if (isInlineDataUrl(mutation.avatar)) {
          mediaUploads.avatarTouched = true
          mediaUploads.avatarBlob = mutation.avatar
          uploads.push(this.redis.set(`${REDIS_MEDIA_PREFIX}${memberId}:avatar`, mutation.avatar!))
          luaCopy.avatar = INLINE_MEDIA_SENTINEL
        } else if (mutation.avatar) {
          mediaUploads.avatarTouched = true
          mediaUploads.avatarBlob = mutation.avatar
        }

        if (isInlineDataUrl(mutation.background)) {
          mediaUploads.backgroundTouched = true
          mediaUploads.backgroundBlob = mutation.background
          uploads.push(this.redis.set(`${REDIS_MEDIA_PREFIX}${memberId}:background`, mutation.background!))
          luaCopy.background = INLINE_MEDIA_SENTINEL
        } else if (mutation.background) {
          mediaUploads.backgroundTouched = true
          mediaUploads.backgroundBlob = mutation.background
        }

        if (uploads.length > 0) {
          await Promise.all(uploads)
        }
      }
      sanitizedForLua = luaCopy
    } else if (mutation.type === 'MEMBER_UPDATE') {
      const memberId = mutation.id
      const uploads: Promise<unknown>[] = []
      const luaCopy: Record<string, unknown> = { ...mutation }
      const hasInvalidName =
        mutation.name !== undefined &&
        (typeof mutation.name !== 'string' || mutation.name.trim() === '')

      if (!hasInvalidName) {
        mediaUploads = { memberId }
        if (isInlineDataUrl(mutation.avatar)) {
          mediaUploads.avatarTouched = true
          mediaUploads.avatarBlob = mutation.avatar
          uploads.push(this.redis.set(`${REDIS_MEDIA_PREFIX}${memberId}:avatar`, mutation.avatar!))
          luaCopy.avatar = INLINE_MEDIA_SENTINEL
        } else if (mutation.avatar === null || mutation.avatar === '') {
          mediaUploads.avatarTouched = true
          mediaUploads.avatarBlob = null
          mediaDeletes.push(`${REDIS_MEDIA_PREFIX}${memberId}:avatar`)
        } else if (mutation.avatar !== undefined && !isMediaProxyUrl(mutation.avatar)) {
          mediaUploads.avatarTouched = true
          mediaUploads.avatarBlob = mutation.avatar
        }

        if (isInlineDataUrl(mutation.background)) {
          mediaUploads.backgroundTouched = true
          mediaUploads.backgroundBlob = mutation.background
          uploads.push(this.redis.set(`${REDIS_MEDIA_PREFIX}${memberId}:background`, mutation.background!))
          luaCopy.background = INLINE_MEDIA_SENTINEL
        } else if (mutation.background === null || mutation.background === '') {
          mediaUploads.backgroundTouched = true
          mediaUploads.backgroundBlob = null
          mediaDeletes.push(`${REDIS_MEDIA_PREFIX}${memberId}:background`)
        } else if (mutation.background !== undefined && !isMediaProxyUrl(mutation.background)) {
          mediaUploads.backgroundTouched = true
          mediaUploads.backgroundBlob = mutation.background
        }

        if (uploads.length > 0) {
          await Promise.all(uploads)
        }
      }
      sanitizedForLua = luaCopy
    } else if (mutation.type === 'MEMBER_DELETE') {
      mediaDeletes.push(
        `${REDIS_MEDIA_PREFIX}${mutation.id}:avatar`,
        `${REDIS_MEDIA_PREFIX}${mutation.id}:background`
      )
      sanitizedForLua = { ...mutation }
    } else {
      sanitizedForLua = { ...mutation }
    }

    const teamIds =
      prepared.type === 'CONFIG'
        ? Array.from({ length: prepared.teamCount }, () => generateId())
        : []

    const idempKey = mutation.mutationId ? `${REDIS_IDEMP_PREFIX}${mutation.mutationId}` : ''
    const keys = [REDIS_STATE_KEY, REDIS_EVENTS_KEY, idempKey]
    const args = [
      UPSTASH_PUBSUB_CHANNEL,
      JSON.stringify(sanitizedForLua),
      String(nowMs),
      nowIso,
      String(randomFloat),
      generatedId,
      JSON.stringify(teamIds),
    ]

    let rawResp = await this.script.exec(keys, args)
    let parsed = parseJsonSafe<RawLuaResponse>(rawResp)

    if (parsed?.cacheMiss) {
      await this.hydrateRedisSnapshot(nowMs)
      rawResp = await this.script.exec(keys, args)
      parsed = parseJsonSafe<RawLuaResponse>(rawResp)
    }

    if (!parsed) {
      throw new Error('Unexpected empty response from Upstash Redis Lua mutation')
    }

    const snapshot = normalizeRawSnapshot(parsed.snapshot)

    if (!parsed.ok) {
      return {
        ok: false,
        status: parsed.status ?? 400,
        error: parsed.error ?? 'Mutation failed',
        code: parsed.code ?? 'MUTATION_FAILED',
        snapshot,
      }
    }

    const event = normalizeRealtimeEvent(parsed.event)
    const alreadyApplied = Boolean(parsed.alreadyApplied)

    if (!alreadyApplied) {
      if (mediaDeletes.length > 0) {
        scheduleAfter(async () => {
          await this.redis.del(...mediaDeletes)
        })
      }

      if (isPrismaConfigured()) {
        scheduleAfter(() =>
          persistSnapshotToPrisma(snapshot, prepared, parsed.delta, mediaUploads)
        )
      }
    }

    return {
      ok: true,
      snapshot,
      event,
      delta: parsed.delta,
      alreadyApplied,
      pickedMemberId: parsed.pickedMemberId,
      publishedToRedis: !alreadyApplied,
    }
  }

  async getMedia(memberId: string, field: 'avatar' | 'background'): Promise<string | null> {
    const key = `${REDIS_MEDIA_PREFIX}${memberId}:${field}`
    const cached = await this.redis.get<string>(key)
    if (typeof cached === 'string' && cached.length > 0) {
      return cached
    }

    if (isPrismaConfigured()) {
      const fallback = new PrismaStateStore()
      const fromDb = await fallback.getMedia(memberId, field)
      if (fromDb) {
        scheduleAfter(async () => {
          await this.redis.set(key, fromDb)
        })
        return fromDb
      }
    }

    // Check if hot snapshot holds an external URL
    const snap = await this.getSnapshot()
    const member = snap.members.find((m) => m.id === memberId)
    const val = member?.[field] ?? null
    if (val && !isMediaProxyUrl(val)) {
      return val
    }

    return null
  }

  async getEventsSince(sinceVersion: number): Promise<RealtimeEvent[] | null> {
    const snapshot = await this.getSnapshot()
    if (sinceVersion >= snapshot.version) return []

    const entries = await this.redis.xrange<Record<string, unknown>>(REDIS_EVENTS_KEY, '-', '+')
    if (!entries) return null

    const events: RealtimeEvent[] = []
    if (Array.isArray(entries)) {
      // Handle raw [id, [k, v, ...]] shape when automaticDeserialization: false
      for (const entry of entries as unknown as Array<[string, string[]]>) {
        const fields = entry?.[1]
        if (!Array.isArray(fields)) continue
        for (let i = 0; i < fields.length - 1; i += 2) {
          if (fields[i] === 'event') {
            const parsed = parseJsonSafe<unknown>(fields[i + 1])
            if (parsed) events.push(normalizeRealtimeEvent(parsed))
          }
        }
      }
    } else if (typeof entries === 'object') {
      for (const record of Object.values(entries)) {
        if (!record || typeof record !== 'object') continue
        const rawEvent = (record as Record<string, unknown>).event
        const parsed = parseJsonSafe<unknown>(rawEvent)
        if (parsed) events.push(normalizeRealtimeEvent(parsed))
      }
    }

    return extractContiguousEvents(events, sinceVersion, snapshot.version)
  }
}

// ---------------------------------------------------------------------------
// Factory & Test Override Helpers
// ---------------------------------------------------------------------------

function resolveStoreSelection(): { kind: StoreKind; key: string } {
  const forced = process.env.BANPICK_STORE?.toLowerCase()
  const upstash = getUpstashConfig()

  if (forced === 'memory') {
    return { kind: 'memory', key: 'memory' }
  }
  if (forced === 'prisma') {
    return { kind: 'prisma', key: `prisma:${process.env.POSTGRES_PRISMA_URL ?? ''}` }
  }
  if (forced === 'upstash' && upstash) {
    return { kind: 'upstash', key: `upstash:${upstash.url}` }
  }

  if (upstash) {
    return { kind: 'upstash', key: `upstash:${upstash.url}` }
  }
  if (isPrismaConfigured()) {
    return { kind: 'prisma', key: `prisma:${process.env.POSTGRES_PRISMA_URL}` }
  }
  return { kind: 'memory', key: 'memory' }
}

export function getStateStore(): StateStore {
  if (globalThis.__banpickStateStoreOverride) {
    return globalThis.__banpickStateStoreOverride
  }

  const selection = resolveStoreSelection()
  const cached = globalThis.__banpickStateStoreCached
  if (cached && cached.key === selection.key) {
    return cached.store
  }

  let store: StateStore
  if (selection.kind === 'upstash') {
    store = new UpstashRedisStateStore()
  } else if (selection.kind === 'prisma') {
    store = new PrismaStateStore()
  } else {
    store = new InMemoryStateStore()
  }

  globalThis.__banpickStateStoreCached = { key: selection.key, store }
  return store
}

export function setStateStore(store: StateStore | null): void {
  globalThis.__banpickStateStoreOverride = store
}

export function resetStateStore(): void {
  globalThis.__banpickStateStoreOverride = null
  globalThis.__banpickStateStoreCached = undefined
  globalThis.__banpickMemoryStore = undefined
  globalThis.__banpickPrismaCache = undefined
  globalThis.__banpickLegacyMediaBackfilled = undefined
  globalThis.__banpickLegacyMediaBackfillPromise = undefined
}
