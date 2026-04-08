import { render, screen, fireEvent, waitFor } from '@testing-library/react'
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
    render(<Board gameState={mockState as any} teams={mockTeams as any} members={mockMembers as any} mutate={mutate} />)
    expect(screen.getByText(/Available Members/i)).toBeDefined()
    expect(screen.getByText(/Player 1/i)).toBeDefined()
  })

  it('should call randomize API', async () => {
    render(<Board gameState={mockState as any} teams={mockTeams as any} members={mockMembers as any} mutate={mutate} />)
    const btn = screen.getByText(/Random Teams/i)
    fireEvent.click(btn)
    expect(global.fetch).toHaveBeenCalledWith('/api/randomize', expect.objectContaining({ method: 'POST' }))
  })

  it('should call reset config API', async () => {
    render(<Board gameState={mockState as any} teams={mockTeams as any} members={mockMembers as any} mutate={mutate} />)
    const btn = screen.getByText(/Back to Config/i)
    fireEvent.click(btn)
    expect(global.fetch).toHaveBeenCalledWith('/api/config', expect.objectContaining({ method: 'POST' }))
  })
})
