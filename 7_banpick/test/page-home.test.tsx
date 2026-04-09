import { render, screen, fireEvent } from '@testing-library/react'
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

  it('should show configuration prompt when status is CONFIGURING', () => {
    ;(useGameState as any).mockReturnValue({
      isLoading: false,
      gameState: { status: 'CONFIGURING' },
      teams: [],
      members: [],
      mutate: vi.fn()
    })
    render(<Home />)
    expect(screen.getByText(/Game is in configuration mode/i)).toBeDefined()
  })

  it('should handle background mouse movement without error', () => {
    ;(useGameState as any).mockReturnValue({
      isLoading: false,
      gameState: { status: 'PICKING', currentTeamIndex: 0 },
      teams: [{ id: 't1', name: 'Team 1', members: [], reserveTime: 30 }],
      members: [],
      mutate: vi.fn()
    })
    const { container } = render(<Home />)
    const background = container.querySelector('.pointer-events-none')
    if (background) {
      // Mock getBoundingClientRect
      background.getBoundingClientRect = vi.fn().mockReturnValue({ left: 0, top: 0, width: 1000, height: 1000 })
      fireEvent.mouseMove(background, { clientX: 100, clientY: 100 })
    }
    
    const boardContainer = container.querySelector('.relative.z-10')
    if (boardContainer) {
      const parent = boardContainer.parentElement
      if (parent) {
        parent.getBoundingClientRect = vi.fn().mockReturnValue({ left: 0, top: 0, width: 1000, height: 1000 })
        fireEvent.mouseMove(boardContainer, { clientX: 100, clientY: 100 })
      }
    }
  })

  it('should toggle configuration modal', () => {
    ;(useGameState as any).mockReturnValue({
      isLoading: false,
      gameState: { status: 'PICKING', currentTeamIndex: 0 },
      teams: [{ id: 't1', name: 'Team 1', members: [], reserveTime: 30 }],
      members: [],
      mutate: vi.fn()
    })
    render(<Home />)
    
    // Open config
    const settingsBtn = screen.getByRole('button', { name: /Configuration/i })
    fireEvent.click(settingsBtn)
    
    expect(screen.getAllByText(/Back to Board/i).length).toBeGreaterThan(0)
    
    // Close config via the top back button
    const backBtn = screen.getAllByRole('button', { name: /Back to Board/i })[0]
    fireEvent.click(backBtn)
    
    // Config should be gone
    expect(screen.queryByText(/Back to Board/i)).toBeNull()
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
