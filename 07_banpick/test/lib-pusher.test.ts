import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import prisma from '@/lib/prisma'
import type { SnapshotEvent, StateDelta } from '@/types'

const mockTrigger = vi.fn()
const mockPusherCtor = vi.fn()

vi.mock('pusher', () => ({
  default: class MockPusher {
    trigger = mockTrigger
    constructor(options: unknown) {
      mockPusherCtor(options)
    }
  },
}))

describe('Pusher Utility (src/lib/pusher.ts)', () => {
  const originalEnv = process.env

  beforeEach(() => {
    vi.resetModules()
    process.env = { ...originalEnv }
    delete process.env.NEXT_PUBLIC_SYNC_METHOD
    delete process.env.PUSHER_APP_ID
    delete process.env.NEXT_PUBLIC_PUSHER_KEY
    delete process.env.PUSHER_SECRET
    delete process.env.NEXT_PUBLIC_PUSHER_CLUSTER
    globalThis.__banpickPusherCache = undefined
    vi.clearAllMocks()
  })

  afterEach(() => {
    process.env = originalEnv
    globalThis.__banpickPusherCache = undefined
  })

  it('initializes pusherServer/getPusherServer when all credentials are present', async () => {
    process.env.PUSHER_APP_ID = 'app-id'
    process.env.NEXT_PUBLIC_PUSHER_KEY = 'key'
    process.env.PUSHER_SECRET = 'secret'
    process.env.NEXT_PUBLIC_PUSHER_CLUSTER = 'us2'

    const { getPusherServer, isPusherServerConfigured, pusherServer } = await import('@/lib/pusher')

    expect(isPusherServerConfigured()).toBe(true)
    expect(pusherServer).not.toBeNull()
    expect(getPusherServer()).toBe(pusherServer)
    expect(mockPusherCtor).toHaveBeenCalledTimes(1)
  })

  it('returns null when required credentials are missing', async () => {
    const { getPusherServer, isPusherServerConfigured, pusherServer } = await import('@/lib/pusher')

    expect(isPusherServerConfigured()).toBe(false)
    expect(pusherServer).toBeNull()
    expect(getPusherServer()).toBeNull()
  })

  it('triggerStateUpdate performs ZERO DB queries and sends compact ~300B delta payload', async () => {
    process.env.NEXT_PUBLIC_SYNC_METHOD = 'PUSHER'
    process.env.PUSHER_APP_ID = 'app-id'
    process.env.NEXT_PUBLIC_PUSHER_KEY = 'key'
    process.env.PUSHER_SECRET = 'secret'
    process.env.NEXT_PUBLIC_PUSHER_CLUSTER = 'us2'

    const { triggerStateUpdate } = await import('@/lib/pusher')

    const delta: StateDelta = {
      kind: 'delta',
      version: 5,
      prevVersion: 4,
      serverTime: 1700000000000,
      mutationId: 'mut-1',
      clientId: 'cli-1',
      op: 'PICK',
      gameState: {
        id: 'singleton',
        version: 5,
        currentTeamIndex: 1,
        turnStartTime: '2026-04-08T12:00:00.000Z',
        status: 'PICKING',
        turnDuration: 30,
        totalReserveTime: 120,
        teamCount: 2,
      },
      teamPatch: { id: 't1', reserveTime: 115 },
      memberPatch: { id: 'm1', teamId: 't1', pickedAt: '2026-04-08T12:00:00.000Z' },
    }

    await triggerStateUpdate(delta)

    // ZERO Prisma DB queries executed inside triggerStateUpdate!
    expect(prisma.gameState.findUnique).not.toHaveBeenCalled()
    expect(prisma.team.findMany).not.toHaveBeenCalled()
    expect(prisma.member.findMany).not.toHaveBeenCalled()

    expect(mockTrigger).toHaveBeenCalledTimes(1)
    expect(mockTrigger).toHaveBeenCalledWith('banpick-channel', 'state-update', delta)

    const byteSize = Buffer.byteLength(JSON.stringify(delta), 'utf8')
    expect(byteSize).toBeLessThan(600)
  })

  it('automatically downgrades oversized (>9000B) payloads to tiny invalidate event (prevents HTTP 413)', async () => {
    process.env.NEXT_PUBLIC_SYNC_METHOD = 'AUTO'
    process.env.PUSHER_APP_ID = 'app-id'
    process.env.NEXT_PUBLIC_PUSHER_KEY = 'key'
    process.env.PUSHER_SECRET = 'secret'
    process.env.NEXT_PUBLIC_PUSHER_CLUSTER = 'us2'

    const { buildSafePusherPayload, PUSHER_MAX_SAFE_BYTES, triggerStateUpdate } = await import(
      '@/lib/pusher'
    )

    // Construct a >12KB snapshot event (e.g. many members with long bios)
    const manyMembers = Array.from({ length: 60 }, (_, idx) => ({
      id: `member-${idx}`,
      name: `Player ${idx}`,
      info: 'X'.repeat(200),
      avatar: `/api/members/member-${idx}/media?field=avatar&v=1`,
      background: `/api/members/member-${idx}/media?field=background&v=1`,
      teamId: null,
      isBanned: false,
      pickedAt: null,
    }))

    const oversizedEvent: SnapshotEvent = {
      kind: 'snapshot',
      version: 42,
      serverTime: 1700000000000,
      mutationId: 'mut-huge',
      clientId: 'cli-1',
      snapshot: {
        version: 42,
        serverTime: 1700000000000,
        lastMutationId: 'mut-huge',
        gameState: {
          id: 'singleton',
          version: 42,
          currentTeamIndex: 0,
          turnStartTime: null,
          status: 'CONFIGURING',
          turnDuration: 30,
          totalReserveTime: 120,
          teamCount: 2,
        },
        teams: [],
        members: manyMembers,
      },
    }

    expect(Buffer.byteLength(JSON.stringify(oversizedEvent), 'utf8')).toBeGreaterThan(
      PUSHER_MAX_SAFE_BYTES
    )

    const safePayload = buildSafePusherPayload(oversizedEvent)
    expect(safePayload).toEqual({
      kind: 'invalidate',
      version: 42,
      serverTime: 1700000000000,
      mutationId: 'mut-huge',
    })
    expect(Buffer.byteLength(JSON.stringify(safePayload), 'utf8')).toBeLessThan(200)

    await triggerStateUpdate(oversizedEvent)
    expect(mockTrigger).toHaveBeenCalledWith('banpick-channel', 'state-update', {
      kind: 'invalidate',
      version: 42,
      serverTime: 1700000000000,
      mutationId: 'mut-huge',
    })
    expect(prisma.gameState.findUnique).not.toHaveBeenCalled()
  })

  it('suppresses trigger when NEXT_PUBLIC_SYNC_METHOD is POLLING or SSE', async () => {
    process.env.PUSHER_APP_ID = 'app-id'
    process.env.NEXT_PUBLIC_PUSHER_KEY = 'key'
    process.env.PUSHER_SECRET = 'secret'
    process.env.NEXT_PUBLIC_PUSHER_CLUSTER = 'us2'

    const { triggerStateUpdate } = await import('@/lib/pusher')

    process.env.NEXT_PUBLIC_SYNC_METHOD = 'POLLING'
    await triggerStateUpdate()
    expect(mockTrigger).not.toHaveBeenCalled()

    process.env.NEXT_PUBLIC_SYNC_METHOD = 'SSE'
    await triggerStateUpdate()
    expect(mockTrigger).not.toHaveBeenCalled()
  })

  it('emits invalidate fallback payload when triggerStateUpdate() is called with no event', async () => {
    process.env.NEXT_PUBLIC_SYNC_METHOD = 'PUSHER'
    process.env.PUSHER_APP_ID = 'app-id'
    process.env.NEXT_PUBLIC_PUSHER_KEY = 'key'
    process.env.PUSHER_SECRET = 'secret'
    process.env.NEXT_PUBLIC_PUSHER_CLUSTER = 'us2'

    const { triggerStateUpdate } = await import('@/lib/pusher')
    await triggerStateUpdate()

    expect(mockTrigger).toHaveBeenCalledWith(
      'banpick-channel',
      'state-update',
      expect.objectContaining({
        kind: 'invalidate',
        version: 0,
        timestamp: expect.any(Number),
      })
    )
    expect(prisma.gameState.findUnique).not.toHaveBeenCalled()
  })
})
