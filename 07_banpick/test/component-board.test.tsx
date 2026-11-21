import { render, screen, fireEvent, waitFor, act } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import Board from '@/components/Board'
import type { GameState, Member, Team } from '@/types'

describe('Component: Board', () => {
  const mockState: GameState = {
    id: 'singleton',
    version: 3,
    status: 'PICKING',
    currentTeamIndex: 0,
    teamCount: 2,
    turnDuration: 30,
    totalReserveTime: 120,
    turnStartTime: new Date().toISOString(),
  }

  const mockTeams: Team[] = [
    { id: 't1', name: 'Team Alpha', order: 0, reserveTime: 120, members: [] },
    { id: 't2', name: 'Team Beta', order: 1, reserveTime: 120, members: [] },
  ]

  const mockMembers: Member[] = [
    {
      id: 'm1',
      name: 'Player 1',
      info: 'Carry',
      avatar: null,
      background: null,
      teamId: null,
      isBanned: false,
      pickedAt: null,
    },
  ]

  beforeEach(() => {
    vi.clearAllMocks()
    global.fetch = vi.fn().mockImplementation(() =>
      Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ success: true }),
      })
    )
    global.confirm = vi.fn().mockReturnValue(true)
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('should render teams and available members', () => {
    render(
      <Board
        gameState={mockState}
        teams={mockTeams}
        members={mockMembers}
        serverOffset={0}
        dispatchMutation={vi.fn().mockResolvedValue({ ok: true })}
        setShowConfig={vi.fn()}
      />
    )
    expect(screen.getByText(/Available Members/i)).toBeDefined()
    expect(screen.getByText(/Player 1/i)).toBeDefined()
    expect(screen.getByRole('heading', { name: /Team Alpha/i })).toBeDefined()
    expect(screen.getByRole('heading', { name: /Team Beta/i })).toBeDefined()
  })

  it('should dispatch START optimistically without blocking action buttons', () => {
    // Keep dispatchMutation pending to verify buttons remain responsive (no isStarting lock)
    const dispatchMutation = vi.fn(() => new Promise<{ ok: boolean }>(() => {}))
    const setShowConfig = vi.fn()

    render(
      <Board
        gameState={{ ...mockState, status: 'CONFIGURING', turnStartTime: null }}
        teams={mockTeams}
        members={mockMembers}
        serverOffset={0}
        dispatchMutation={dispatchMutation}
        setShowConfig={setShowConfig}
      />
    )

    const startBtn = screen.getByRole('button', { name: /Start Picking/i })
    fireEvent.click(startBtn)

    expect(dispatchMutation).toHaveBeenCalledWith({ type: 'START' })
    // No blocking lock: Configuration & Random Teams remain enabled immediately
    const configBtn = screen.getByRole('button', { name: /Configuration/i })
    const randomBtn = screen.getByRole('button', { name: /Random Teams/i })
    expect(configBtn).not.toBeDisabled()
    expect(randomBtn).not.toBeDisabled()
    expect(global.fetch).not.toHaveBeenCalled()
  })

  it('should dispatch RANDOMIZE via dispatchMutation when confirmed', () => {
    const dispatchMutation = vi.fn().mockResolvedValue({ ok: true })
    render(
      <Board
        gameState={mockState}
        teams={mockTeams}
        members={mockMembers}
        serverOffset={0}
        dispatchMutation={dispatchMutation}
        setShowConfig={vi.fn()}
      />
    )

    fireEvent.click(screen.getByText(/Random Teams/i))
    expect(dispatchMutation).toHaveBeenCalledWith({ type: 'RANDOMIZE' })
    expect(global.fetch).not.toHaveBeenCalled()
  })

  it('should NOT dispatch RANDOMIZE when user cancels confirm dialog', () => {
    global.confirm = vi.fn().mockReturnValue(false)
    const dispatchMutation = vi.fn().mockResolvedValue({ ok: true })

    render(
      <Board
        gameState={mockState}
        teams={mockTeams}
        members={mockMembers}
        serverOffset={0}
        dispatchMutation={dispatchMutation}
        setShowConfig={vi.fn()}
      />
    )

    fireEvent.click(screen.getByText(/Random Teams/i))
    expect(dispatchMutation).not.toHaveBeenCalled()
  })

  it('should dispatch CONFIG reset preserving totalReserveTime = 0', () => {
    const dispatchMutation = vi.fn().mockResolvedValue({ ok: true })
    render(
      <Board
        gameState={{ ...mockState, totalReserveTime: 0 }}
        teams={mockTeams}
        members={mockMembers}
        serverOffset={0}
        dispatchMutation={dispatchMutation}
        setShowConfig={vi.fn()}
      />
    )

    fireEvent.click(screen.getByText(/Reset Draft/i))
    expect(dispatchMutation).toHaveBeenCalledWith({
      type: 'CONFIG',
      teamCount: 2,
      turnDuration: 30,
      totalReserveTime: 0,
      teamNames: ['Team Alpha', 'Team Beta'],
    })
  })

  it('should dispatch AUTO_PICK with expectedVersion from Timer expiry', async () => {
    const dispatchMutation = vi.fn().mockResolvedValue({ ok: true })
    const now = Date.now()
    const state: GameState = {
      ...mockState,
      version: 9,
      status: 'PICKING',
      turnStartTime: new Date(now - 40000).toISOString(),
    }
    const teams: Team[] = [{ ...mockTeams[0], reserveTime: 0 }, mockTeams[1]]

    vi.useFakeTimers()
    vi.setSystemTime(new Date(now))

    render(
      <Board
        gameState={state}
        teams={teams}
        members={mockMembers}
        serverOffset={0}
        dispatchMutation={dispatchMutation}
        setShowConfig={vi.fn()}
      />
    )

    await act(async () => {
      vi.advanceTimersByTime(1000)
    })

    expect(dispatchMutation).toHaveBeenCalledTimes(1)
    expect(dispatchMutation).toHaveBeenCalledWith({
      type: 'AUTO_PICK',
      teamId: 't1',
      expectedVersion: 9,
    })
  })

  it('should render Draft Completed banner when status is COMPLETED', () => {
    render(
      <Board
        gameState={{ ...mockState, status: 'COMPLETED' }}
        teams={mockTeams}
        members={mockMembers}
        serverOffset={0}
        dispatchMutation={vi.fn().mockResolvedValue({ ok: true })}
        setShowConfig={vi.fn()}
      />
    )
    expect(screen.getByText(/Draft Completed/i)).toBeDefined()
    expect(screen.getByText(/Reset Draft/i)).toBeDefined()
  })

  it('standalone fallback: calls /api/pick for START and /api/randomize when dispatchMutation is omitted', () => {
    const mutate = vi.fn()
    render(
      <Board
        gameState={{ ...mockState, status: 'CONFIGURING', turnStartTime: null }}
        teams={mockTeams}
        members={mockMembers}
        serverOffset={0}
        mutate={mutate}
        setShowConfig={vi.fn()}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: /Start Picking/i }))
    expect(mutate).toHaveBeenCalledWith(
      expect.objectContaining({
        gameState: expect.objectContaining({ status: 'PICKING' }),
      }),
      { revalidate: false }
    )
    expect(global.fetch).toHaveBeenCalledWith(
      '/api/pick',
      expect.objectContaining({
        method: 'POST',
        body: expect.stringContaining('"status":"START"'),
      })
    )

    fireEvent.click(screen.getByText(/Random Teams/i))
    expect(global.fetch).toHaveBeenCalledWith(
      '/api/randomize',
      expect.objectContaining({ method: 'POST' })
    )
  })

  it('standalone fallback: handles auto-pick and rolls back on 409 failure', async () => {
    const mutate = vi.fn()
    const now = Date.now()
    const state: GameState = {
      ...mockState,
      version: 4,
      status: 'PICKING',
      turnStartTime: new Date(now - 40000).toISOString(),
    }
    const teams: Team[] = [{ ...mockTeams[0], reserveTime: 0 }, mockTeams[1]]

    global.fetch = vi.fn().mockImplementation(() =>
      Promise.resolve({
        ok: false,
        status: 409,
        json: () => Promise.resolve({ error: 'Turn has already been taken' }),
      })
    )

    vi.useFakeTimers()
    vi.setSystemTime(new Date(now))

    render(
      <Board
        gameState={state}
        teams={teams}
        members={mockMembers}
        serverOffset={0}
        mutate={mutate}
        setShowConfig={vi.fn()}
      />
    )

    await act(async () => {
      vi.advanceTimersByTime(1000)
    })

    // 1. Optimistic mutate call
    expect(mutate).toHaveBeenCalledWith(
      expect.objectContaining({
        gameState: expect.objectContaining({ currentTeamIndex: 1 }),
      }),
      { revalidate: false }
    )
    expect(global.fetch).toHaveBeenCalledWith(
      '/api/pick',
      expect.objectContaining({
        method: 'POST',
        body: expect.stringContaining('"action":"AUTO_PICK"'),
      })
    )

    vi.useRealTimers()

    // 2. Rollback mutate() call on HTTP 409
    await waitFor(() => {
      expect(mutate).toHaveBeenCalledWith()
    })
  })
})
