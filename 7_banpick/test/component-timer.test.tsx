import { render, screen } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import Timer from '@/components/Timer'
import { GameState, Team } from '@/types'

describe('Component: Timer', () => {
  const now = new Date('2026-04-08T12:00:00Z').getTime()
  
  const mockGameState: GameState = {
    id: 'singleton',
    status: 'PICKING',
    currentTeamIndex: 0,
    turnDuration: 10,
    totalReserveTime: 60,
    teamCount: 2,
    turnStartTime: new Date(now).toISOString()
  }

  const mockTeam: Team = {
    id: 'team1',
    name: 'Team Alpha',
    order: 0,
    reserveTime: 30,
    members: []
  }

  const mutate = vi.fn()

  beforeEach(() => {
    vi.useRealTimers() // Use real timers but control the 'now' via system time if needed, 
    // but better yet, just control the input props.
    vi.setSystemTime(new Date(now))
    global.fetch = vi.fn().mockImplementation(() => Promise.resolve({
      json: () => Promise.resolve({ success: true })
    }))
  })

  it('should display turn time initially', () => {
    render(<Timer gameState={mockGameState} currentTeam={mockTeam} mutate={mutate} />)
    expect(screen.getByText(/Turn Time/i)).toBeDefined()
    // 10s turn duration, 0s elapsed
    expect(screen.getByText(/10/)).toBeDefined()
  })

  it('should switch to bonus time when turn time is exceeded', () => {
    // 11 seconds have passed since turnStartTime
    const state = { 
      ...mockGameState, 
      turnStartTime: new Date(now - 11000).toISOString() 
    }
    
    render(<Timer gameState={state} currentTeam={mockTeam} mutate={mutate} />)
    
    expect(screen.getByText(/Reserve Time/i)).toBeDefined()
    // 30s reserve - (11s - 10s) = 29s
    expect(screen.getByText(/29/)).toBeDefined()
  })

  it('should auto-pick when reserve time runs out', () => {
    vi.useFakeTimers()
    const mutate = vi.fn()
    
    // Setup state where we have exactly 1s of reserve time left
    const state = { 
      ...mockGameState, 
      turnStartTime: new Date(now - 10000).toISOString() // Turn time is just over
    }
    
    const team = { ...mockTeam, reserveTime: 1 } // Only 1 second of reserve
    
    render(<Timer gameState={state} currentTeam={team} mutate={mutate} />)
    
    // Advance timer by 2 seconds to exhaust the remaining 1s
    vi.advanceTimersByTime(2000)
    
    expect(global.fetch).toHaveBeenCalledWith('/api/pick', expect.objectContaining({
      method: 'POST',
      body: expect.stringContaining('AUTO_PICK')
    }))
    
    vi.useRealTimers()
  })
})
