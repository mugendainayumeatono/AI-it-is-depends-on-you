import { render, screen, fireEvent, waitFor, act } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import Board from '@/components/Board'

describe('Component: Board', () => {
  const mockState = { status: 'PICKING', currentTeamIndex: 0, teamCount: 2, turnDuration: 30, totalReserveTime: 120, turnStartTime: new Date().toISOString() }
  const mockTeams = [{ id: 't1', name: 'Team Alpha', reserveTime: 120, members: [] }, { id: 't2', name: 'Team Beta', reserveTime: 120, members: [] }]
  const mockMembers = [
    { id: 'm1', name: 'Player 1', teamId: null, info: 'Carry' },
  ]
  const mutate = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
    global.fetch = vi.fn().mockImplementation(() => Promise.resolve({
      json: () => Promise.resolve({ success: true })
    }))
    global.confirm = vi.fn().mockReturnValue(true)
  })

  it('should render teams and available members', () => {
    render(<Board gameState={mockState as any} teams={mockTeams as any} members={mockMembers as any} serverOffset={0} mutate={vi.fn()} setShowConfig={vi.fn()} />)
    expect(screen.getByText(/Available Members/i)).toBeDefined()
    expect(screen.getByText(/Player 1/i)).toBeDefined()
  })

  it('should call randomize API', async () => {
    render(<Board gameState={mockState as any} teams={mockTeams as any} members={mockMembers as any} serverOffset={0} mutate={vi.fn()} setShowConfig={vi.fn()} />)
    const btn = screen.getByText(/Random Teams/i)
    fireEvent.click(btn)
    expect(global.fetch).toHaveBeenCalledWith('/api/randomize', expect.objectContaining({ method: 'POST' }))
  })

  it('should call start game API', async () => {
    render(<Board gameState={{...mockState, status: 'CONFIGURING'} as any} teams={mockTeams as any} members={mockMembers as any} serverOffset={0} mutate={vi.fn()} setShowConfig={vi.fn()} />)
    const btn = screen.getByRole('button', { name: /Start Picking/i })
    fireEvent.click(btn)
    expect(global.fetch).toHaveBeenCalledWith('/api/pick', expect.objectContaining({ method: 'POST', body: JSON.stringify({ status: 'START' }) }))
  })

  it('should call reset draft API', async () => {
    global.confirm = vi.fn().mockReturnValue(true)
    render(<Board gameState={mockState as any} teams={mockTeams as any} members={mockMembers as any} serverOffset={0} mutate={vi.fn()} setShowConfig={vi.fn()} />)
    const btn = screen.getByText(/Reset Draft/i)
    fireEvent.click(btn)
    expect(global.fetch).toHaveBeenCalledWith('/api/config', expect.objectContaining({ method: 'POST' }))
  })

  it('should handle auto-pick from Timer', async () => {
    const mutate = vi.fn()
    // Setup state so Timer triggers onAutoPick immediately
    const now = Date.now()
    const state = { 
      ...mockState, 
      status: 'PICKING',
      turnStartTime: new Date(now - 40000).toISOString() // 40s ago, turn duration is 30s, reserve is 0 (relative to 30s)
    }
    const teams = [{ ...mockTeams[0], reserveTime: 0 }, mockTeams[1]]

    vi.useFakeTimers()
    vi.setSystemTime(new Date(now))

    render(<Board gameState={state as any} teams={teams as any} members={mockMembers as any} serverOffset={0} mutate={mutate} setShowConfig={vi.fn()} />)
    
    // Timer should call onAutoPick
    await act(async () => {
      vi.advanceTimersByTime(1000)
    })

    // handlePick should have been called, which calls mutate optimistically
    expect(mutate).toHaveBeenCalledWith(expect.objectContaining({
      gameState: expect.objectContaining({
        currentTeamIndex: 1
      })
    }), { revalidate: false })
    
    expect(global.fetch).toHaveBeenCalledWith('/api/pick', expect.objectContaining({
      method: 'POST',
      body: expect.stringContaining('"memberId":"m1"')
    }))

    vi.useRealTimers()
  })

  it('should rollback on pick failure', async () => {
    const mutate = vi.fn()
    const now = Date.now()
    const state = { 
      ...mockState, 
      status: 'PICKING',
      turnStartTime: new Date(now - 40000).toISOString()
    }
    const teams = [{ ...mockTeams[0], reserveTime: 0 }, mockTeams[1]]

    global.fetch = vi.fn().mockImplementation(() => Promise.resolve({
      ok: false,
      status: 409
    }))

    vi.useFakeTimers()
    vi.setSystemTime(new Date(now))

    render(<Board gameState={state as any} teams={teams as any} members={mockMembers as any} serverOffset={0} mutate={mutate} setShowConfig={vi.fn()} />)
    
    // Trigger auto-pick
    await act(async () => {
      vi.advanceTimersByTime(1000)
    })

    // 1. Optimistic call
    expect(mutate).toHaveBeenCalledWith(expect.objectContaining({
      gameState: expect.objectContaining({ currentTeamIndex: 1 })
    }), { revalidate: false })

    // 2. Wait for fetch promise and rollback call
    // We need to exit the fake timer loop for the promise to resolve in some environments, 
    // or just use real timers for a bit.
    vi.useRealTimers()
    
    await waitFor(() => {
      expect(mutate).toHaveBeenCalledWith()
    }, { timeout: 2000 })
  })
})
