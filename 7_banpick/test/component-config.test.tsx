import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import Configuration from '@/components/Configuration'

describe('Component: Configuration', () => {
  const mockState = { teamCount: 2, turnDuration: 30, totalReserveTime: 120, status: 'CONFIGURING' }
  const mockTeams = [{ name: 'T1' }, { name: 'T2' }]
  const mockMembers = [{ id: 'm1', name: 'Member 1', info: 'Info' }]
  const mutate = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
    global.fetch = vi.fn().mockImplementation(() => Promise.resolve({
      json: () => Promise.resolve({ success: true })
    }))
  })

  it('should save settings', async () => {
    render(<Configuration gameState={mockState as any} teams={mockTeams as any} members={mockMembers as any} mutate={mutate} />)
    const btn = screen.getByText(/Save Settings/i)
    fireEvent.click(btn)
    expect(global.fetch).toHaveBeenCalledWith('/api/config', expect.objectContaining({ method: 'POST' }))
  })

  it('should start game', async () => {
    render(<Configuration gameState={mockState as any} teams={mockTeams as any} members={mockMembers as any} mutate={mutate} />)
    const btn = screen.getByText(/Start Picking Phase/i)
    fireEvent.click(btn)
    expect(global.fetch).toHaveBeenCalledWith('/api/pick', expect.objectContaining({ 
        method: 'POST',
        body: JSON.stringify({ status: 'START' })
    }))
  })

  it('should update team count and names array', () => {
    render(<Configuration gameState={mockState as any} teams={mockTeams as any} members={mockMembers as any} mutate={mutate} />)
    const input = screen.getByDisplayValue('2')
    fireEvent.change(input, { target: { value: '4' } })
    // Should now show "Team 4 Name" label
    expect(screen.getByText(/Team 4 Name/i)).toBeDefined()
  })

  it('should call delete member API', async () => {
    render(<Configuration gameState={mockState as any} teams={mockTeams as any} members={mockMembers as any} mutate={mutate} />)
    const delBtn = screen.getByRole('button', { name: '' }) // The trash icon button
    fireEvent.click(delBtn)
    expect(global.fetch).toHaveBeenCalledWith('/api/members', expect.objectContaining({
      body: JSON.stringify({ action: 'DELETE', memberId: 'm1' })
    }))
  })

  it('should update team name', () => {
    render(<Configuration gameState={mockState as any} teams={mockTeams as any} members={mockMembers as any} mutate={mutate} />)
    const input = screen.getByDisplayValue('T1')
    fireEvent.change(input, { target: { value: 'Team Alpha' } })
    expect(input.getAttribute('value')).toBe('Team Alpha')
  })
})
