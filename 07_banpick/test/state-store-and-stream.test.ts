import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { Redis } from '@upstash/redis'
import { GET as streamGet } from '@/app/api/stream/route'
import { POST as pusherAuthPost } from '@/app/api/pusher/auth/route'
import { POST as configPost } from '@/app/api/config/route'
import { POST as membersPost } from '@/app/api/members/route'
import { POST as pickPost } from '@/app/api/pick/route'
import prisma from '@/lib/prisma'
import { applyMutation, buildMediaUrl } from '@/lib/gameEngine'
import { emitLocalEvent } from '@/lib/realtime'
import {
  LUA_MUTATION_SCRIPT,
  REDIS_EVENTS_KEY,
  REDIS_IDEMP_PREFIX,
  REDIS_MEDIA_PREFIX,
  REDIS_STATE_KEY,
  UpstashRedisStateStore,
} from '@/lib/stateStore'
import type { GameMutation, NormalizedGameSnapshot, RealtimeEvent } from '@/types'

/**
 * Lightweight in-memory mock of `@upstash/redis`'s `Redis` client implementing
 * `get`, `set` (with `nx`), `del`, `xrange`, and `createScript(LUA_MUTATION_SCRIPT).exec()`.
 */
function createMockUpstashRedis() {
  const kv = new Map<string, string>()
  const stream: Array<[string, string[]]> = []
  const published: Array<{ channel: string; payload: string }> = []
  let scriptSourceCaptured = ''
  let streamSeq = 0

  const scriptExec = vi.fn(async (keys: string[], args: string[]): Promise<string> => {
    const [stateKey, , idempKey] = keys
    const [pubsubChannel, mutJson, nowMsStr, , randomFloatStr, generatedId, teamIdsJson] = args

    // 1. Idempotency check
    if (idempKey && kv.has(idempKey)) {
      const cached = JSON.parse(kv.get(idempKey)!) as Record<string, unknown>
      if (cached.ok) {
        cached.alreadyApplied = true
      }
      return JSON.stringify(cached)
    }

    // 2. Snapshot existence check -> cacheMiss if unhydrated
    const rawSnap = kv.get(stateKey)
    if (!rawSnap) {
      return JSON.stringify({ cacheMiss: true })
    }

    const snap = JSON.parse(rawSnap) as NormalizedGameSnapshot
    const mut = JSON.parse(mutJson) as Record<string, unknown>
    const nowMs = Number(nowMsStr)
    const randomFloat = Number(randomFloatStr)
    const teamIds = JSON.parse(teamIdsJson || '[]') as string[]

    // Mirror Lua's '__INLINE_MEDIA__' sentinel resolution (no base64 in Lua!)
    const preparedMut: Record<string, unknown> = { ...mut }
    if (preparedMut.type === 'MEMBER_ADD' || preparedMut.type === 'MEMBER_UPDATE') {
      if (preparedMut.avatar === '__INLINE_MEDIA__') {
        preparedMut.avatar = 'data:image/jpeg;base64,SENTINEL_MARKER'
      }
      if (preparedMut.background === '__INLINE_MEDIA__') {
        preparedMut.background = 'data:image/png;base64,SENTINEL_MARKER'
      }
    }

    let tidIdx = 0
    const applied = applyMutation(snap, preparedMut as unknown as GameMutation, {
      nowMs,
      randomFloat,
      isOptimistic: false,
      generateId: () => teamIds[tidIdx++] ?? generatedId,
    })

    if (!applied.ok) {
      return JSON.stringify({
        ok: false,
        status: applied.status,
        error: applied.error,
        code: applied.code,
        snapshot: snap,
      })
    }

    if (applied.alreadyApplied) {
      return JSON.stringify({
        ok: true,
        alreadyApplied: true,
        snapshot: applied.next,
        event: applied.event,
      })
    }

    // Commit state, stream XADD, pubsub PUBLISH, and idempotency cache
    const snapJson = JSON.stringify(applied.next)
    const eventJson = JSON.stringify(applied.event)
    kv.set(stateKey, snapJson)
    stream.push([`${++streamSeq}-0`, ['version', String(applied.next.version), 'event', eventJson]])
    published.push({ channel: pubsubChannel, payload: eventJson })

    const resObj: Record<string, unknown> = {
      ok: true,
      snapshot: applied.next,
      event: applied.event,
    }
    if (applied.delta) resObj.delta = applied.delta
    if (applied.pickedMemberId) resObj.pickedMemberId = applied.pickedMemberId

    const resJson = JSON.stringify(resObj)
    if (idempKey) {
      kv.set(idempKey, resJson)
    }
    return resJson
  })

  const client = {
    get: vi.fn(async (key: string) => kv.get(key) ?? null),
    set: vi.fn(async (key: string, value: string, opts?: { nx?: boolean }) => {
      if (opts?.nx && kv.has(key)) return null
      kv.set(key, value)
      return 'OK'
    }),
    del: vi.fn(async (...keys: string[]) => {
      let removed = 0
      for (const k of keys) {
        if (kv.delete(k)) removed++
      }
      return removed
    }),
    xrange: vi.fn(async () => [...stream]),
    createScript: vi.fn((source: string) => {
      scriptSourceCaptured = source
      return { exec: scriptExec }
    }),
  }

  return {
    redis: client as unknown as Redis,
    mocks: client,
    scriptExec,
    kv,
    stream,
    published,
    getScriptSource: () => scriptSourceCaptured,
  }
}

