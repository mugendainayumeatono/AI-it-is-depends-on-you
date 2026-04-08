import { render, screen } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import Home from '@/app/page'
import { useGameState } from '@/hooks/useGameState'

vi.mock('@/hooks/useGameState')

describe('Page: Home', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should show loading state', () => {
    ;(useGameState as any).mockReturnValue({ isLoading: true })
    render(<Home />)
    expect(screen.getByText(/Loading session state/i)).toBeDefined()
  })

  it('should show error state', () => {
    ;(useGameState as any).mockReturnValue({ isError: true })
    render(<Home />)
    expect(screen.getByText(/Error Connecting to Database/i)).toBeDefined()
  })

  it('should show configuration when status is CONFIGURING', () => {
    ;(useGameState as any).mockReturnValue({
      isLoading: false,
      gameState: { status: 'CONFIGURING' },
      teams: [],
      members: [],
      mutate: vi.fn()
    })
    render(<Home />)
    expect(screen.getByText(/Configuration/i)).toBeDefined()
  })

  it('should show board when status is PICKING', () => {
    ;(useGameState as any).mockReturnValue({
      isLoading: false,
      gameState: { status: 'PICKING', currentTeamIndex: 0 },
      teams: [{ id: 't1', name: 'Team 1', members: [], reserveTime: 30 }],
      members: [],
      mutate: vi.fn()
    })
    render(<Home />)
    // Board contains "Available Members"
    expect(screen.getByText(/Available Members/i)).toBeDefined()
  })
})
