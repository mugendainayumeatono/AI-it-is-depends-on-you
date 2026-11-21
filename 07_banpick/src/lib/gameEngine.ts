import type {
  FullGameState,
  GameMutation,
  GameState,
  GameStatus,
  Member,
  NormalizedGameSnapshot,
  RealtimeEvent,
  SnapshotEvent,
  StateDelta,
  Team,
  TeamSummary,
} from '@/types'

export interface ApplyMutationOptions {
  nowMs: number
  randomFloat?: number
  generateId?: () => string
  isOptimistic?: boolean
}

export type ApplyMutationResult =
  | {
      ok: true
      next: NormalizedGameSnapshot
      delta?: StateDelta
      event: RealtimeEvent
      alreadyApplied?: boolean
      pickedMemberId?: string
    }
  | {
      ok: false
      status: 400 | 409
      error: string
      code: string
    }

export interface ApplyRealtimeEventResult {
  applied: boolean
  needsFullSync: boolean
  next: NormalizedGameSnapshot | null
}

function defaultGenerateId(): string {
  if (typeof globalThis.crypto !== 'undefined' && typeof globalThis.crypto.randomUUID === 'function') {
    return globalThis.crypto.randomUUID()
  }
  return `id_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`
}

function compareTeams(a: TeamSummary, b: TeamSummary): number {
  if (a.order !== b.order) return a.order - b.order
  return a.id.localeCompare(b.id)
}

function compareMembersByName(a: Member, b: Member): number {
  const nameCmp = a.name.localeCompare(b.name)
  if (nameCmp !== 0) return nameCmp
  return a.id.localeCompare(b.id)
}

function comparePickedMembers(a: Member, b: Member): number {
  const aTime = a.pickedAt ? Date.parse(a.pickedAt) : Number.POSITIVE_INFINITY
  const bTime = b.pickedAt ? Date.parse(b.pickedAt) : Number.POSITIVE_INFINITY
  const safeA = Number.isFinite(aTime) ? aTime : Number.POSITIVE_INFINITY
  const safeB = Number.isFinite(bTime) ? bTime : Number.POSITIVE_INFINITY
  if (safeA !== safeB) return safeA - safeB
  return compareMembersByName(a, b)
}