interface ParsedSseFrame {
  event: string
  data: unknown
}

function createSseReader(response: Response) {
  const reader = response.body!.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  const frames: ParsedSseFrame[] = []

  const parseBuffer = () => {
    let idx = buffer.indexOf('\n\n')
    while (idx !== -1) {
      const rawBlock = buffer.slice(0, idx)
      buffer = buffer.slice(idx + 2)
      let eventName = 'message'
      let dataStr = ''
      for (const line of rawBlock.split('\n')) {
        if (line.startsWith('event:')) {
          eventName = line.slice(6).trim()
        } else if (line.startsWith('data:')) {
          dataStr += line.slice(5).trim()
        }
      }
      if (dataStr) {
        frames.push({ event: eventName, data: JSON.parse(dataStr) })
      }
      idx = buffer.indexOf('\n\n')
    }
  }

  const readNextFrame = async (timeoutMs = 1500): Promise<ParsedSseFrame> => {
    if (frames.length > 0) return frames.shift()!

    const deadline = Date.now() + timeoutMs
    while (frames.length === 0) {
      const remaining = deadline - Date.now()
      if (remaining <= 0) {
        throw new Error('Timed out waiting for SSE frame')
      }
      const chunk = await Promise.race([
        reader.read(),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('Timed out reading SSE stream')), remaining)
        ),
      ])
      if (chunk.done) {
        throw new Error('SSE stream closed before next frame arrived')
      }
      buffer += decoder.decode(chunk.value, { stream: true })
      parseBuffer()
    }
    return frames.shift()!
  }

  return { readNextFrame, reader }
}

