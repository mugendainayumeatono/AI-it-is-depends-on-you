import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import Home from '@/app/page'
import { useGameState, type UseGameStateReturn } from '@/hooks/useGameState'

vi.mock('@/hooks/useGameState')

function makeHookReturn(overrides: Partial<UseGameStateReturn> = {}): UseGameStateReturn {
  return {
    gameState: {
      id: 'singleton',
      version: 1,
      status: 'PICKING',
      currentTeamIndex: 0,
      turnStartTime: new Date().toISOString(),
      turnDuration: 30,
      totalReserveTime: 120,
      teamCount: 1,
    },
    teams: [{ id: 't1', name: 'Team 1', order: 0, members: [], reserveTime: 30 }],
    members: [],
    version: 1,
    serverOffset: 0,
    isLoading: false,
    isError: undefined,
    syncMode: 'SSE',
    connectionStatus: 'connected',
    pendingCount: 0,
    dispatchMutation: vi.fn().mockResolvedValue({ ok: true }),
    mutate: vi.fn(),
    ...overrides,
  }
}

describe('Page: Home', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should show loading state', () => {
    vi.mocked(useGameState).mockReturnValue(
      makeHookReturn({ isLoading: true, gameState: undefined, teams: [], members: [] })
    )
    render(<Home />)
    expect(screen.getByText(/Loading session state/i)).toBeDefined()
  })

  it('should show error state', () => {
    vi.mocked(useGameState).mockReturnValue(
      makeHookReturn({ isError: new Error('DB down'), gameState: undefined })
    )
    render(<Home />)
    expect(screen.getByText(/Error Connecting to Database/i)).toBeDefined()
  })

  it('should show configuration prompt when status is CONFIGURING', () => {
    vi.mocked(useGameState).mockReturnValue(
      makeHookReturn({
        gameState: {
          id: 'singleton',
          version: 1,
          status: 'CONFIGURING',
          currentTeamIndex: 0,
          turnStartTime: null,
          turnDuration: 30,
          totalReserveTime: 120,
          teamCount: 2,
        },
        teams: [],
        members: [],
      })
    )
    render(<Home />)
    expect(screen.getByText(/Game is in configuration mode/i)).toBeDefined()
  })

  it('should update fixed spotlight via rAF on mousemove without calling getBoundingClientRect', () => {
    vi.mocked(useGameState).mockReturnValue(makeHookReturn())
    const rafSpy = vi
      .spyOn(window, 'requestAnimationFrame')
      .mockImplementation((cb: FrameRequestCallback) => {
        cb(0)
        return 1
      })

    const { container } = render(<Home />)
    const spotlight = container.querySelector('.pointer-events-none') as HTMLElement | null
    expect(spotlight).not.toBeNull()

    const rectSpy = vi.fn()
    spotlight!.getBoundingClientRect = rectSpy
    const root = container.firstElementChild as HTMLElement
    root.getBoundingClientRect = rectSpy

    fireEvent.mouseMove(root, { clientX: 123, clientY: 456 })

    expect(spotlight!.style.getPropertyValue('--mouse-x')).toBe('123px')
    expect(spotlight!.style.getPropertyValue('--mouse-y')).toBe('456px')
    expect(rectSpy).not.toHaveBeenCalled()

    rafSpy.mockRestore()
  })

  it('should toggle configuration modal', () => {
    vi.mocked(useGameState).mockReturnValue(makeHookReturn())
    render(<Home />)

    const settingsBtn = screen.getByRole('button', { name: /Configuration/i })
    fireEvent.click(settingsBtn)

    expect(screen.getAllByText(/Back to Board/i).length).toBeGreaterThan(0)

    const backBtn = screen.getAllByRole('button', { name: /Back to Board/i })[0]
    fireEvent.click(backBtn)

    expect(screen.queryByText(/Back to Board/i)).toBeNull()
  })

  it('should show board when status is PICKING', () => {
    vi.mocked(useGameState).mockReturnValue(makeHookReturn())
    render(<Home />)
    expect(screen.getByText(/Available Members/i)).toBeDefined()
  })
})