function clampUnitFloat(val: number): number {
  if (!Number.isFinite(val) || val < 0) return 0
  if (val >= 1) return 0.9999999999999999
  return val
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

export function createDefaultSnapshot(nowMs: number = Date.now()): NormalizedGameSnapshot {
  return {
    version: 1,
    serverTime: nowMs,
    lastMutationId: null,
    gameState: {
      id: 'singleton',
      version: 1,
      currentTeamIndex: 0,
      turnStartTime: null,
      status: 'CONFIGURING',
      turnDuration: 30,
      totalReserveTime: 120,
      teamCount: 2,
    },
    teams: [],
    members: [],
  }
}

export function materializeState(snapshot: NormalizedGameSnapshot): FullGameState {
  const rawTeams = Array.isArray(snapshot.teams) ? snapshot.teams : []
  const rawMembers = Array.isArray(snapshot.members) ? snapshot.members : []
  const sortedTeams = [...rawTeams].sort(compareTeams)
  const sortedMembers = [...rawMembers].map((m) => ({ ...m })).sort(compareMembersByName)

  const membersByTeam = new Map<string, Member[]>()
  for (const member of sortedMembers) {
    if (member.teamId) {
      const bucket = membersByTeam.get(member.teamId)
      if (bucket) {
        bucket.push(member)
      } else {
        membersByTeam.set(member.teamId, [member])
      }
    }
  }

  const teams: Team[] = sortedTeams.map((team) => {
    const teamMembers = membersByTeam.get(team.id) ?? []
    teamMembers.sort(comparePickedMembers)
    return {
      ...team,
      members: teamMembers,
    }
  })

  return {
    version: snapshot.version,
    serverTime: snapshot.serverTime,
    lastMutationId: snapshot.lastMutationId ?? null,
    gameState: {
      ...snapshot.gameState,
      version: snapshot.version,
    },
    teams,
    members: sortedMembers,
  }
}

export function normalizeState(full: FullGameState): NormalizedGameSnapshot {
  const version = Number.isFinite(full.version)
    ? full.version
    : Number.isFinite(full.gameState.version)
      ? full.gameState.version
      : 1

  const rawTeams = Array.isArray(full.teams) ? full.teams : []
  const rawMembers = Array.isArray(full.members) ? full.members : []

  const teams: TeamSummary[] = [...rawTeams]
    .map((team) => ({
      id: team.id,
      name: team.name,
      order: team.order,
      reserveTime: team.reserveTime,
    }))
    .sort(compareTeams)

  const members: Member[] = [...rawMembers].map((m) => ({ ...m })).sort(compareMembersByName)

  return {
    version,
    serverTime: typeof full.serverTime === 'number' ? full.serverTime : Date.now(),
    lastMutationId: full.lastMutationId ?? null,
    gameState: {
      ...full.gameState,
      version,
    },
    teams,
    members,
  }
}

export function buildMediaUrl(
  memberId: string,
  field: 'avatar' | 'background',
  mediaVersion: number
): string {
  return `/api/members/${encodeURIComponent(memberId)}/media?field=${field}&v=${mediaVersion}`
}

export function isInlineDataUrl(val?: string | null): boolean {
  return typeof val === 'string' && val.startsWith('data:')
}

export function isMediaProxyUrl(val?: string | null): boolean {
  return typeof val === 'string' && val.startsWith('/api/members/')
}

export function parseNonNegativeInt(
  value: unknown,
  fallback: number,
  min: number = 0
): number {
  const lowerBound = Math.max(0, Math.floor(min))
  const safeFallback = Math.max(lowerBound, Math.floor(fallback))

  let parsed: number
  if (typeof value === 'number') {
    parsed = value
  } else if (typeof value === 'string' && value.trim() !== '') {
    parsed = Number.parseInt(value, 10)
  } else {
    return safeFallback
  }

  if (!Number.isFinite(parsed) || Number.isNaN(parsed)) {
    return safeFallback
  }

  const floored = Math.floor(parsed)
  if (floored < lowerBound) {
    return safeFallback
  }

  return floored
}

export function fisherYatesShuffle<T>(
  items: readonly T[],
  rng: () => number = Math.random
): T[] {
  const result = [...items]
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(clampUnitFloat(rng()) * (i + 1))
    const tmp = result[i]
    result[i] = result[j]
    result[j] = tmp
  }
  return result
}

function resolveAddedMedia(
  memberId: string,
  field: 'avatar' | 'background',
  incoming: string | null | undefined,
  mediaVersion: number,
  isOptimistic: boolean
): string | null {
  if (!incoming) return null
  if (isInlineDataUrl(incoming)) {
    return isOptimistic ? incoming : buildMediaUrl(memberId, field, mediaVersion)
  }
  return incoming
}

function resolveUpdatedMedia(
  memberId: string,
  field: 'avatar' | 'background',
  incoming: string | null | undefined,
  existing: string | null,
  nextMediaVersion: number,
  isOptimistic: boolean
): string | null {
  if (incoming === undefined) return existing
  if (incoming === null || incoming === '') return null
  if (isMediaProxyUrl(incoming)) return existing ?? incoming
  if (isInlineDataUrl(incoming)) {
    return isOptimistic ? incoming : buildMediaUrl(memberId, field, nextMediaVersion)
  }
  return incoming
}

