import { useCallback, useEffect, useRef, useState } from 'react'
import Pusher, { type Channel } from 'pusher-js'
import {
  applyMutation,
  applyRealtimeEvent,
  fisherYatesShuffle,
  materializeState,
  normalizeState,
} from '@/lib/gameEngine'
import type {
  FullGameState,
  GameData,
  GameMutation,
  GameState,
  Member,
  MutationErrorResponse,
  MutationSuccessResponse,
  NormalizedGameSnapshot,
  RealtimeEvent,
  SpeculativeClientEvent,
  Team,
  TeamSummary,
} from '@/types'

export type SyncMode = 'SSE' | 'PUSHER' | 'POLLING'
export type ConnectionStatus = 'connecting' | 'connected' | 'reconnecting' | 'fallback'

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never

export type DispatchMutationInput = DistributiveOmit<GameMutation, 'mutationId' | 'clientId'> & {
  mutationId?: string
}

export interface DispatchMutationResult {
  ok: boolean
  error?: string
}

export interface UseGameStateReturn {
  gameState: GameState | undefined
  teams: Team[]
  members: Member[]
  version: number
  serverOffset: number
  isLoading: boolean
  isError: unknown
  syncMode: SyncMode
  connectionStatus: ConnectionStatus
  pendingCount: number
  dispatchMutation: (mutation: DispatchMutationInput) => Promise<DispatchMutationResult>
  mutate: (
    data?: GameData | Record<string, unknown>,
    opts?: { revalidate?: boolean }
  ) => Promise<void> | void
}

interface PendingEntry {
  mutation: GameMutation
  enqueuedAt: number
  acknowledged: boolean
  teamOrder?: number
  resolve: (result: DispatchMutationResult) => void
}

interface TentativeRemoteEntry {
  event: SpeculativeClientEvent
  expiresAt: number
}

const EMPTY_TEAMS: Team[] = []
const EMPTY_MEMBERS: Member[] = []
const TENTATIVE_TTL_MS = 5000
const MAX_SPECULATIVE_EVENT_CHARS = 8000
const SSE_FALLBACK_POLL_MS = 1500
const LEGACY_POLL_MS = 1000
const MAX_SSE_BACKOFF_MS = 5000
const INITIAL_SSE_BACKOFF_MS = 200
const OFFSET_PUBLISH_THRESHOLD_MS = 50

