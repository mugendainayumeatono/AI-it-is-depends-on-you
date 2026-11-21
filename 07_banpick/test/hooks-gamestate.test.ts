import { renderHook, waitFor, act } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { useGameState } from '@/hooks/useGameState'
import { applyMutation, createDefaultSnapshot, materializeState } from '@/lib/gameEngine'
import type { FullGameState, NormalizedGameSnapshot, StateDelta } from '@/types'

interface Deferred<T> {
  promise: Promise<T>
  resolve: (value: T) => void
  reject: (err: unknown) => void
}

function createDeferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void
  let reject!: (err: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

class MockEventSource {
  static instances: MockEventSource[] = []
  url: string
  closed = false
  onerror: ((ev: Event) => void) | null = null
  private listeners = new Map<string, Set<(ev: Event) => void>>()

  constructor(url: string) {
    this.url = url
    MockEventSource.instances.push(this)
  }

  addEventListener(type: string, listener: EventListenerOrEventListenerObject) {
    const fn = typeof listener === 'function' ? listener : listener.handleEvent.bind(listener)
    let set = this.listeners.get(type)
    if (!set) {
      set = new Set()
      this.listeners.set(type, set)
    }
    set.add(fn)
  }

  removeEventListener(type: string, listener: EventListenerOrEventListenerObject) {
    const fn = typeof listener === 'function' ? listener : listener.handleEvent.bind(listener)
    this.listeners.get(type)?.delete(fn)
  }

  emit(type: string, payload: unknown) {
    const evt = {
      data: typeof payload === 'string' ? payload : JSON.stringify(payload),
    } as MessageEvent
    for (const cb of this.listeners.get(type) ?? []) {
      cb(evt)
    }
  }

  triggerError() {
    this.onerror?.(new Event('error'))
  }

  close() {
    this.closed = true
  }
}

const pusherMocks = vi.hoisted(() => {
  const channelHandlers = new Map<string, Map<string, (data: unknown) => void>>()
  const connectionHandlers = new Map<string, (data: unknown) => void>()
  const mockTrigger = vi.fn()
  const mockUnsubscribe = vi.fn()
  const mockDisconnect = vi.fn()
  const mockConstructor = vi.fn()
  const mockSubscribe = vi.fn((channelName: string) => {
    if (!channelHandlers.has(channelName)) {
      channelHandlers.set(channelName, new Map())
    }
    const map = channelHandlers.get(channelName)!
    return {
      bind: vi.fn((event: string, cb: (data: unknown) => void) => {
        map.set(event, cb)
      }),
      trigger: mockTrigger,
    }
  })

  class MockPusher {
    constructor(key: string, options: unknown) {
      mockConstructor(key, options)
    }
    connection = {
      bind: vi.fn((event: string, cb: (data: unknown) => void) => {
        connectionHandlers.set(event, cb)
      }),
    }
    subscribe = mockSubscribe
    unsubscribe = mockUnsubscribe
    disconnect = mockDisconnect
  }

  return {
    channelHandlers,
    connectionHandlers,
    mockTrigger,
    mockSubscribe,
    mockUnsubscribe,
    mockDisconnect,
    mockConstructor,
    MockPusher,
  }
})

vi.mock('pusher-js', () => ({
  default: pusherMocks.MockPusher,
}))

function buildSnapshot(overrides?: Partial<NormalizedGameSnapshot>): NormalizedGameSnapshot {
  const nowMs = Date.now()
  const base = createDefaultSnapshot(nowMs)
  return {
    ...base,
    version: 1,
    serverTime: nowMs,
    gameState: {
      ...base.gameState,
      version: 1,
      status: 'CONFIGURING',
      teamCount: 2,
      turnDuration: 30,
      totalReserveTime: 120,
    },
    teams: [
      { id: 't1', name: 'Radiant', order: 0, reserveTime: 120 },
      { id: 't2', name: 'Dire', order: 1, reserveTime: 120 },
    ],
    members: [
      {
        id: 'm1',
        name: 'Alice',
        info: 'Carry',
        avatar: null,
        background: null,
        teamId: null,
        isBanned: false,
        pickedAt: null,
      },
      {
        id: 'm2',
        name: 'Bob',
        info: 'Mid',
        avatar: null,
        background: null,
        teamId: null,
        isBanned: false,
        pickedAt: null,
      },
      {
        id: 'm3',
        name: 'Charlie',
        info: 'Support',
        avatar: null,
        background: null,
        teamId: null,
        isBanned: false,
        pickedAt: null,
      },
    ],
    ...overrides,
  }
}

function makeJsonResponse(body: unknown, ok = true, status = 200): Response {
  return {
    ok,
    status,
    json: async () => body,
  } as unknown as Response
}

describe('Hook: useGameState', () => {
  const originalEnv = process.env
  const originalEventSource = globalThis.EventSource

  beforeEach(() => {
    process.env = { ...originalEnv }
    delete process.env.NEXT_PUBLIC_SYNC_METHOD
    delete process.env.NEXT_PUBLIC_PUSHER_KEY
    delete process.env.NEXT_PUBLIC_PUSHER_CLUSTER

    MockEventSource.instances = []
    ;(globalThis as unknown as { EventSource: typeof EventSource }).EventSource =
      MockEventSource as unknown as typeof EventSource

    pusherMocks.channelHandlers.clear()
    pusherMocks.connectionHandlers.clear()
    vi.clearAllMocks()
  })

  afterEach(() => {
    process.env = originalEnv
    ;(globalThis as unknown as { EventSource: typeof EventSource | undefined }).EventSource =
      originalEventSource
    vi.useRealTimers()
  })

  it('hydrates initial state via fetch /api/state and computes serverOffset', async () => {
    const serverTime = Date.now() + 5000
    const initialFull: FullGameState = materializeState(buildSnapshot({ serverTime }))

    global.fetch = vi.fn().mockResolvedValue(makeJsonResponse(initialFull))

    const { result } = renderHook(() => useGameState())

    expect(result.current.isLoading).toBe(true)

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false)
    })

    expect(result.current.gameState?.status).toBe('CONFIGURING')
    expect(result.current.teams).toHaveLength(2)
    expect(result.current.members).toHaveLength(3)
    expect(result.current.version).toBe(1)
    expect(result.current.serverOffset).toBeGreaterThan(4000)
    expect(result.current.serverOffset).toBeLessThan(6000)
  })

  it('sets isError when initial /api/state fetch fails', async () => {
    global.fetch = vi
      .fn()
      .mockResolvedValue(makeJsonResponse({ error: 'Database unavailable' }, false, 500))

    const { result } = renderHook(() => useGameState())

    await waitFor(() => {
      expect(result.current.isError).toBeDefined()
    })
    expect(result.current.isLoading).toBe(false)
  })

  it('default AUTO sync mode uses SSE when NEXT_PUBLIC_PUSHER_KEY is absent', async () => {
    const initialFull = materializeState(buildSnapshot())
    global.fetch = vi.fn().mockResolvedValue(makeJsonResponse(initialFull))

    const { result, unmount } = renderHook(() => useGameState())

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false)
    })

    expect(result.current.syncMode).toBe('SSE')
    expect(pusherMocks.mockConstructor).not.toHaveBeenCalled()
    expect(MockEventSource.instances).toHaveLength(1)
    expect(MockEventSource.instances[0].url).toContain('/api/stream?sinceVersion=')

    act(() => {
      MockEventSource.instances[0].emit('connected', { version: 1, serverTime: Date.now() })
    })
    expect(result.current.connectionStatus).toBe('connected')

    unmount()
    expect(MockEventSource.instances[0].closed).toBe(true)
  })

  it('default AUTO sync mode selects PUSHER when NEXT_PUBLIC_PUSHER_KEY & CLUSTER are set', async () => {
    process.env.NEXT_PUBLIC_PUSHER_KEY = 'pub-key'
    process.env.NEXT_PUBLIC_PUSHER_CLUSTER = 'us2'

    const initialFull = materializeState(buildSnapshot())
    global.fetch = vi.fn().mockResolvedValue(makeJsonResponse(initialFull))

    const { result, unmount } = renderHook(() => useGameState())

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false)
    })

    expect(result.current.syncMode).toBe('PUSHER')
    expect(MockEventSource.instances).toHaveLength(0)
    expect(pusherMocks.mockConstructor).toHaveBeenCalledWith(
      'pub-key',
      expect.objectContaining({
        cluster: 'us2',
        authEndpoint: '/api/pusher/auth',
      })
    )
    expect(pusherMocks.mockSubscribe).toHaveBeenCalledWith('banpick-channel')
    expect(pusherMocks.mockSubscribe).toHaveBeenCalledWith('private-banpick-channel')

    unmount()
    expect(pusherMocks.mockUnsubscribe).toHaveBeenCalledWith('banpick-channel')
    expect(pusherMocks.mockUnsubscribe).toHaveBeenCalledWith('private-banpick-channel')
    expect(pusherMocks.mockDisconnect).toHaveBeenCalled()
  })

  it('warns and gracefully falls back to SSE when syncMode=PUSHER but keys are missing', async () => {
    process.env.NEXT_PUBLIC_SYNC_METHOD = 'PUSHER'
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

    global.fetch = vi.fn().mockResolvedValue(makeJsonResponse(materializeState(buildSnapshot())))

    renderHook(() => useGameState())

    await waitFor(() => {
      expect(MockEventSource.instances).toHaveLength(1)
    })
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('Pusher keys missing'))
    expect(pusherMocks.mockConstructor).not.toHaveBeenCalled()

    warnSpy.mockRestore()
  })

  it('explicit POLLING mode sets connectionStatus=fallback and polls ?sinceVersion=N', async () => {
    process.env.NEXT_PUBLIC_SYNC_METHOD = 'POLLING'
    vi.useFakeTimers()

    const initialFull = materializeState(buildSnapshot({ version: 2 }))
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(makeJsonResponse(initialFull))
      .mockResolvedValue(
        makeJsonResponse({ unchanged: true, version: 2, serverTime: Date.now() })
      )
    global.fetch = fetchMock

    const { result } = renderHook(() => useGameState())

    await act(async () => {
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(result.current.syncMode).toBe('POLLING')
    expect(result.current.connectionStatus).toBe('fallback')
    expect(MockEventSource.instances).toHaveLength(0)

    await act(async () => {
      vi.advanceTimersByTime(1100)
      await Promise.resolve()
    })

    expect(fetchMock).toHaveBeenCalledWith('/api/state?sinceVersion=2', { cache: 'no-store' })
  })

  it('monotonic version gate: drops stale SSE, Pusher, and HTTP snapshots (version <= confirmedVersion)', async () => {
    const v5Snap = buildSnapshot({
      version: 5,
      gameState: {
        ...buildSnapshot().gameState,
        version: 5,
        status: 'PICKING',
        currentTeamIndex: 1,
        turnStartTime: new Date().toISOString(),
      },
      members: [
        {
          id: 'm1',
          name: 'Alice',
          info: 'Carry',
          avatar: null,
          background: null,
          teamId: 't1',
          isBanned: false,
          pickedAt: new Date().toISOString(),
        },
        ...buildSnapshot().members.slice(1),
      ],
    })

    global.fetch = vi.fn().mockResolvedValue(makeJsonResponse(materializeState(v5Snap)))

    const { result } = renderHook(() => useGameState())

    await waitFor(() => {
      expect(result.current.version).toBe(5)
    })

    // 1. Stale SSE snapshot with version 3 (< 5) -> MUST be dropped
    const staleSnap = buildSnapshot({ version: 3 })
    act(() => {
      MockEventSource.instances[0].emit('state', {
        kind: 'snapshot',
        version: 3,
        serverTime: Date.now(),
        snapshot: staleSnap,
      })
    })

    expect(result.current.version).toBe(5)
    expect(result.current.gameState?.status).toBe('PICKING')
    expect(result.current.members.find((m) => m.id === 'm1')?.teamId).toBe('t1')

    // 2. Stale SSE delta with version 5 (=== 5) -> MUST be dropped
    const staleDelta: StateDelta = {
      kind: 'delta',
      version: 5,
      prevVersion: 4,
      serverTime: Date.now(),
      op: 'START',
      gameState: { ...staleSnap.gameState, version: 5, status: 'CONFIGURING' },
    }
    act(() => {
      MockEventSource.instances[0].emit('state', staleDelta)
    })

    expect(result.current.version).toBe(5)
    expect(result.current.gameState?.status).toBe('PICKING')

    // 3. Stale manual mutate with version 4 -> MUST be dropped
    act(() => {
      result.current.mutate(materializeState(buildSnapshot({ version: 4 })), { revalidate: false })
    })
    expect(result.current.version).toBe(5)
    expect(result.current.members.find((m) => m.id === 'm1')?.teamId).toBe('t1')
  })

  it('monotonic version gate: drops stale Pusher events and applies newer deltas', async () => {
    process.env.NEXT_PUBLIC_SYNC_METHOD = 'PUSHER'
    process.env.NEXT_PUBLIC_PUSHER_KEY = 'key'
    process.env.NEXT_PUBLIC_PUSHER_CLUSTER = 'us2'

    const v2Snap = buildSnapshot({
      version: 2,
      gameState: {
        ...buildSnapshot().gameState,
        version: 2,
        status: 'PICKING',
        currentTeamIndex: 0,
        turnStartTime: new Date().toISOString(),
      },
    })
    global.fetch = vi.fn().mockResolvedValue(makeJsonResponse(materializeState(v2Snap)))

    const { result } = renderHook(() => useGameState())

    await waitFor(() => {
      expect(result.current.version).toBe(2)
    })

    const stateHandler = pusherMocks.channelHandlers.get('banpick-channel')?.get('state-update')
    expect(stateHandler).toBeDefined()

    // Stale v1 snapshot over Pusher is dropped
    act(() => {
      stateHandler!({
        kind: 'snapshot',
        version: 1,
        serverTime: Date.now(),
        snapshot: buildSnapshot({ version: 1 }),
      })
    })
    expect(result.current.version).toBe(2)
    expect(result.current.gameState?.status).toBe('PICKING')

    // Contiguous v3 delta over Pusher is applied without refetching /api/state
    const applied = applyMutation(
      v2Snap,
      { type: 'PICK', mutationId: 'remote-pick', memberId: 'm1', teamId: 't1' },
      { nowMs: Date.now() + 1000 }
    )
    expect(applied.ok).toBe(true)
    if (!applied.ok) throw new Error('expected ok')

    act(() => {
      stateHandler!(applied.event)
    })
    expect(result.current.version).toBe(3)
    expect(result.current.members.find((m) => m.id === 'm1')?.teamId).toBe('t1')
    expect(global.fetch).toHaveBeenCalledTimes(1) // Only initial GET /api/state
  })

  it('rapid consecutive operations (FIFO queue): paints optimistically, serializes POSTs, never regresses on intermediate echoes, and reconciles cleanly', async () => {
    const t0 = Date.now()
    const snapV1 = buildSnapshot({ version: 1, serverTime: t0 })

    // Precompute authoritative server snapshots for v2 (START), v3 (PICK m1), v4 (PICK m2)
    const rStart = applyMutation(
      snapV1,
      { type: 'START', mutationId: 'mut-start' },
      { nowMs: t0 + 10 }
    )
    if (!rStart.ok) throw new Error('start failed')
    const snapV2 = rStart.next

    const rPick1 = applyMutation(
      snapV2,
      { type: 'PICK', mutationId: 'mut-pick1', memberId: 'm1', teamId: 't1' },
      { nowMs: t0 + 20 }
    )
    if (!rPick1.ok) throw new Error('pick1 failed')
    const snapV3 = rPick1.next

    const rPick2 = applyMutation(
      snapV3,
      { type: 'PICK', mutationId: 'mut-pick2', memberId: 'm2', teamId: 't2' },
      { nowMs: t0 + 30 }
    )
    if (!rPick2.ok) throw new Error('pick2 failed')
    const snapV4 = rPick2.next

    const postDeferreds = [
      createDeferred<Response>(),
      createDeferred<Response>(),
      createDeferred<Response>(),
    ]
    const sentPostBodies: Array<Record<string, unknown>> = []
    let getStateCalls = 0

    global.fetch = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url.startsWith('/api/state')) {
        getStateCalls++
        return Promise.resolve(makeJsonResponse(materializeState(snapV1)))
      }
      if (url === '/api/pick' && init?.method === 'POST') {
        const idx = sentPostBodies.length
        sentPostBodies.push(JSON.parse(String(init.body)))
        return postDeferreds[idx].promise
      }
      return Promise.reject(new Error(`Unexpected fetch: ${url}`))
    })

    const { result } = renderHook(() => useGameState())
    await waitFor(() => {
      expect(result.current.isLoading).toBe(false)
    })
    expect(getStateCalls).toBe(1)

    // Dispatch START + PICK 1 + PICK 2 synchronously in rapid succession!
    let pStart!: Promise<{ ok: boolean }>
    let pPick1!: Promise<{ ok: boolean }>
    let pPick2!: Promise<{ ok: boolean }>

    act(() => {
      pStart = result.current.dispatchMutation({ type: 'START', mutationId: 'mut-start' })
      pPick1 = result.current.dispatchMutation({
        type: 'PICK',
        mutationId: 'mut-pick1',
        memberId: 'm1',
        teamId: 't1',
      })
      pPick2 = result.current.dispatchMutation({
        type: 'PICK',
        mutationId: 'mut-pick2',
        memberId: 'm2',
        teamId: 't2',
      })
    })

    // Immediately painted optimistically (<16ms, zero waiting on HTTP!)
    expect(result.current.gameState?.status).toBe('PICKING')
    expect(result.current.members.find((m) => m.id === 'm1')?.teamId).toBe('t1')
    expect(result.current.members.find((m) => m.id === 'm2')?.teamId).toBe('t2')
    expect(result.current.pendingCount).toBe(3)

    // FIFO serialization: strictly 1 POST in flight at a time!
    expect(sentPostBodies).toHaveLength(1)
    expect(sentPostBodies[0]).toMatchObject({ status: 'START', mutationId: 'mut-start' })

    // 1. Resolve START (v2) — Pick 1 & Pick 2 MUST remain optimistically visible (ZERO regression!)
    await act(async () => {
      postDeferreds[0].resolve(
        makeJsonResponse({ success: true, ...materializeState(snapV2), delta: rStart.delta })
      )
      await pStart
    })

    expect(result.current.members.find((m) => m.id === 'm1')?.teamId).toBe('t1')
    expect(result.current.members.find((m) => m.id === 'm2')?.teamId).toBe('t2')
    expect(result.current.pendingCount).toBe(2)

    // Now POST #2 (PICK m1) is sent with expectedVersion = 2 (confirmedVersion at send-time!)
    await waitFor(() => {
      expect(sentPostBodies).toHaveLength(2)
    })
    expect(sentPostBodies[1]).toMatchObject({
      memberId: 'm1',
      teamId: 't1',
      expectedVersion: 2,
    })

    // 2. Simulate SSE echo of Pick 1 (v3) arriving BEFORE Pick 1 HTTP response resolves while Pick 2 is still queued
    act(() => {
      MockEventSource.instances[0].emit('state', rPick1.event)
    })
    // Pick 2 MUST NOT disappear/regress when Pick 1 echo arrives!
    expect(result.current.members.find((m) => m.id === 'm1')?.teamId).toBe('t1')
    expect(result.current.members.find((m) => m.id === 'm2')?.teamId).toBe('t2')

    // 3. Resolve Pick 1 HTTP response (v3) -> triggers POST #3 (PICK m2 with expectedVersion = 3)
    await act(async () => {
      postDeferreds[1].resolve(
        makeJsonResponse({ success: true, ...materializeState(snapV3), delta: rPick1.delta })
      )
      await pPick1
    })

    expect(result.current.members.find((m) => m.id === 'm2')?.teamId).toBe('t2')
    await waitFor(() => {
      expect(sentPostBodies).toHaveLength(3)
    })
    expect(sentPostBodies[2]).toMatchObject({
      memberId: 'm2',
      teamId: 't2',
      expectedVersion: 3,
    })

    // 4. Resolve Pick 2 HTTP response (v4)
    await act(async () => {
      postDeferreds[2].resolve(
        makeJsonResponse({ success: true, ...materializeState(snapV4), delta: rPick2.delta })
      )
      const res = await pPick2
      expect(res.ok).toBe(true)
    })

    expect(result.current.version).toBe(4)
    expect(result.current.pendingCount).toBe(0)
    expect(result.current.members.find((m) => m.id === 'm1')?.teamId).toBe('t1')
    expect(result.current.members.find((m) => m.id === 'm2')?.teamId).toBe('t2')
    // Zero redundant GET /api/state calls!
    expect(getStateCalls).toBe(1)
  })

  it('409 conflict reconciliation: adopts authoritative 409 response WITHOUT redundant GET /api/state', async () => {
    const t0 = Date.now()
    const v2Snap = buildSnapshot({
      version: 2,
      serverTime: t0,
      gameState: {
        ...buildSnapshot().gameState,
        version: 2,
        status: 'PICKING',
        currentTeamIndex: 0,
        turnStartTime: new Date(t0).toISOString(),
      },
    })

    // Another user already picked m2 for t1 -> authoritative state is v3, t2's turn
    const otherPick = applyMutation(
      v2Snap,
      { type: 'PICK', mutationId: 'other-user', memberId: 'm2', teamId: 't1' },
      { nowMs: t0 + 100 }
    )
    if (!otherPick.ok) throw new Error('expected ok')
    const authoritativeV3 = materializeState(otherPick.next)

    let getStateCalls = 0
    global.fetch = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url.startsWith('/api/state')) {
        getStateCalls++
        return Promise.resolve(makeJsonResponse(materializeState(v2Snap)))
      }
      if (url === '/api/pick' && init?.method === 'POST') {
        return Promise.resolve(
          makeJsonResponse(
            {
              success: false,
              error: 'Turn has already been taken',
              code: 'VERSION_CONFLICT',
              ...authoritativeV3,
            },
            false,
            409
          )
        )
      }
      return Promise.reject(new Error(`Unexpected fetch: ${url}`))
    })

    const { result } = renderHook(() => useGameState())
    await waitFor(() => {
      expect(result.current.version).toBe(2)
    })

    let outcome!: { ok: boolean; error?: string }
    await act(async () => {
      outcome = await result.current.dispatchMutation({
        type: 'PICK',
        memberId: 'm1',
        teamId: 't1',
      })
    })

    expect(outcome).toEqual({ ok: false, error: 'Turn has already been taken' })
    expect(result.current.version).toBe(3)
    expect(result.current.gameState?.currentTeamIndex).toBe(1)
    expect(result.current.members.find((m) => m.id === 'm2')?.teamId).toBe('t1')
    expect(result.current.members.find((m) => m.id === 'm1')?.teamId).toBeNull()
    expect(result.current.pendingCount).toBe(0)
    // Strictly 1 GET /api/state (initial mount only — NO redundant refetch on 409!)
    expect(getStateCalls).toBe(1)
  })

  it('delta gap and invalidate event each trigger a single resync GET /api/state', async () => {
    const v2Snap = buildSnapshot({
      version: 2,
      gameState: {
        ...buildSnapshot().gameState,
        version: 2,
        status: 'PICKING',
        currentTeamIndex: 0,
        turnStartTime: new Date().toISOString(),
      },
    })
    const v5Snap = buildSnapshot({
      version: 5,
      gameState: { ...v2Snap.gameState, version: 5, currentTeamIndex: 1 },
    })
    const v6Snap = buildSnapshot({
      version: 6,
      gameState: { ...v2Snap.gameState, version: 6, status: 'COMPLETED' },
    })

    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(makeJsonResponse(materializeState(v2Snap)))
      .mockResolvedValueOnce(makeJsonResponse(materializeState(v5Snap)))
      .mockResolvedValueOnce(makeJsonResponse(materializeState(v6Snap)))
    global.fetch = fetchMock

    const { result } = renderHook(() => useGameState())
    await waitFor(() => {
      expect(result.current.version).toBe(2)
    })
    expect(fetchMock).toHaveBeenCalledTimes(1)

    // 1. Delta gap: prevVersion=4 !== confirmedVersion=2 -> single GET /api/state resync
    act(() => {
      MockEventSource.instances[0].emit('state', {
        kind: 'delta',
        version: 5,
        prevVersion: 4,
        serverTime: Date.now(),
        op: 'PICK',
        gameState: v5Snap.gameState,
      })
    })

    await waitFor(() => {
      expect(result.current.version).toBe(5)
    })
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(fetchMock).toHaveBeenLastCalledWith('/api/state', { cache: 'no-store' })

    // 2. Explicit invalidate event -> single GET /api/state resync
    act(() => {
      MockEventSource.instances[0].emit('state', {
        kind: 'invalidate',
        version: 6,
        serverTime: Date.now(),
        mutationId: 'big-snap',
      })
    })

    await waitFor(() => {
      expect(result.current.version).toBe(6)
    })
    expect(result.current.gameState?.status).toBe('COMPLETED')
    expect(fetchMock).toHaveBeenCalledTimes(3)
  })

  it('SSE reconnect event recycles EventSource with updated sinceVersion and does NOT leak duplicate EventSource if onerror fires after reconnect', async () => {
    vi.useFakeTimers()

    const v3Snap = buildSnapshot({ version: 3 })
    global.fetch = vi.fn().mockResolvedValue(makeJsonResponse(materializeState(v3Snap)))

    const { result } = renderHook(() => useGameState())

    await act(async () => {
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(MockEventSource.instances).toHaveLength(1)
    const firstEs = MockEventSource.instances[0]

    act(() => {
      firstEs.emit('connected', { version: 3, serverTime: Date.now() })
    })
    expect(result.current.connectionStatus).toBe('connected')

    act(() => {
      firstEs.emit('reconnect', { version: 3, serverTime: Date.now() })
      // Simulate browser firing onerror immediately after server closes socket on reconnect
      firstEs.triggerError()
    })
    expect(firstEs.closed).toBe(true)
    // Stale onerror from closed EventSource must NOT flip status to reconnecting
    expect(result.current.connectionStatus).toBe('connected')

    await act(async () => {
      vi.advanceTimersByTime(500)
    })

    // Strictly 1 replacement EventSource created (NO duplicate connection leak!)
    expect(MockEventSource.instances).toHaveLength(2)
    expect(MockEventSource.instances[1].url).toBe('/api/stream?sinceVersion=3')
  })

  it('evicts superseded speculative peer events (baseVersion < confirmed.version) so stale START cannot reset turn', async () => {
    process.env.NEXT_PUBLIC_SYNC_METHOD = 'PUSHER'
    process.env.NEXT_PUBLIC_PUSHER_KEY = 'pub-key'
    process.env.NEXT_PUBLIC_PUSHER_CLUSTER = 'us2'

    const t0 = Date.now()
    const v2Snap = buildSnapshot({
      version: 2,
      serverTime: t0,
      gameState: {
        ...buildSnapshot().gameState,
        version: 2,
        status: 'PICKING',
        currentTeamIndex: 0,
        turnStartTime: new Date(t0).toISOString(),
      },
    })
    global.fetch = vi.fn().mockResolvedValue(makeJsonResponse(materializeState(v2Snap)))

    const { result } = renderHook(() => useGameState())
    await waitFor(() => {
      expect(result.current.version).toBe(2)
    })

    const specHandler = pusherMocks.channelHandlers
      .get('private-banpick-channel')
      ?.get('client-speculative-op')
    const stateHandler = pusherMocks.channelHandlers.get('banpick-channel')?.get('state-update')
    expect(specHandler).toBeDefined()
    expect(stateHandler).toBeDefined()

    // Peer sends speculative START at baseVersion: 2
    act(() => {
      specHandler!({
        mutationId: 'peer-stale-start',
        clientId: 'other-client',
        baseVersion: 2,
        sentAt: t0 + 5,
        mutation: { type: 'START', mutationId: 'peer-stale-start', clientId: 'other-client' },
      })
    })

    // Authoritative server advances to v3 (m1 picked by t1, now t2's turn -> currentTeamIndex: 1)
    const v3Applied = applyMutation(
      v2Snap,
      { type: 'PICK', mutationId: 'auth-pick-1', memberId: 'm1', teamId: 't1' },
      { nowMs: t0 + 20 }
    )
    if (!v3Applied.ok) throw new Error('expected ok')

    act(() => {
      stateHandler!(v3Applied.event)
    })

    // Speculative START (baseVersion: 2 < confirmed.version: 3) MUST be evicted and NOT reset currentTeamIndex to 0!
    expect(result.current.version).toBe(3)
    expect(result.current.gameState?.currentTeamIndex).toBe(1)
    expect(result.current.members.find((m) => m.id === 'm1')?.teamId).toBe('t1')
  })
})