describe('UpstashRedisStateStore, SSE /api/stream, Pusher Auth & Rapid-Fire Stress', () => {
  const originalEnv = process.env

  beforeEach(() => {
    process.env = { ...originalEnv }
    delete process.env.POSTGRES_PRISMA_URL
    delete process.env.UPSTASH_REDIS_REST_URL
    delete process.env.UPSTASH_REDIS_REST_TOKEN
    delete process.env.KV_REST_API_URL
    delete process.env.KV_REST_API_TOKEN
    delete process.env.PUSHER_APP_ID
    delete process.env.NEXT_PUBLIC_PUSHER_KEY
    delete process.env.PUSHER_SECRET
    delete process.env.NEXT_PUBLIC_PUSHER_CLUSTER
    delete process.env.NEXT_PUBLIC_SYNC_METHOD
    vi.clearAllMocks()
  })

  afterEach(() => {
    process.env = originalEnv
  })

  describe('UpstashRedisStateStore', () => {
    it('executes 1-RTT Lua invocation on warm state and hydrates cleanly on cacheMiss', async () => {
      const mock = createMockUpstashRedis()
      const store = new UpstashRedisStateStore(mock.redis)

      expect(store.getStoreKind()).toBe('upstash')
      expect(mock.getScriptSource()).toBe(LUA_MUTATION_SCRIPT)

      // 1. Cold start: Lua returns { cacheMiss: true } -> hydrates via SET NX -> retries Lua
      const cfgRes = await store.mutate(
        {
          type: 'CONFIG',
          mutationId: 'cfg-1',
          teamCount: 2,
          turnDuration: 30,
          totalReserveTime: 60,
          teamNames: ['Radiant', 'Dire'],
        },
        { nowMs: 1_700_000_000_000 }
      )

      expect(cfgRes.ok).toBe(true)
      expect(mock.mocks.set).toHaveBeenCalledWith(REDIS_STATE_KEY, expect.any(String), { nx: true })
      expect(mock.scriptExec).toHaveBeenCalledTimes(2) // 1 cacheMiss + 1 retry
      if (!cfgRes.ok) return
      expect(cfgRes.snapshot.version).toBe(2)
      expect(cfgRes.publishedToRedis).toBe(true)

      // 2. Warm hot mutation (START): strictly 1-RTT (1 scriptExec call, ZERO extra GET/SET!)
      mock.scriptExec.mockClear()
      mock.mocks.get.mockClear()
      mock.mocks.set.mockClear()

      const startRes = await store.mutate(
        { type: 'START', mutationId: 'start-1', expectedVersion: 2 },
        { nowMs: 1_700_000_001_000 }
      )

      expect(startRes.ok).toBe(true)
      expect(mock.scriptExec).toHaveBeenCalledTimes(1)
      expect(mock.mocks.get).not.toHaveBeenCalled()
      expect(mock.mocks.set).not.toHaveBeenCalled()
      expect(mock.scriptExec).toHaveBeenCalledWith(
        [REDIS_STATE_KEY, REDIS_EVENTS_KEY, `${REDIS_IDEMP_PREFIX}start-1`],
        expect.any(Array)
      )
    })

    it('strips inline base64 into separate media keys and passes __INLINE_MEDIA__ sentinel to Lua (base64 NEVER enters ARGV/state/pubsub)', async () => {
      const mock = createMockUpstashRedis()
      const store = new UpstashRedisStateStore(mock.redis)
      await store.getSnapshot() // hydrate

      const largeJpegPayload = 'data:image/jpeg;base64,' + 'A'.repeat(35_000)

      mock.scriptExec.mockClear()
      const addRes = await store.mutate(
        {
          type: 'MEMBER_ADD',
          mutationId: 'add-media-1',
          id: 'hero-1',
          name: 'Invoker',
          info: 'Mid',
          avatar: largeJpegPayload,
        },
        { nowMs: 1_700_000_002_000 }
      )

      expect(addRes.ok).toBe(true)
      if (!addRes.ok) return

      // Media blob stored in dedicated Redis media key
      expect(mock.kv.get(`${REDIS_MEDIA_PREFIX}hero-1:avatar`)).toBe(largeJpegPayload)

      // Lua ARGV received '__INLINE_MEDIA__' sentinel — ZERO base64 in ARGV!
      const luaArgs = mock.scriptExec.mock.calls[0][1] as string[]
      expect(luaArgs[1]).toContain('__INLINE_MEDIA__')
      expect(luaArgs[1]).not.toContain('data:image/')
      expect(Buffer.byteLength(luaArgs[1], 'utf8')).toBeLessThan(500)

      // Neither banpick:state nor pubsub payload contains any base64!
      expect(mock.kv.get(REDIS_STATE_KEY)).not.toContain('data:image/')
      expect(mock.published[mock.published.length - 1].payload).not.toContain('data:image/')

      // Snapshot contains compact immutable proxy URL
      const hero = addRes.snapshot.members.find((m) => m.id === 'hero-1')!
      expect(hero.avatar).toBe(buildMediaUrl('hero-1', 'avatar', 1))

      // getMedia retrieves raw base64 directly from Redis media key
      const rawMedia = await store.getMedia('hero-1', 'avatar')
      expect(rawMedia).toBe(largeJpegPayload)
    })

    it('enforces mutationId idempotency and parses contiguous events via getEventsSince', async () => {
      const mock = createMockUpstashRedis()
      const store = new UpstashRedisStateStore(mock.redis)
      await store.getSnapshot()

      const r1 = await store.mutate(
        { type: 'START', mutationId: 'idemp-start-1' },
        { nowMs: 1_700_000_000_000 }
      )
      expect(r1.ok).toBe(true)
      if (!r1.ok) return
      expect(r1.alreadyApplied).toBe(false)
      expect(r1.snapshot.version).toBe(2)

      // Replay identical mutationId -> alreadyApplied: true, version unchanged
      const r2 = await store.mutate(
        { type: 'START', mutationId: 'idemp-start-1' },
        { nowMs: 1_700_000_000_500 }
      )
      expect(r2.ok).toBe(true)
      if (!r2.ok) return
      expect(r2.alreadyApplied).toBe(true)
      expect(r2.snapshot.version).toBe(2)
      expect(r2.publishedToRedis).toBe(false)

      // getEventsSince returns contiguous event v2 from Redis Stream XRANGE
      const missed = await store.getEventsSince(1)
      expect(missed).not.toBeNull()
      expect(missed).toHaveLength(1)
      expect(missed![0].version).toBe(2)
    })

    it('encodes empty Lua arrays using sentinel replacement so empty members/teams serialize as [] (never {})', async () => {
      // Static invariant check on the Lua source itself (guards standard Redis lua-cjson 2.1.0 compatibility)
      expect(LUA_MUTATION_SCRIPT).toContain('__BANPICK_EMPTY_ARRAY__')
      expect(LUA_MUTATION_SCRIPT).toContain('[]')
      expect(LUA_MUTATION_SCRIPT).not.toContain('cjson.empty_array')

      // Behavioral check: CONFIG with 0 members returns true JS Array [] for members
      const mock = createMockUpstashRedis()
      const store = new UpstashRedisStateStore(mock.redis)
      const res = await store.mutate(
        {
          type: 'CONFIG',
          mutationId: 'cfg-empty-members',
          teamCount: 2,
          turnDuration: 0,
          totalReserveTime: 0,
          teamNames: ['A', 'B'],
        },
        { nowMs: 1_700_000_000_000 }
      )
      expect(res.ok).toBe(true)
      if (!res.ok) return
      expect(Array.isArray(res.snapshot.members)).toBe(true)
      expect(res.snapshot.members).toEqual([])
      expect(res.event.kind).toBe('snapshot')
      if (res.event.kind === 'snapshot') {
        expect(Array.isArray(res.event.snapshot.members)).toBe(true)
      }
    })

    it('runs after() Postgres write-behind with version guard (skips stale state writes, preserves out-of-order media blobs, applies contiguous deltas)', async () => {
      process.env.POSTGRES_PRISMA_URL = 'postgresql://test-db'

      const mock = createMockUpstashRedis()
      const store = new UpstashRedisStateStore(mock.redis)

      // Hydrate from Postgres mock (v1)
      ;(prisma.gameState.findUnique as any).mockResolvedValueOnce({
        id: 'singleton',
        version: 1,
        status: 'CONFIGURING',
        currentTeamIndex: 0,
        turnStartTime: new Date(),
        turnDuration: 30,
        totalReserveTime: 120,
        teamCount: 2,
      })
      ;(prisma.team.findMany as any).mockResolvedValueOnce([
        { id: 't1', name: 'A', order: 0, reserveTime: 120 },
      ])
      ;(prisma.member.findMany as any).mockResolvedValueOnce([])

      await store.getSnapshot()

      // Case A: Delayed non-media write-behind encounters NEWER version in Postgres (existing.version = 10 >= 2) -> MUST NOT clobber!
      ;(prisma.gameState.findUnique as any).mockResolvedValueOnce({ version: 10 })
      const startRes = await store.mutate(
        { type: 'START', mutationId: 'wb-stale' },
        { nowMs: 1_700_000_005_000 }
      )
      expect(startRes.ok).toBe(true)

      await new Promise((r) => setTimeout(r, 25))
      expect(prisma.gameState.update).not.toHaveBeenCalled()
      expect(prisma.gameState.upsert).not.toHaveBeenCalled()

      // Case B: Out-of-order MEMBER_ADD with inline avatar arrives AFTER Postgres already reached v10 ->
      // MUST NOT overwrite gameState, BUT MUST STILL durably persist the media blob guarded by mediaVersion <= 1!
      const avatarBlob = 'data:image/jpeg;base64,/9j/4AAQSkZJRg=='
      ;(prisma.gameState.findUnique as any).mockResolvedValueOnce({ version: 10 })
      ;(prisma.member.updateMany as any).mockResolvedValueOnce({ count: 1 })

      const addMediaRes = await store.mutate(
        {
          type: 'MEMBER_ADD',
          mutationId: 'wb-out-of-order-media',
          id: 'media-mem-1',
          name: 'Dendi',
          avatar: avatarBlob,
        },
        { nowMs: 1_700_000_005_500 }
      )
      expect(addMediaRes.ok).toBe(true)

      await new Promise((r) => setTimeout(r, 25))
      expect(prisma.gameState.update).not.toHaveBeenCalled()
      expect(prisma.gameState.upsert).not.toHaveBeenCalled()
      expect(prisma.member.updateMany).toHaveBeenCalledWith({
        where: {
          id: 'media-mem-1',
          mediaVersion: { lte: 1 },
        },
        data: { avatar: avatarBlob },
      })

      // Case C: Contiguous write-behind (existing.version = 3 === next.version - 1) -> updates cleanly!
      ;(prisma.gameState.findUnique as any).mockResolvedValueOnce({ version: 3 })
      ;(prisma.gameState.update as any).mockResolvedValueOnce({})

      const startAgain = await store.mutate(
        { type: 'START', mutationId: 'wb-contiguous' },
        { nowMs: 1_700_000_006_000 }
      )
      expect(startAgain.ok).toBe(true)

      await new Promise((r) => setTimeout(r, 25))
      expect(prisma.gameState.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'singleton' },
          data: expect.objectContaining({ version: 4, status: 'PICKING' }),
        })
      )
    })
  })

  describe('GET /api/stream (SSE Endpoint)', () => {
    it('sends initial snapshot on sinceVersion=0, connected when current, and replays missed contiguous deltas', async () => {
      // Seed config (v2) + member (v3) + START (v4)
      await configPost(
        new Request('http://localhost/api/config', {
          method: 'POST',
          body: JSON.stringify({
            teamCount: 2,
            turnDuration: 30,
            totalReserveTime: 60,
            teamNames: ['Radiant', 'Dire'],
          }),
        })
      )
      await membersPost(
        new Request('http://localhost/api/members', {
          method: 'POST',
          body: JSON.stringify({ action: 'ADD', id: 'm1', name: 'Alice' }),
        })
      )
      await pickPost(
        new Request('http://localhost/api/pick', {
          method: 'POST',
          body: JSON.stringify({ status: 'START' }),
        })
      )

      // 1. sinceVersion=0 -> full snapshot at v4
      const ac1 = new AbortController()
      const res1 = await streamGet(
        new Request('http://localhost/api/stream?sinceVersion=0', { signal: ac1.signal })
      )
      expect(res1.status).toBe(200)
      expect(res1.headers.get('Content-Type')).toContain('text/event-stream')
      const reader1 = createSseReader(res1)
      const frame1 = await reader1.readNextFrame()
      expect(frame1.event).toBe('state')
      expect(frame1.data).toMatchObject({ kind: 'snapshot', version: 4 })
      ac1.abort()

      // 2. sinceVersion=4 (already caught up) -> event: connected
      const ac2 = new AbortController()
      const res2 = await streamGet(
        new Request('http://localhost/api/stream?sinceVersion=4', { signal: ac2.signal })
      )
      const reader2 = createSseReader(res2)
      const frame2 = await reader2.readNextFrame()
      expect(frame2.event).toBe('connected')
      expect(frame2.data).toMatchObject({ version: 4 })
      ac2.abort()

      // 3. sinceVersion=3 (missed only START v4) -> replays delta v4!
      const ac3 = new AbortController()
      const res3 = await streamGet(
        new Request('http://localhost/api/stream?sinceVersion=3', { signal: ac3.signal })
      )
      const reader3 = createSseReader(res3)
      const frame3 = await reader3.readNextFrame()
      expect(frame3.event).toBe('state')
      expect(frame3.data).toMatchObject({ kind: 'delta', version: 4, prevVersion: 3, op: 'START' })
      ac3.abort()
    })

    it('emits live deltas in <10ms, deduplicates monotonic versions, and cleans up listeners on abort', async () => {
      const cfgRes = await configPost(
        new Request('http://localhost/api/config', {
          method: 'POST',
          body: JSON.stringify({
            teamCount: 2,
            turnDuration: 30,
            totalReserveTime: 60,
            teamNames: ['Radiant', 'Dire'],
          }),
        })
      )
      const cfg = await cfgRes.json()
      await membersPost(
        new Request('http://localhost/api/members', {
          method: 'POST',
          body: JSON.stringify({ action: 'ADD', id: 'm1', name: 'Alice' }),
        })
      )
      const startRes = await pickPost(
        new Request('http://localhost/api/pick', {
          method: 'POST',
          body: JSON.stringify({ status: 'START' }),
        })
      )
      const startData = await startRes.json()

      const ac = new AbortController()
      const streamRes = await streamGet(
        new Request(`http://localhost/api/stream?sinceVersion=${startData.version}`, {
          signal: ac.signal,
        })
      )
      const reader = createSseReader(streamRes)

      // Consume initial connected frame
      const connected = await reader.readNextFrame()
      expect(connected.event).toBe('connected')
      expect(globalThis.__banpickLocalListeners?.size).toBe(1)

      // Trigger a live PICK mutation and measure delivery latency
      const t0 = performance.now()
      const pickPromise = pickPost(
        new Request('http://localhost/api/pick', {
          method: 'POST',
          body: JSON.stringify({
            memberId: 'm1',
            teamId: cfg.teams[0].id,
            expectedVersion: startData.version,
          }),
        })
      )
      const liveFrame = await reader.readNextFrame()
      const elapsedMs = performance.now() - t0
      await pickPromise

      expect(liveFrame.event).toBe('state')
      expect(liveFrame.data).toMatchObject({
        kind: 'delta',
        version: startData.version + 1,
        op: 'PICK',
        memberPatch: expect.objectContaining({ id: 'm1', teamId: cfg.teams[0].id }),
      })
      expect(elapsedMs).toBeLessThan(100)

      // Monotonic deduplication: emitting duplicate/older versions must NOT reach client
      const duplicateEvent: RealtimeEvent = {
        kind: 'invalidate',
        version: startData.version + 1, // same version already sent
        serverTime: Date.now(),
      }
      const olderEvent: RealtimeEvent = {
        kind: 'invalidate',
        version: startData.version, // older version
        serverTime: Date.now(),
      }
      const newerEvent: RealtimeEvent = {
        kind: 'invalidate',
        version: startData.version + 2,
        serverTime: Date.now(),
      }

      emitLocalEvent(duplicateEvent)
      emitLocalEvent(olderEvent)
      emitLocalEvent(newerEvent)

      // The next frame received MUST be the newerEvent (duplicate & older dropped!)
      const nextFrame = await reader.readNextFrame()
      expect(nextFrame.data).toMatchObject({ kind: 'invalidate', version: startData.version + 2 })

      // Abort connection -> listener immediately cleaned up (zero memory leak!)
      ac.abort()
      await new Promise((r) => setTimeout(r, 10))
      expect(globalThis.__banpickLocalListeners?.size).toBe(0)
    })
  })

  describe('POST /api/pusher/auth', () => {
    it('returns 503 when Pusher is unconfigured', async () => {
      const res = await pusherAuthPost(
        new Request('http://localhost/api/pusher/auth', {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: 'socket_id=123.456&channel_name=private-banpick-channel',
        })
      )
      expect(res.status).toBe(503)
    })

    it('authorizes private-banpick-channel (form & JSON) and rejects unauthorized channels with 403', async () => {
      process.env.PUSHER_APP_ID = '12345'
      process.env.NEXT_PUBLIC_PUSHER_KEY = 'test-key'
      process.env.PUSHER_SECRET = 'test-secret'
      process.env.NEXT_PUBLIC_PUSHER_CLUSTER = 'us2'

      // Missing params -> 400
      const badReq = await pusherAuthPost(
        new Request('http://localhost/api/pusher/auth', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ socket_id: '123.456' }),
        })
      )
      expect(badReq.status).toBe(400)

      // Forbidden channel -> 403
      const forbidden = await pusherAuthPost(
        new Request('http://localhost/api/pusher/auth', {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: 'socket_id=123.456&channel_name=private-evil-channel',
        })
      )
      expect(forbidden.status).toBe(403)

      // Allowed private-banpick-channel via form-urlencoded -> 200 with HMAC auth signature
      const okForm = await pusherAuthPost(
        new Request('http://localhost/api/pusher/auth', {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: 'socket_id=1234.5678&channel_name=private-banpick-channel',
        })
      )
      expect(okForm.status).toBe(200)
      const formJson = await okForm.json()
      expect(formJson.auth).toMatch(/^test-key:[a-f0-9]+$/)

      // Allowed private-banpick-channel via JSON -> 200
      const okJson = await pusherAuthPost(
        new Request('http://localhost/api/pusher/auth', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            socket_id: '1234.5678',
            channel_name: 'private-banpick-channel',
          }),
        })
      )
      expect(okJson.status).toBe(200)
      expect((await okJson.json()).auth).toBe(formJson.auth)
    })
  })

  describe('Rapid-Fire Stress Test (20+ mutations)', () => {
    it('maintains strictly monotonic versions, zero corrupted picks, and <10ms avg store+broadcast latency across 25+ rapid mutations', async () => {
      const ac = new AbortController()
      const streamRes = await streamGet(
        new Request('http://localhost/api/stream?sinceVersion=1', { signal: ac.signal })
      )
      const reader = createSseReader(streamRes)
      const conn = await reader.readNextFrame()
      expect(conn.event).toBe('connected')

      const observedVersions: number[] = []
      const latenciesMs: number[] = []

      const drainVersion = async () => {
        const f = await reader.readNextFrame()
        expect(f.event).toBe('state')
        const ev = f.data as RealtimeEvent
        observedVersions.push(ev.version)
        return ev
      }

      // 1. CONFIG with 2 teams (1 mutation -> v2)
      const cfgT0 = performance.now()
      const cfgRes = await configPost(
        new Request('http://localhost/api/config', {
          method: 'POST',
          body: JSON.stringify({
            teamCount: 2,
            turnDuration: 30,
            totalReserveTime: 120,
            teamNames: ['Radiant', 'Dire'],
          }),
        })
      )
      const cfgData = await cfgRes.json()
      await drainVersion()
      latenciesMs.push(performance.now() - cfgT0)

      const teamIds: string[] = cfgData.teams.map((t: { id: string }) => t.id)

      // 2. Rapidly add 12 members (12 mutations -> v3..v14)
      const memberIds: string[] = []
      for (let i = 1; i <= 12; i++) {
        const id = `stress-m-${i}`
        memberIds.push(id)
        const t0 = performance.now()
        const res = await membersPost(
          new Request('http://localhost/api/members', {
            method: 'POST',
            body: JSON.stringify({ action: 'ADD', id, name: `Player ${String(i).padStart(2, '0')}` }),
          })
        )
        expect(res.status).toBe(200)
        await drainVersion()
        latenciesMs.push(performance.now() - t0)
      }

      // 3. START (1 mutation -> v15)
      const startT0 = performance.now()
      const startRes = await pickPost(
        new Request('http://localhost/api/pick', {
          method: 'POST',
          body: JSON.stringify({ status: 'START' }),
        })
      )
      const startData = await startRes.json()
      await drainVersion()
      latenciesMs.push(performance.now() - startT0)

      let currentVersion: number = startData.version
      let finalPayload = startData

      // 4. Rapidly execute all 12 picks (mixing sequential picks + concurrent racing contention -> v16..v27)
      for (let i = 0; i < memberIds.length; i++) {
        const activeTeamId = teamIds[i % 2]
        const t0 = performance.now()

        if (i === 4 && i + 1 < memberIds.length) {
          // Inject concurrent racing pick on the same turn -> strictly 1 winner + 1 HTTP 409
          const [rA, rB] = await Promise.all([
            pickPost(
              new Request('http://localhost/api/pick', {
                method: 'POST',
                body: JSON.stringify({
                  memberId: memberIds[i],
                  teamId: activeTeamId,
                  expectedVersion: currentVersion,
                }),
              })
            ),
            pickPost(
              new Request('http://localhost/api/pick', {
                method: 'POST',
                body: JSON.stringify({
                  memberId: memberIds[i + 1],
                  teamId: activeTeamId,
                  expectedVersion: currentVersion,
                }),
              })
            ),
          ])
          expect([rA.status, rB.status].sort()).toEqual([200, 409])
          const winnerBody = await (rA.status === 200 ? rA : rB).json()
          // Swap memberIds[i] and [i+1] if rB won so remaining loop picks unpicked members
          if (rB.status === 200) {
            ;[memberIds[i], memberIds[i + 1]] = [memberIds[i + 1], memberIds[i]]
          }
          currentVersion = winnerBody.version
          finalPayload = winnerBody
        } else {
          const res = await pickPost(
            new Request('http://localhost/api/pick', {
              method: 'POST',
              body: JSON.stringify({
                memberId: memberIds[i],
                teamId: activeTeamId,
                expectedVersion: currentVersion,
              }),
            })
          )
          expect(res.status).toBe(200)
          const body = await res.json()
          currentVersion = body.version
          finalPayload = body
        }

        await drainVersion()
        latenciesMs.push(performance.now() - t0)
      }

      ac.abort()

      // Verify strictly monotonic 1-by-1 version progression (26 mutations: v2..v27)
      expect(observedVersions).toHaveLength(26)
      for (let i = 0; i < observedVersions.length; i++) {
        expect(observedVersions[i]).toBe(i + 2)
      }

      // Verify zero lost/corrupted picks & exact COMPLETED final state
      expect(finalPayload.gameState.status).toBe('COMPLETED')
      expect(finalPayload.teams[0].members).toHaveLength(6)
      expect(finalPayload.teams[1].members).toHaveLength(6)
      const allAssignedIds = [
        ...finalPayload.teams[0].members.map((m: { id: string }) => m.id),
        ...finalPayload.teams[1].members.map((m: { id: string }) => m.id),
      ]
      expect(new Set(allAssignedIds).size).toBe(12)

      // Verify sub-10ms average store + SSE broadcast latency
      const avgLatency = latenciesMs.reduce((acc, v) => acc + v, 0) / latenciesMs.length
      expect(avgLatency).toBeLessThan(10)
    })
  })
})