export function applyMutation(
  snapshot: NormalizedGameSnapshot,
  mutation: GameMutation,
  opts: ApplyMutationOptions
): ApplyMutationResult {
  const nowMs = opts.nowMs
  const nowIso = new Date(nowMs).toISOString()
  const generateId = opts.generateId ?? defaultGenerateId
  const isOptimistic = opts.isOptimistic === true
  const clientId = mutation.clientId ?? null

  switch (mutation.type) {
    case 'START': {
      if (
        mutation.expectedVersion !== undefined &&
        snapshot.version > mutation.expectedVersion &&
        snapshot.gameState.status !== 'CONFIGURING'
      ) {
        return {
          ok: true,
          alreadyApplied: true,
          next: snapshot,
          event: makeSnapshotEvent(snapshot, nowMs, mutation.mutationId, clientId),
        }
      }

      const nextVersion = snapshot.version + 1
      const nextGameState: GameState = {
        ...snapshot.gameState,
        version: nextVersion,
        status: 'PICKING',
        currentTeamIndex: 0,
        turnStartTime: nowIso,
      }
      const next: NormalizedGameSnapshot = {
        version: nextVersion,
        serverTime: nowMs,
        lastMutationId: mutation.mutationId,
        gameState: nextGameState,
        teams: snapshot.teams.map((t) => ({ ...t })),
        members: snapshot.members.map((m) => ({ ...m })),
      }
      const delta: StateDelta = {
        kind: 'delta',
        version: nextVersion,
        prevVersion: snapshot.version,
        serverTime: nowMs,
        mutationId: mutation.mutationId,
        clientId,
        op: 'START',
        gameState: nextGameState,
      }
      return { ok: true, next, delta, event: delta }
    }

    case 'PICK': {
      if (snapshot.gameState.status !== 'PICKING') {
        return {
          ok: false,
          status: 400,
          error: 'Not in picking phase',
          code: 'NOT_PICKING',
        }
      }

      if (mutation.expectedVersion !== undefined && snapshot.version !== mutation.expectedVersion) {
        return {
          ok: false,
          status: 409,
          error: 'Turn has already been taken',
          code: 'VERSION_CONFLICT',
        }
      }

      const sortedTeams = [...snapshot.teams].sort(compareTeams)
      const currentTeam = sortedTeams[snapshot.gameState.currentTeamIndex]
      if (!currentTeam) {
        return {
          ok: false,
          status: 400,
          error: 'No teams configured',
          code: 'NO_TEAMS',
        }
      }

      if (currentTeam.id !== mutation.teamId) {
        return {
          ok: false,
          status: 400,
          error: 'Not your turn',
          code: 'NOT_YOUR_TURN',
        }
      }

      const targetMember = snapshot.members.find((m) => m.id === mutation.memberId)
      if (!targetMember || targetMember.teamId !== null || targetMember.isBanned) {
        return {
          ok: false,
          status: 409,
          error: 'Member is no longer available',
          code: 'MEMBER_UNAVAILABLE',
        }
      }

      const rawTurnStartMs = snapshot.gameState.turnStartTime
        ? Date.parse(snapshot.gameState.turnStartTime)
        : nowMs
      const turnStartMs = Number.isFinite(rawTurnStartMs) ? rawTurnStartMs : nowMs
      const elapsed = Math.max(0, Math.floor((nowMs - turnStartMs) / 1000))
      const extra = Math.max(0, elapsed - snapshot.gameState.turnDuration)
      const newReserve = Math.max(0, currentTeam.reserveTime - extra)

      const nextMembers = snapshot.members.map((m) =>
        m.id === targetMember.id ? { ...m, teamId: currentTeam.id, pickedAt: nowIso } : { ...m }
      )
      const nextTeams = sortedTeams.map((t) =>
        t.id === currentTeam.id ? { ...t, reserveTime: newReserve } : { ...t }
      )

      const remainingCount = nextMembers.filter((m) => m.teamId === null && !m.isBanned).length
      const nextStatus: GameStatus = remainingCount === 0 ? 'COMPLETED' : 'PICKING'
      const nextVersion = snapshot.version + 1
      const nextTeamIndex = (snapshot.gameState.currentTeamIndex + 1) % sortedTeams.length

      const nextGameState: GameState = {
        ...snapshot.gameState,
        version: nextVersion,
        currentTeamIndex: nextTeamIndex,
        turnStartTime: nowIso,
        status: nextStatus,
      }

      const next: NormalizedGameSnapshot = {
        version: nextVersion,
        serverTime: nowMs,
        lastMutationId: mutation.mutationId,
        gameState: nextGameState,
        teams: nextTeams,
        members: nextMembers,
      }

      const delta: StateDelta = {
        kind: 'delta',
        version: nextVersion,
        prevVersion: snapshot.version,
        serverTime: nowMs,
        mutationId: mutation.mutationId,
        clientId,
        op: 'PICK',
        gameState: nextGameState,
        teamPatch: { id: currentTeam.id, reserveTime: newReserve },
        memberPatch: { id: targetMember.id, teamId: currentTeam.id, pickedAt: nowIso },
      }

      return { ok: true, next, delta, event: delta, pickedMemberId: targetMember.id }
    }

    case 'AUTO_PICK': {
      if (mutation.expectedVersion !== undefined && snapshot.version > mutation.expectedVersion) {
        return {
          ok: true,
          alreadyApplied: true,
          next: snapshot,
          event: makeSnapshotEvent(snapshot, nowMs, mutation.mutationId, clientId),
        }
      }

      if (snapshot.gameState.status !== 'PICKING') {
        return {
          ok: false,
          status: 400,
          error: 'Not in picking phase',
          code: 'NOT_PICKING',
        }
      }

      const sortedTeams = [...snapshot.teams].sort(compareTeams)
      const currentTeam = sortedTeams[snapshot.gameState.currentTeamIndex]
      if (!currentTeam) {
        return {
          ok: false,
          status: 400,
          error: 'No teams configured',
          code: 'NO_TEAMS',
        }
      }

      if (mutation.teamId && currentTeam.id !== mutation.teamId) {
        return {
          ok: false,
          status: 409,
          error: 'Turn has already been taken',
          code: 'TURN_ALREADY_TAKEN',
        }
      }

      const available = snapshot.members
        .filter((m) => m.teamId === null && !m.isBanned)
        .sort(compareMembersByName)

      if (available.length === 0) {
        return {
          ok: true,
          alreadyApplied: true,
          next: snapshot,
          event: makeSnapshotEvent(snapshot, nowMs, mutation.mutationId, clientId),
        }
      }

      const nextVersion = snapshot.version + 1
      const nextTeamIndex = (snapshot.gameState.currentTeamIndex + 1) % sortedTeams.length
      const nextTeams = sortedTeams.map((t) =>
        t.id === currentTeam.id ? { ...t, reserveTime: 0 } : { ...t }
      )

      // When optimistic and multiple candidates exist without a predetermined roll,
      // advance the turn & zero reserve time cleanly without flashing a guessed pick.
      if (isOptimistic && opts.randomFloat === undefined && available.length > 1) {
        const nextGameState: GameState = {
          ...snapshot.gameState,
          version: nextVersion,
          currentTeamIndex: nextTeamIndex,
          turnStartTime: nowIso,
          status: 'PICKING',
        }
        const next: NormalizedGameSnapshot = {
          version: nextVersion,
          serverTime: nowMs,
          lastMutationId: mutation.mutationId,
          gameState: nextGameState,
          teams: nextTeams,
          members: snapshot.members.map((m) => ({ ...m })),
        }
        const delta: StateDelta = {
          kind: 'delta',
          version: nextVersion,
          prevVersion: snapshot.version,
          serverTime: nowMs,
          mutationId: mutation.mutationId,
          clientId,
          op: 'AUTO_PICK',
          gameState: nextGameState,
          teamPatch: { id: currentTeam.id, reserveTime: 0 },
        }
        return { ok: true, next, delta, event: delta }
      }

      const roll = clampUnitFloat(opts.randomFloat ?? Math.random())
      const chosen = available[Math.floor(roll * available.length)]

      const nextMembers = snapshot.members.map((m) =>
        m.id === chosen.id ? { ...m, teamId: currentTeam.id, pickedAt: nowIso } : { ...m }
      )
      const remainingCount = nextMembers.filter((m) => m.teamId === null && !m.isBanned).length
      const nextStatus: GameStatus = remainingCount === 0 ? 'COMPLETED' : 'PICKING'

      const nextGameState: GameState = {
        ...snapshot.gameState,
        version: nextVersion,
        currentTeamIndex: nextTeamIndex,
        turnStartTime: nowIso,
        status: nextStatus,
      }

      const next: NormalizedGameSnapshot = {
        version: nextVersion,
        serverTime: nowMs,
        lastMutationId: mutation.mutationId,
        gameState: nextGameState,
        teams: nextTeams,
        members: nextMembers,
      }

      const delta: StateDelta = {
        kind: 'delta',
        version: nextVersion,
        prevVersion: snapshot.version,
        serverTime: nowMs,
        mutationId: mutation.mutationId,
        clientId,
        op: 'AUTO_PICK',
        gameState: nextGameState,
        teamPatch: { id: currentTeam.id, reserveTime: 0 },
        memberPatch: { id: chosen.id, teamId: currentTeam.id, pickedAt: nowIso },
      }

      return { ok: true, next, delta, event: delta, pickedMemberId: chosen.id }
    }

    case 'RANDOMIZE': {
      const sortedTeams = [...snapshot.teams].sort(compareTeams)
      if (sortedTeams.length === 0) {
        return {
          ok: false,
          status: 400,
          error: 'No teams configured',
          code: 'NO_TEAMS',
        }
      }

      const available = snapshot.members
        .filter((m) => m.teamId === null && !m.isBanned)
        .sort(compareMembersByName)

      let orderedAvailable: Member[]
      if (mutation.shuffledMemberIds && mutation.shuffledMemberIds.length > 0) {
        const availableById = new Map(available.map((m) => [m.id, m]))
        const seen = new Set<string>()
        orderedAvailable = []
        for (const id of mutation.shuffledMemberIds) {
          const found = availableById.get(id)
          if (found && !seen.has(id)) {
            seen.add(id)
            orderedAvailable.push(found)
          }
        }
        for (const member of available) {
          if (!seen.has(member.id)) {
            orderedAvailable.push(member)
          }
        }
      } else {
        const rng = opts.randomFloat !== undefined ? () => opts.randomFloat! : Math.random
        orderedAvailable = fisherYatesShuffle(available, rng)
      }

      const assignedTeamByMemberId = new Map<string, string>()
      orderedAvailable.forEach((member, idx) => {
        const targetTeam = sortedTeams[idx % sortedTeams.length]
        assignedTeamByMemberId.set(member.id, targetTeam.id)
      })

      const nextMembers = snapshot.members.map((m) => {
        const assignedTeamId = assignedTeamByMemberId.get(m.id)
        return assignedTeamId
          ? { ...m, teamId: assignedTeamId, pickedAt: nowIso }
          : { ...m }
      })

      const nextVersion = snapshot.version + 1
      const nextGameState: GameState = {
        ...snapshot.gameState,
        version: nextVersion,
        status: 'COMPLETED',
      }

      const next: NormalizedGameSnapshot = {
        version: nextVersion,
        serverTime: nowMs,
        lastMutationId: mutation.mutationId,
        gameState: nextGameState,
        teams: sortedTeams.map((t) => ({ ...t })),
        members: nextMembers,
      }

      return {
        ok: true,
        next,
        event: makeSnapshotEvent(next, nowMs, mutation.mutationId, clientId),
      }
    }

    case 'CONFIG': {
      const teamCount = parseNonNegativeInt(mutation.teamCount, 2, 1)
      const turnDuration = parseNonNegativeInt(mutation.turnDuration, 30, 0)
      const totalReserveTime = parseNonNegativeInt(mutation.totalReserveTime, 120, 0)
      const rawTeamNames = Array.isArray(mutation.teamNames) ? mutation.teamNames : []

      const nextTeams: TeamSummary[] = []
      for (let i = 0; i < teamCount; i++) {
        const rawName = rawTeamNames[i]
        const name = typeof rawName === 'string' && rawName.trim() !== '' ? rawName : `Team ${i + 1}`
        nextTeams.push({
          id: generateId(),
          name,
          order: i,
          reserveTime: totalReserveTime,
        })
      }

      const nextMembers: Member[] = snapshot.members.map((m) => ({
        ...m,
        teamId: null,
        pickedAt: null,
        isBanned: false,
      }))

      const nextVersion = snapshot.version + 1
      const nextGameState: GameState = {
        ...snapshot.gameState,
        version: nextVersion,
        teamCount,
        turnDuration,
        totalReserveTime,
        status: 'CONFIGURING',
        currentTeamIndex: 0,
        turnStartTime: null,
      }

      const next: NormalizedGameSnapshot = {
        version: nextVersion,
        serverTime: nowMs,
        lastMutationId: mutation.mutationId,
        gameState: nextGameState,
        teams: nextTeams,
        members: nextMembers,
      }

      return {
        ok: true,
        next,
        event: makeSnapshotEvent(next, nowMs, mutation.mutationId, clientId),
      }
    }

    case 'MEMBER_ADD': {
      if (!mutation.name || !mutation.name.trim()) {
        return {
          ok: false,
          status: 400,
          error: 'Member name is required',
          code: 'INVALID_MEMBER_NAME',
        }
      }

      const id = mutation.id || generateId()
      const hasInlineMedia = isInlineDataUrl(mutation.avatar) || isInlineDataUrl(mutation.background)
      const mediaVersion = hasInlineMedia ? 1 : 0

      const newMember: Member = {
        id,
        name: mutation.name,
        info: mutation.info ?? '',
        avatar: resolveAddedMedia(id, 'avatar', mutation.avatar, mediaVersion, isOptimistic),
        background: resolveAddedMedia(id, 'background', mutation.background, mediaVersion, isOptimistic),
        teamId: null,
        isBanned: false,
        pickedAt: null,
        order: 0,
        mediaVersion,
      }

      const nextVersion = snapshot.version + 1
      const nextMembers = [...snapshot.members.map((m) => ({ ...m })), newMember].sort(compareMembersByName)
      const nextGameState: GameState = {
        ...snapshot.gameState,
        version: nextVersion,
      }

      const next: NormalizedGameSnapshot = {
        version: nextVersion,
        serverTime: nowMs,
        lastMutationId: mutation.mutationId,
        gameState: nextGameState,
        teams: snapshot.teams.map((t) => ({ ...t })),
        members: nextMembers,
      }

      return {
        ok: true,
        next,
        event: makeSnapshotEvent(next, nowMs, mutation.mutationId, clientId),
      }
    }

    case 'MEMBER_UPDATE': {
      const existing = snapshot.members.find((m) => m.id === mutation.id)
      if (!existing) {
        return {
          ok: false,
          status: 400,
          error: 'Member not found',
          code: 'MEMBER_NOT_FOUND',
        }
      }

      if (mutation.name !== undefined && !mutation.name.trim()) {
        return {
          ok: false,
          status: 400,
          error: 'Member name is required',
          code: 'INVALID_MEMBER_NAME',
        }
      }

      const hasNewInlineMedia = isInlineDataUrl(mutation.avatar) || isInlineDataUrl(mutation.background)
      const prevMediaVersion = existing.mediaVersion ?? 0
      const nextMediaVersion = hasNewInlineMedia ? prevMediaVersion + 1 : prevMediaVersion

      const updatedMember: Member = {
        ...existing,
        name: mutation.name !== undefined ? mutation.name : existing.name,
        info: mutation.info !== undefined ? mutation.info : existing.info,
        avatar: resolveUpdatedMedia(
          existing.id,
          'avatar',
          mutation.avatar,
          existing.avatar,
          nextMediaVersion,
          isOptimistic
        ),
        background: resolveUpdatedMedia(
          existing.id,
          'background',
          mutation.background,
          existing.background,
          nextMediaVersion,
          isOptimistic
        ),
        mediaVersion: nextMediaVersion,
      }

      const nextVersion = snapshot.version + 1
      const nextMembers = snapshot.members
        .map((m) => (m.id === existing.id ? updatedMember : { ...m }))
        .sort(compareMembersByName)
      const nextGameState: GameState = {
        ...snapshot.gameState,
        version: nextVersion,
      }

      const next: NormalizedGameSnapshot = {
        version: nextVersion,
        serverTime: nowMs,
        lastMutationId: mutation.mutationId,
        gameState: nextGameState,
        teams: snapshot.teams.map((t) => ({ ...t })),
        members: nextMembers,
      }

      return {
        ok: true,
        next,
        event: makeSnapshotEvent(next, nowMs, mutation.mutationId, clientId),
      }
    }

    case 'MEMBER_DELETE': {
      const exists = snapshot.members.some((m) => m.id === mutation.id)
      if (!exists) {
        return {
          ok: true,
          alreadyApplied: true,
          next: snapshot,
          event: makeSnapshotEvent(snapshot, nowMs, mutation.mutationId, clientId),
        }
      }

      const nextVersion = snapshot.version + 1
      const nextMembers = snapshot.members
        .filter((m) => m.id !== mutation.id)
        .map((m) => ({ ...m }))
      const nextGameState: GameState = {
        ...snapshot.gameState,
        version: nextVersion,
      }

      const next: NormalizedGameSnapshot = {
        version: nextVersion,
        serverTime: nowMs,
        lastMutationId: mutation.mutationId,
        gameState: nextGameState,
        teams: snapshot.teams.map((t) => ({ ...t })),
        members: nextMembers,
      }

      return {
        ok: true,
        next,
        event: makeSnapshotEvent(next, nowMs, mutation.mutationId, clientId),
      }
    }
  }
}

