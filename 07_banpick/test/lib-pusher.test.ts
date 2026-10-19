import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const mockTrigger = vi.fn()
vi.mock('pusher', () => {
  return {
    default: class MockPusher {
      trigger = mockTrigger;
      constructor(options: any) {}
    }
  }
})

vi.mock('@/lib/prisma', () => {
  return {
    default: {
      gameState: { findUnique: vi.fn().mockResolvedValue({ id: 'singleton' }) },
      team: { findMany: vi.fn().mockResolvedValue([]) },
      member: { findMany: vi.fn().mockResolvedValue([]) }
    }
  }
})

describe('Pusher Utility', () => {
  const originalEnv = process.env

  beforeEach(() => {
    vi.resetModules()
    process.env = { ...originalEnv }
    mockTrigger.mockClear()
  })

  afterEach(() => {
    process.env = originalEnv
    vi.clearAllMocks()
  })

  it('should initialize pusherServer when env variables are present', async () => {
    process.env.PUSHER_APP_ID = 'app-id'
    process.env.NEXT_PUBLIC_PUSHER_KEY = 'key'
    process.env.PUSHER_SECRET = 'secret'
    process.env.NEXT_PUBLIC_PUSHER_CLUSTER = 'cluster'

    const { pusherServer } = await import('@/lib/pusher')
    
    expect(pusherServer).toBeDefined()
  })

  it('should not initialize pusherServer when env variables are missing', async () => {
    delete process.env.PUSHER_APP_ID
    
    const { pusherServer } = await import('@/lib/pusher')
    
    expect(pusherServer).toBeNull()
  })

  it('triggerStateUpdate should call trigger when method is PUSHER', async () => {
    process.env.NEXT_PUBLIC_SYNC_METHOD = 'PUSHER'
    process.env.PUSHER_APP_ID = 'app-id'
    process.env.NEXT_PUBLIC_PUSHER_KEY = 'key'
    process.env.PUSHER_SECRET = 'secret'
    process.env.NEXT_PUBLIC_PUSHER_CLUSTER = 'cluster'

    const { triggerStateUpdate } = await import('@/lib/pusher')
    
    await triggerStateUpdate()
    
    expect(mockTrigger).toHaveBeenCalledWith(
      'banpick-channel', 
      'state-update', 
      expect.objectContaining({ timestamp: expect.any(Number) })
    )
  })

  it('triggerStateUpdate should do nothing when method is POLLING', async () => {
    process.env.NEXT_PUBLIC_SYNC_METHOD = 'POLLING'
    process.env.PUSHER_APP_ID = 'app-id'
    process.env.NEXT_PUBLIC_PUSHER_KEY = 'key'
    process.env.PUSHER_SECRET = 'secret'
    process.env.NEXT_PUBLIC_PUSHER_CLUSTER = 'cluster'

    const { triggerStateUpdate } = await import('@/lib/pusher')
    
    await triggerStateUpdate()
    
    expect(mockTrigger).not.toHaveBeenCalled()
  })
})
