import { renderHook, waitFor, act } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { useGameState } from '@/hooks/useGameState'
import useSWR from 'swr'

vi.mock('swr')

const mocks = vi.hoisted(() => {
  const mockBind = vi.fn()
  const mockSubscribe = vi.fn().mockReturnValue({ bind: mockBind })
  const mockUnsubscribe = vi.fn()
  const mockDisconnect = vi.fn()
  const mockConstructor = vi.fn()

  class MockPusher {
    constructor(key: any, options: any) {
      mockConstructor(key, options)
    }
    subscribe = mockSubscribe
    unsubscribe = mockUnsubscribe
    disconnect = mockDisconnect
  }

  return { mockBind, mockSubscribe, mockUnsubscribe, mockDisconnect, mockConstructor, MockPusher }
})

vi.mock('pusher-js', () => {
  return {
    default: mocks.MockPusher
  }
})

describe('Hook: useGameState', () => {
  const originalEnv = process.env

  beforeEach(() => {
    vi.resetModules()
    process.env = { ...originalEnv }
    vi.clearAllMocks()
    mocks.mockConstructor.mockClear()
  })

  afterEach(() => {
    process.env = originalEnv
  })

  it('should return loading and then data', async () => {
    ;(useSWR as any).mockReturnValue({
      data: { gameState: { status: 'CONFIGURING' }, teams: [], members: [] },
      error: undefined,
      mutate: vi.fn()
    })

    const { result } = renderHook(() => useGameState())
    
    expect(result.current.gameState.status).toBe('CONFIGURING')
    expect(result.current.isLoading).toBe(false)
  })

  it('should handle serverOffset calculation', async () => {
    const serverTime = new Date(Date.now() + 5000).toISOString()
    let onSuccessCallback: any;

    ;(useSWR as any).mockImplementation((url: string, fetcher: any, options: any) => {
      onSuccessCallback = options.onSuccess;
      return {
        data: { gameState: {}, teams: [], members: [], serverTime },
        error: undefined,
        mutate: vi.fn()
      }
    })

    const { result } = renderHook(() => useGameState())
    
    // Manually trigger onSuccess if we captured it
    if (onSuccessCallback) {
      await act(async () => {
        onSuccessCallback({ serverTime })
      })
    }

    // serverOffset should be around 5000ms
    expect(result.current.serverOffset).toBeGreaterThan(4000)
    expect(result.current.serverOffset).toBeLessThan(6000)
  })

  it('should return error when fetch fails', async () => {
    ;(useSWR as any).mockReturnValue({
      data: undefined,
      error: new Error('Failed'),
      mutate: vi.fn()
    })

    const { result } = renderHook(() => useGameState())
    expect(result.current.isError).toBeDefined()
  })

  it('should initialize pusher when sync method is PUSHER', async () => {
    process.env.NEXT_PUBLIC_SYNC_METHOD = 'PUSHER'
    process.env.NEXT_PUBLIC_PUSHER_KEY = 'key'
    process.env.NEXT_PUBLIC_PUSHER_CLUSTER = 'cluster'
    
    ;(useSWR as any).mockReturnValue({
      data: undefined,
      error: undefined,
      mutate: vi.fn()
    })

    const { unmount } = renderHook(() => useGameState())

    expect(mocks.mockConstructor).toHaveBeenCalledWith('key', { cluster: 'cluster' })
    expect(mocks.mockSubscribe).toHaveBeenCalledWith('banpick-channel')
    expect(mocks.mockBind).toHaveBeenCalledWith('state-update', expect.any(Function))

    unmount()

    expect(mocks.mockUnsubscribe).toHaveBeenCalledWith('banpick-channel')
    expect(mocks.mockDisconnect).toHaveBeenCalled()
  })
})
