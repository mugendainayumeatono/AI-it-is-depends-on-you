import { renderHook, waitFor } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { useGameState } from '@/hooks/useGameState'
import useSWR from 'swr'

vi.mock('swr')

describe('Hook: useGameState', () => {
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

  it('should return error when fetch fails', async () => {
    ;(useSWR as any).mockReturnValue({
      data: undefined,
      error: new Error('Failed'),
      mutate: vi.fn()
    })

    const { result } = renderHook(() => useGameState())
    expect(result.current.isError).toBeDefined()
  })
})