function generateUniqueId(prefix = 'mut'): string {
  if (typeof globalThis.crypto !== 'undefined' && typeof globalThis.crypto.randomUUID === 'function') {
    return globalThis.crypto.randomUUID()
  }
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`
}

function makeDeterministicIdGen(seed: string): () => string {
  let counter = 0
  return () => `${seed}_opt_${counter++}`
}

function parseServerTimeMs(raw: unknown): number | null {
  if (typeof raw === 'number' && Number.isFinite(raw)) {
    return raw
  }
  if (typeof raw === 'string' && raw.length > 0) {
    const parsed = Date.parse(raw)
    if (Number.isFinite(parsed)) {
      return parsed
    }
  }
  return null
}

function resolveSyncMode(): SyncMode {
  const configured = (process.env.NEXT_PUBLIC_SYNC_METHOD || 'AUTO').trim().toUpperCase()
  if (configured === 'SSE') return 'SSE'
  if (configured === 'PUSHER') return 'PUSHER'
  if (configured === 'POLLING') return 'POLLING'
  const pusherKey = process.env.NEXT_PUBLIC_PUSHER_KEY?.trim()
  return pusherKey ? 'PUSHER' : 'SSE'
}

function coerceToNormalizedSnapshot(
  raw: Record<string, unknown>,
  fallbackVersion: number
): NormalizedGameSnapshot | null {
  const rawGameState = raw.gameState as Partial<GameState> | undefined
  if (!rawGameState || typeof rawGameState !== 'object') {
    return null
  }

  const versionCandidate =
    typeof raw.version === 'number' && Number.isFinite(raw.version)
      ? raw.version
      : typeof rawGameState.version === 'number' && Number.isFinite(rawGameState.version)
        ? rawGameState.version
        : fallbackVersion

  const serverTimeMs = parseServerTimeMs(raw.serverTime) ?? Date.now()
  const rawTeams = Array.isArray(raw.teams) ? (raw.teams as Team[]) : []
  const rawMembers = Array.isArray(raw.members) ? (raw.members as Member[]) : []

  const full: FullGameState = {
    version: versionCandidate,
    serverTime: serverTimeMs,
    lastMutationId: typeof raw.lastMutationId === 'string' ? raw.lastMutationId : null,
    gameState: {
      id: rawGameState.id ?? 'singleton',
      version: versionCandidate,
      currentTeamIndex: rawGameState.currentTeamIndex ?? 0,
      turnStartTime: rawGameState.turnStartTime ?? null,
      status: rawGameState.status ?? 'CONFIGURING',
      turnDuration: rawGameState.turnDuration ?? 30,
      totalReserveTime: rawGameState.totalReserveTime ?? 120,
      teamCount: rawGameState.teamCount ?? (rawTeams.length || 2),
    },
    teams: rawTeams,
    members: rawMembers,
  }

  return normalizeState(full)
}

function buildHttpRequestForMutation(
  mutation: GameMutation,
  confirmedVersion: number | undefined
): { url: string; body: Record<string, unknown> } {
  switch (mutation.type) {
    case 'START':
      return {
        url: '/api/pick',
        body: {
          status: 'START',
          mutationId: mutation.mutationId,
          clientId: mutation.clientId,
          expectedVersion: mutation.expectedVersion ?? confirmedVersion,
        },
      }
    case 'PICK':
      return {
        url: '/api/pick',
        body: {
          memberId: mutation.memberId,
          teamId: mutation.teamId,
          mutationId: mutation.mutationId,
          clientId: mutation.clientId,
          expectedVersion: confirmedVersion ?? mutation.expectedVersion,
        },
      }
    case 'AUTO_PICK':
      return {
        url: '/api/pick',
        body: {
          action: 'AUTO_PICK',
          teamId: mutation.teamId,
          mutationId: mutation.mutationId,
          clientId: mutation.clientId,
          expectedVersion: mutation.expectedVersion ?? confirmedVersion,
        },
      }
    case 'CONFIG':
      return {
        url: '/api/config',
        body: {
          teamCount: mutation.teamCount,
          turnDuration: mutation.turnDuration,
          totalReserveTime: mutation.totalReserveTime,
          teamNames: mutation.teamNames,
          mutationId: mutation.mutationId,
          clientId: mutation.clientId,
          expectedVersion: mutation.expectedVersion,
        },
      }
    case 'MEMBER_ADD':
      return {
        url: '/api/members',
        body: {
          action: 'ADD',
          id: mutation.id,
          name: mutation.name,
          info: mutation.info ?? '',
          avatar: mutation.avatar ?? null,
          background: mutation.background ?? null,
          mutationId: mutation.mutationId,
          clientId: mutation.clientId,
        },
      }
    case 'MEMBER_UPDATE':
      return {
        url: '/api/members',
        body: {
          action: 'UPDATE',
          id: mutation.id,
          memberId: mutation.id,
          name: mutation.name,
          info: mutation.info,
          avatar: mutation.avatar,
          background: mutation.background,
          mutationId: mutation.mutationId,
          clientId: mutation.clientId,
        },
      }
    case 'MEMBER_DELETE':
      return {
        url: '/api/members',
        body: {
          action: 'DELETE',
          id: mutation.id,
          memberId: mutation.id,
          mutationId: mutation.mutationId,
          clientId: mutation.clientId,
        },
      }
    case 'RANDOMIZE':
      return {
        url: '/api/randomize',
        body: {
          mutationId: mutation.mutationId,
          clientId: mutation.clientId,
          expectedVersion: mutation.expectedVersion,
          shuffledMemberIds: mutation.shuffledMemberIds,
        },
      }
  }
}

function isRealtimeEventPayload(payload: unknown): payload is RealtimeEvent {
  if (!payload || typeof payload !== 'object') return false
  const candidate = payload as Record<string, unknown>
  return (
    (candidate.kind === 'delta' || candidate.kind === 'snapshot' || candidate.kind === 'invalidate') &&
    typeof candidate.version === 'number'
  )
}

function remapMutationTeamId(
  mutation: GameMutation,
  teamOrder: number | undefined,
  teams: readonly TeamSummary[]
): GameMutation {
  if (teamOrder === undefined) return mutation
  if (mutation.type !== 'PICK' && mutation.type !== 'AUTO_PICK') return mutation
  const targetTeamId = mutation.teamId
  if (!targetTeamId) return mutation
  if (teams.some((t) => t.id === targetTeamId)) return mutation
  const remapped = teams.find((t) => t.order === teamOrder)
  return remapped ? { ...mutation, teamId: remapped.id } : mutation
}

function sanitizeMutationForSpeculativeBroadcast(mutation: GameMutation): GameMutation {
  if (mutation.type !== 'MEMBER_ADD' && mutation.type !== 'MEMBER_UPDATE') {
    return mutation
  }
  const stripDataUrl = (val: string | null | undefined): string | null | undefined =>
    typeof val === 'string' && val.startsWith('data:') ? null : val
  return {
    ...mutation,
    avatar: stripDataUrl(mutation.avatar),
    background: stripDataUrl(mutation.background),
  }
}

export function useGameState(): UseGameStateReturn {
  const syncMode = resolveSyncMode()

  const [displayState, setDisplayState] = useState<FullGameState | null>(null)
  const [error, setError] = useState<unknown>(undefined)
  const [serverOffset, setServerOffset] = useState(0)
  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>(
    syncMode === 'POLLING' ? 'fallback' : 'connecting'
  )
  const [pendingCount, setPendingCount] = useState(0)

  const clientIdRef = useRef<string | null>(null)
  const isMountedRef = useRef(true)
  const confirmedRef = useRef<NormalizedGameSnapshot | null>(null)
  const pendingQueueRef = useRef<PendingEntry[]>([])
  const tentativeRemoteRef = useRef<Map<string, TentativeRemoteEntry>>(new Map())
  const tentativeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const isFlushingRef = useRef(false)
  const inFlightFetchRef = useRef<Promise<void> | null>(null)
  const serverOffsetRef = useRef(0)
  const publishedOffsetRef = useRef(0)
  const hasServerOffsetRef = useRef(false)
  const privateChannelRef = useRef<Channel | null>(null)
  const privateChannelReadyRef = useRef(false)

  const getClientId = useCallback(() => {
    if (!clientIdRef.current) {
      clientIdRef.current = generateUniqueId('client')
    }
    return clientIdRef.current
  }, [])

  const updateServerOffset = useCallback((serverTimeMs: number, rttMs?: number) => {
    if (!Number.isFinite(serverTimeMs)) return
    const now = Date.now()
    const sample =
      typeof rttMs === 'number' && Number.isFinite(rttMs)
        ? serverTimeMs + Math.max(0, rttMs) / 2 - now
        : serverTimeMs - now

    if (!hasServerOffsetRef.current) {
      hasServerOffsetRef.current = true
      const rounded = Math.round(sample)
      serverOffsetRef.current = rounded
      publishedOffsetRef.current = rounded
      if (isMountedRef.current) {
        setServerOffset(rounded)
      }
      return
    }

    const alpha = typeof rttMs === 'number' ? 0.25 : 0.15
    const blended = Math.round(serverOffsetRef.current * (1 - alpha) + sample * alpha)
    serverOffsetRef.current = blended
    if (Math.abs(blended - publishedOffsetRef.current) >= OFFSET_PUBLISH_THRESHOLD_MS) {
      publishedOffsetRef.current = blended
      if (isMountedRef.current) {
        setServerOffset(blended)
      }
    }
  }, [])

  const recomputeDisplayState = useCallback(() => {
    const confirmed = confirmedRef.current
    if (!confirmed) {
      if (isMountedRef.current) {
        setDisplayState(null)
        setPendingCount(pendingQueueRef.current.length)
      }
      return
    }

    const nowReal = Date.now()
    let working: NormalizedGameSnapshot = confirmed
    let nextTentativeExpiry: number | null = null

    // Layer 2a: replay non-expired, non-superseded speculative peer events from other clients
    const activeTentative: SpeculativeClientEvent[] = []
    for (const [mutationId, entry] of tentativeRemoteRef.current.entries()) {
      if (entry.expiresAt <= nowReal || entry.event.baseVersion < confirmed.version) {
        tentativeRemoteRef.current.delete(mutationId)
      } else {
        activeTentative.push(entry.event)
        if (nextTentativeExpiry === null || entry.expiresAt < nextTentativeExpiry) {
          nextTentativeExpiry = entry.expiresAt
        }
      }
    }

    if (tentativeTimerRef.current !== null) {
      clearTimeout(tentativeTimerRef.current)
      tentativeTimerRef.current = null
    }
    if (nextTentativeExpiry !== null) {
      const delay = Math.max(10, nextTentativeExpiry - nowReal)
      tentativeTimerRef.current = setTimeout(() => {
        tentativeTimerRef.current = null
        recomputeDisplayState()
      }, delay)
    }

    activeTentative.sort((a, b) => a.sentAt - b.sentAt)
    const syncedNow = nowReal + serverOffsetRef.current
    for (const spec of activeTentative) {
      const replayMut = { ...spec.mutation, expectedVersion: undefined } as GameMutation
      const applied = applyMutation(working, replayMut, {
        nowMs: Math.max(working.serverTime, syncedNow),
        isOptimistic: true,
        generateId: makeDeterministicIdGen(spec.mutationId),
      })
      if (applied.ok) {
        working = applied.next
      }
    }

    // Layer 2b: replay unacknowledged local FIFO pending queue
    let unackedCount = 0
    for (const entry of pendingQueueRef.current) {
      if (entry.acknowledged) continue
      unackedCount++

      const mut = remapMutationTeamId(entry.mutation, entry.teamOrder, working.teams)
      if (mut !== entry.mutation) {
        entry.mutation = mut
      }

      const replayMut = 'expectedVersion' in mut ? ({ ...mut, expectedVersion: undefined } as GameMutation) : mut
      const mutTime = Math.max(working.serverTime, entry.enqueuedAt + serverOffsetRef.current)
      const applied = applyMutation(working, replayMut, {
        nowMs: mutTime,
        isOptimistic: true,
        generateId: makeDeterministicIdGen(mut.mutationId),
      })
      if (applied.ok) {
        working = applied.next
      }
    }

    const materialized = materializeState(working)
    if (isMountedRef.current) {
      setDisplayState(materialized)
      setPendingCount(unackedCount)
    }
  }, [])

  const markMutationAcknowledged = useCallback((mutationId: string | null | undefined) => {
    if (!mutationId) return
    tentativeRemoteRef.current.delete(mutationId)
    for (const entry of pendingQueueRef.current) {
      if (entry.mutation.mutationId === mutationId) {
        entry.acknowledged = true
      }
    }
  }, [])

  const acceptAuthoritativeSnapshot = useCallback(
    (
      snapshot: NormalizedGameSnapshot,
      opts?: { rttMs?: number; acknowledgedMutationId?: string | null }
    ): boolean => {
      const current = confirmedRef.current
      const isNewer = !current || snapshot.version > current.version

      if (isNewer) {
        confirmedRef.current = snapshot
        updateServerOffset(snapshot.serverTime, opts?.rttMs)
        if (isMountedRef.current) {
          setError(undefined)
        }
      } else if (current && snapshot.version === current.version && opts?.rttMs !== undefined) {
        updateServerOffset(snapshot.serverTime, opts.rttMs)
      }

      markMutationAcknowledged(opts?.acknowledgedMutationId ?? snapshot.lastMutationId)

      if (isNewer || opts?.acknowledgedMutationId) {
        recomputeDisplayState()
      }

      return isNewer
    },
    [markMutationAcknowledged, recomputeDisplayState, updateServerOffset]
  )

  const fetchLatestState = useCallback(
    async (opts?: { forceFull?: boolean }): Promise<void> => {
      const forceFull = opts?.forceFull === true
      if (inFlightFetchRef.current && !forceFull) {
        return inFlightFetchRef.current
      }

      const requestPromise = (async () => {
        const sinceVersion = !forceFull && confirmedRef.current ? confirmedRef.current.version : null
        const url = sinceVersion !== null ? `/api/state?sinceVersion=${sinceVersion}` : '/api/state'
        const t0 = Date.now()
        try {
          const res = await fetch(url, { cache: 'no-store' })
          if (!res.ok) {
            throw new Error(`Failed to fetch state (HTTP ${res.status})`)
          }
          const json = (await res.json()) as Record<string, unknown>
          const rttMs = Math.max(0, Date.now() - t0)

          if (json.unchanged === true) {
            const serverTimeMs = parseServerTimeMs(json.serverTime)
            if (serverTimeMs !== null) {
              updateServerOffset(serverTimeMs, rttMs)
            }
            if (isMountedRef.current) {
              setError(undefined)
            }
            return
          }

          const snapshot = coerceToNormalizedSnapshot(json, (confirmedRef.current?.version ?? 0) + 1)
          if (!snapshot) {
            throw new Error('Invalid state response from /api/state')
          }

          acceptAuthoritativeSnapshot(snapshot, { rttMs })
        } catch (err) {
          if (isMountedRef.current && !confirmedRef.current) {
            setError(err instanceof Error ? err : new Error('Failed to fetch state'))
          }
        }
      })()

      inFlightFetchRef.current = requestPromise
      try {
        await requestPromise
      } finally {
        if (inFlightFetchRef.current === requestPromise) {
          inFlightFetchRef.current = null
        }
      }
    },
    [acceptAuthoritativeSnapshot, updateServerOffset]
  )

  const acceptRealtimeEvent = useCallback(
    (event: RealtimeEvent) => {
      if ('mutationId' in event && event.mutationId) {
        tentativeRemoteRef.current.delete(event.mutationId)
      }

      const result = applyRealtimeEvent(confirmedRef.current, event)
      if (result.needsFullSync) {
        void fetchLatestState({ forceFull: true })
        return
      }

      if (!result.applied || !result.next) {
        return
      }

      confirmedRef.current = result.next
      updateServerOffset(event.serverTime)
      if (isMountedRef.current) {
        setError(undefined)
      }
      if ('mutationId' in event) {
        markMutationAcknowledged(event.mutationId)
      }
      recomputeDisplayState()
    },
    [fetchLatestState, markMutationAcknowledged, recomputeDisplayState, updateServerOffset]
  )

  const pruneInvalidQueuedMutations = useCallback(() => {
    const confirmed = confirmedRef.current
    if (!confirmed || pendingQueueRef.current.length === 0) return

    let working = confirmed
    const surviving: PendingEntry[] = []

    for (const entry of pendingQueueRef.current) {
      if (entry.acknowledged) {
        surviving.push(entry)
        continue
      }

      const mut = remapMutationTeamId(entry.mutation, entry.teamOrder, working.teams)
      if (mut !== entry.mutation) {
        entry.mutation = mut
      }

      const replayMut = 'expectedVersion' in mut ? ({ ...mut, expectedVersion: undefined } as GameMutation) : mut
      const res = applyMutation(working, replayMut, {
        nowMs: Math.max(working.serverTime, entry.enqueuedAt + serverOffsetRef.current),
        isOptimistic: true,
        generateId: makeDeterministicIdGen(mut.mutationId),
      })

      if (res.ok) {
        working = res.next
        surviving.push(entry)
      } else {
        entry.resolve({ ok: false, error: res.error })
      }
    }

    pendingQueueRef.current = surviving
  }, [])

  const flushQueue = useCallback(async () => {
    if (isFlushingRef.current) return
    isFlushingRef.current = true

    try {
      while (pendingQueueRef.current.length > 0) {
        const head = pendingQueueRef.current[0]
        const confirmed = confirmedRef.current

        // Remap optimistic teamId created by an earlier CONFIG mutation to the real server teamId
        if (confirmed) {
          head.mutation = remapMutationTeamId(head.mutation, head.teamOrder, confirmed.teams)
        }

        const { url, body } = buildHttpRequestForMutation(head.mutation, confirmed?.version)
        const t0 = Date.now()

        try {
          const res = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
          })
          const rttMs = Math.max(0, Date.now() - t0)

          let json: (MutationSuccessResponse | MutationErrorResponse) & Record<string, unknown> = {
            error: `HTTP ${res.status}`,
          }
          try {
            json = (await res.json()) as (MutationSuccessResponse | MutationErrorResponse) &
              Record<string, unknown>
          } catch {
            // Non-JSON error body handled below
          }

          if (res.ok) {
            pendingQueueRef.current.shift()
            const snapshot =
              json.snapshot && typeof json.snapshot === 'object'
                ? (json.snapshot as NormalizedGameSnapshot)
                : coerceToNormalizedSnapshot(json, (confirmedRef.current?.version ?? 0) + 1)

            if (snapshot) {
              acceptAuthoritativeSnapshot(snapshot, {
                rttMs,
                acknowledgedMutationId: head.mutation.mutationId,
              })
            } else {
              recomputeDisplayState()
              void fetchLatestState({ forceFull: true })
            }

            head.resolve({ ok: true })
          } else {
            pendingQueueRef.current.shift()
            const errorMessage =
              typeof json.error === 'string' && json.error.length > 0
                ? json.error
                : `Mutation failed (HTTP ${res.status})`

            const authoritative = coerceToNormalizedSnapshot(
              json,
              confirmedRef.current?.version ?? 1
            )
            if (authoritative) {
              acceptAuthoritativeSnapshot(authoritative, { rttMs })
              pruneInvalidQueuedMutations()
              recomputeDisplayState()
            } else {
              recomputeDisplayState()
              void fetchLatestState({ forceFull: true })
            }

            head.resolve({ ok: false, error: errorMessage })
          }
        } catch (err) {
          pendingQueueRef.current.shift()
          recomputeDisplayState()
          void fetchLatestState({ forceFull: true })
          head.resolve({
            ok: false,
            error: err instanceof Error ? err.message : 'Network error',
          })
        }
      }
    } finally {
      isFlushingRef.current = false
      // Guard against items enqueued right at loop exit
      if (pendingQueueRef.current.length > 0 && isMountedRef.current) {
        void flushQueue()
      }
    }
  }, [
    acceptAuthoritativeSnapshot,
    fetchLatestState,
    pruneInvalidQueuedMutations,
    recomputeDisplayState,
  ])

  const dispatchMutation = useCallback(
    (input: DispatchMutationInput): Promise<DispatchMutationResult> => {
      const clientId = getClientId()
      const mutationId = input.mutationId || generateUniqueId('mut')
      const enqueuedAt = Date.now()

      let fullMutation: GameMutation = {
        ...input,
        mutationId,
        clientId,
      } as GameMutation

      // Compute current optimistic snapshot to derive deterministic helper metadata
      let currentDisplay: NormalizedGameSnapshot | null = confirmedRef.current
      if (currentDisplay) {
        for (const entry of pendingQueueRef.current) {
          if (entry.acknowledged) continue
          const replayMut =
            'expectedVersion' in entry.mutation
              ? ({ ...entry.mutation, expectedVersion: undefined } as GameMutation)
              : entry.mutation
          const res = applyMutation(currentDisplay, replayMut, {
            nowMs: Math.max(currentDisplay.serverTime, entry.enqueuedAt + serverOffsetRef.current),
            isOptimistic: true,
            generateId: makeDeterministicIdGen(entry.mutation.mutationId),
          })
          if (res.ok) {
            currentDisplay = res.next
          }
        }
      }

      // Generate stable client UUID for MEMBER_ADD if omitted
      if (fullMutation.type === 'MEMBER_ADD' && !fullMutation.id) {
        fullMutation = { ...fullMutation, id: generateUniqueId('mem') }
      }

      // Pre-compute deterministic shuffle order for RANDOMIZE so optimistic UI matches server 1:1
      if (
        fullMutation.type === 'RANDOMIZE' &&
        (!fullMutation.shuffledMemberIds || fullMutation.shuffledMemberIds.length === 0) &&
        currentDisplay
      ) {
        const availableIds = currentDisplay.members
          .filter((m) => m.teamId === null && !m.isBanned)
          .map((m) => m.id)
        if (availableIds.length > 0) {
          fullMutation = {
            ...fullMutation,
            shuffledMemberIds: fisherYatesShuffle(availableIds),
          }
        }
      }

      // Capture target team order so PICK/AUTO_PICK queued behind CONFIG remaps cleanly to real server team ID
      let teamOrder: number | undefined
      if (
        (fullMutation.type === 'PICK' || fullMutation.type === 'AUTO_PICK') &&
        fullMutation.teamId &&
        currentDisplay
      ) {
        const matchedTeam = currentDisplay.teams.find((t) => t.id === fullMutation.teamId)
        if (matchedTeam) {
          teamOrder = matchedTeam.order
        }
      }

      return new Promise<DispatchMutationResult>((resolve) => {
        pendingQueueRef.current.push({
          mutation: fullMutation,
          enqueuedAt,
          acknowledged: false,
          teamOrder,
          resolve,
        })

        // Synchronous optimistic recompute (<2ms)
        recomputeDisplayState()

        // Optional Dual-Path speculative peer broadcast over Pusher Private Channel
        if (privateChannelReadyRef.current && privateChannelRef.current) {
          try {
            const sanitized = sanitizeMutationForSpeculativeBroadcast(fullMutation)
            const speculative: SpeculativeClientEvent = {
              mutationId,
              clientId,
              baseVersion: confirmedRef.current?.version ?? 0,
              sentAt: enqueuedAt,
              mutation: sanitized,
            }
            if (JSON.stringify(speculative).length <= MAX_SPECULATIVE_EVENT_CHARS) {
              privateChannelRef.current.trigger('client-speculative-op', speculative)
            }
          } catch {
            // Silently ignore if Pusher Client Events are disabled in dashboard
          }
        }

        void flushQueue()
      })
    },
    [flushQueue, getClientId, recomputeDisplayState]
  )

  const mutate = useCallback(
    (data?: GameData | Record<string, unknown>, opts?: { revalidate?: boolean }) => {
      if (data && typeof data === 'object' && 'gameState' in data) {
        const snapshot = coerceToNormalizedSnapshot(
          data as Record<string, unknown>,
          (confirmedRef.current?.version ?? 0) + 1
        )
        if (snapshot) {
          acceptAuthoritativeSnapshot(snapshot)
        }
        if (opts?.revalidate === false) {
          return
        }
      }
      return fetchLatestState({ forceFull: true })
    },
    [acceptAuthoritativeSnapshot, fetchLatestState]
  )

  // Main transport + initial hydration + focus/visibility reconciliation effect
  useEffect(() => {
    isMountedRef.current = true
    const cleanups: Array<() => void> = []

    // Initial full hydration
    void fetchLatestState({ forceFull: true })

    // Focus, visibility, and network reconnect lightweight catch-up
    const handleReconcile = () => {
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return
      void fetchLatestState({ forceFull: false })
    }

    if (typeof window !== 'undefined') {
      window.addEventListener('focus', handleReconcile)
      window.addEventListener('online', handleReconcile)
      cleanups.push(() => {
        window.removeEventListener('focus', handleReconcile)
        window.removeEventListener('online', handleReconcile)
      })
    }
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', handleReconcile)
      cleanups.push(() => {
        document.removeEventListener('visibilitychange', handleReconcile)
      })
    }

    const startSseTransport = () => {
      let eventSource: EventSource | null = null
      let reconnectTimer: ReturnType<typeof setTimeout> | null = null
      let fallbackPollTimer: ReturnType<typeof setInterval> | null = null
      let consecutiveFailures = 0
      let closed = false

      const stopFallbackPolling = () => {
        if (fallbackPollTimer !== null) {
          clearInterval(fallbackPollTimer)
          fallbackPollTimer = null
        }
      }

      const startFallbackPolling = () => {
        if (fallbackPollTimer !== null) return
        fallbackPollTimer = setInterval(() => {
          void fetchLatestState({ forceFull: false })
        }, SSE_FALLBACK_POLL_MS)
      }

      if (typeof EventSource === 'undefined') {
        setConnectionStatus('fallback')
        startFallbackPolling()
        cleanups.push(stopFallbackPolling)
        return
      }

      const clearReconnectTimer = () => {
        if (reconnectTimer !== null) {
          clearTimeout(reconnectTimer)
          reconnectTimer = null
        }
      }

      const scheduleReconnect = (delayMs: number) => {
        if (closed) return
        clearReconnectTimer()
        reconnectTimer = setTimeout(() => {
          reconnectTimer = null
          connect()
        }, delayMs)
      }

      const connect = () => {
        if (closed) return
        clearReconnectTimer()
        if (eventSource) {
          const prev = eventSource
          eventSource = null
          prev.close()
        }

        const since = confirmedRef.current?.version ?? 0
        const es = new EventSource(`/api/stream?sinceVersion=${since}`)
        eventSource = es

        es.addEventListener('connected', (evt) => {
          if (closed || eventSource !== es) return
          consecutiveFailures = 0
          stopFallbackPolling()
          setConnectionStatus('connected')
          try {
            const payload = JSON.parse((evt as MessageEvent).data) as {
              version?: number
              serverTime?: number
            }
            if (typeof payload.serverTime === 'number') {
              updateServerOffset(payload.serverTime)
            }
            if (
              typeof payload.version === 'number' &&
              payload.version > (confirmedRef.current?.version ?? 0)
            ) {
              void fetchLatestState({ forceFull: true })
            }
          } catch {
            // Ignore malformed keepalive metadata
          }
        })

        es.addEventListener('state', (evt) => {
          if (closed || eventSource !== es) return
          consecutiveFailures = 0
          stopFallbackPolling()
          setConnectionStatus('connected')
          try {
            const parsed = JSON.parse((evt as MessageEvent).data) as unknown
            if (isRealtimeEventPayload(parsed)) {
              acceptRealtimeEvent(parsed)
            } else {
              void fetchLatestState({ forceFull: true })
            }
          } catch {
            void fetchLatestState({ forceFull: true })
          }
        })

        es.addEventListener('reconnect', () => {
          if (closed || eventSource !== es) return
          eventSource = null
          es.close()
          scheduleReconnect(50)
        })

        es.onerror = () => {
          if (closed || eventSource !== es) return
          eventSource = null
          es.close()
          consecutiveFailures += 1
          if (consecutiveFailures >= 3) {
            setConnectionStatus('fallback')
            startFallbackPolling()
          } else {
            setConnectionStatus('reconnecting')
          }

          const delay = Math.min(
            MAX_SSE_BACKOFF_MS,
            INITIAL_SSE_BACKOFF_MS * Math.pow(2, consecutiveFailures - 1)
          )
          scheduleReconnect(delay)
        }
      }

      connect()

      cleanups.push(() => {
        closed = true
        if (reconnectTimer !== null) {
          clearTimeout(reconnectTimer)
          reconnectTimer = null
        }
        stopFallbackPolling()
        if (eventSource) {
          eventSource.close()
          eventSource = null
        }
      })
    }

    if (syncMode === 'POLLING') {
      setConnectionStatus('fallback')
      const interval = setInterval(() => {
        void fetchLatestState({ forceFull: false })
      }, LEGACY_POLL_MS)
      cleanups.push(() => clearInterval(interval))
    } else if (syncMode === 'PUSHER') {
      const pusherKey = process.env.NEXT_PUBLIC_PUSHER_KEY?.trim()
      const cluster = process.env.NEXT_PUBLIC_PUSHER_CLUSTER?.trim()

      if (!pusherKey || !cluster) {
        console.warn('Pusher keys missing, falling back to SSE sync')
        startSseTransport()
      } else {
        const pusher = new Pusher(pusherKey, {
          cluster,
          authEndpoint: '/api/pusher/auth',
          channelAuthorization: {
            endpoint: '/api/pusher/auth',
            transport: 'ajax',
          },
        })

        let hadConnectedOnce = false
        if (pusher.connection && typeof pusher.connection.bind === 'function') {
          pusher.connection.bind('state_change', (states: { current: string }) => {
            if (!isMountedRef.current) return
            if (states.current === 'connected') {
              setConnectionStatus('connected')
              if (hadConnectedOnce) {
                void fetchLatestState({ forceFull: false })
              }
              hadConnectedOnce = true
            } else if (states.current === 'connecting') {
              setConnectionStatus(hadConnectedOnce ? 'reconnecting' : 'connecting')
            } else {
              setConnectionStatus('reconnecting')
            }
          })
        }

        const publicChannel = pusher.subscribe('banpick-channel')
        publicChannel.bind('state-update', (payload: unknown) => {
          if (isRealtimeEventPayload(payload)) {
            acceptRealtimeEvent(payload)
            return
          }
          // Backwards compatibility for legacy `{ state, timestamp }` Pusher payloads
          if (payload && typeof payload === 'object' && 'state' in payload) {
            const legacy = payload as { state?: Record<string, unknown>; timestamp?: number }
            if (legacy.state) {
              const snapshot = coerceToNormalizedSnapshot(
                { ...legacy.state, serverTime: legacy.timestamp ?? Date.now() },
                (confirmedRef.current?.version ?? 0) + 1
              )
              if (snapshot) {
                acceptAuthoritativeSnapshot(snapshot)
                return
              }
            }
          }
          void fetchLatestState({ forceFull: true })
        })

        // Best-effort Dual-Path private channel for ultra-low-latency speculative peer events
        try {
          const privateChannel = pusher.subscribe('private-banpick-channel')
          privateChannelRef.current = privateChannel
          privateChannel.bind('pusher:subscription_succeeded', () => {
            privateChannelReadyRef.current = true
          })
          privateChannel.bind('pusher:subscription_error', () => {
            privateChannelReadyRef.current = false
          })
          privateChannel.bind('client-speculative-op', (spec: SpeculativeClientEvent) => {
            if (!spec || !spec.mutationId || !spec.mutation) return
            if (spec.clientId === getClientId()) return
            const confirmedVersion = confirmedRef.current?.version ?? 0
            if (spec.baseVersion < confirmedVersion) return
            tentativeRemoteRef.current.set(spec.mutationId, {
              event: spec,
              expiresAt: Date.now() + TENTATIVE_TTL_MS,
            })
            recomputeDisplayState()
          })
        } catch {
          privateChannelReadyRef.current = false
          privateChannelRef.current = null
        }

        cleanups.push(() => {
          privateChannelReadyRef.current = false
          privateChannelRef.current = null
          try {
            pusher.unsubscribe('private-banpick-channel')
          } catch {
            // Ignore cleanup errors on mocked Pusher
          }
          pusher.unsubscribe('banpick-channel')
          pusher.disconnect()
        })
      }
    } else {
      startSseTransport()
    }

    return () => {
      isMountedRef.current = false
      if (tentativeTimerRef.current !== null) {
        clearTimeout(tentativeTimerRef.current)
        tentativeTimerRef.current = null
      }
      for (const cleanup of cleanups) {
        cleanup()
      }
    }
  }, [
    acceptAuthoritativeSnapshot,
    acceptRealtimeEvent,
    fetchLatestState,
    getClientId,
    recomputeDisplayState,
    syncMode,
    updateServerOffset,
  ])

  return {
    gameState: displayState?.gameState,
    teams: displayState?.teams ?? EMPTY_TEAMS,
    members: displayState?.members ?? EMPTY_MEMBERS,
    version: displayState?.version ?? 0,
    serverOffset,
    isLoading: !error && !displayState,
    isError: error,
    syncMode,
    connectionStatus,
    pendingCount,
    dispatchMutation,
    mutate,
  }
}