export function applyRealtimeEvent(
  current: NormalizedGameSnapshot | null,
  event: RealtimeEvent
): ApplyRealtimeEventResult {
  if (current && event.version <= current.version) {
    return { applied: false, needsFullSync: false, next: current }
  }

  if (event.kind === 'invalidate') {
    return { applied: false, needsFullSync: true, next: current }
  }

  if (event.kind === 'snapshot') {
    const rawTeams = Array.isArray(event.snapshot.teams) ? event.snapshot.teams : []
    const rawMembers = Array.isArray(event.snapshot.members) ? event.snapshot.members : []
    const next: NormalizedGameSnapshot = {
      version: event.version,
      serverTime: event.serverTime,
      lastMutationId: event.mutationId ?? event.snapshot.lastMutationId ?? null,
      gameState: {
        ...event.snapshot.gameState,
        version: event.version,
      },
      teams: [...rawTeams].map((t) => ({ ...t })).sort(compareTeams),
      members: [...rawMembers].map((m) => ({ ...m })).sort(compareMembersByName),
    }
    return { applied: true, needsFullSync: false, next }
  }

  // event.kind === 'delta'
  if (!current || current.version !== event.prevVersion) {
    return { applied: false, needsFullSync: true, next: current }
  }

  const nextTeams = event.teamPatch
    ? current.teams.map((t) =>
        t.id === event.teamPatch!.id
          ? { ...t, reserveTime: event.teamPatch!.reserveTime }
          : { ...t }
      )
    : current.teams.map((t) => ({ ...t }))

  const nextMembers = event.memberPatch
    ? current.members.map((m) =>
        m.id === event.memberPatch!.id
          ? {
              ...m,
              teamId: event.memberPatch!.teamId,
              pickedAt: event.memberPatch!.pickedAt,
            }
          : { ...m }
      )
    : current.members.map((m) => ({ ...m }))

  const next: NormalizedGameSnapshot = {
    version: event.version,
    serverTime: event.serverTime,
    lastMutationId: event.mutationId ?? current.lastMutationId ?? null,
    gameState: {
      ...event.gameState,
      version: event.version,
    },
    teams: nextTeams,
    members: nextMembers,
  }

  return { applied: true, needsFullSync: false, next }
}
