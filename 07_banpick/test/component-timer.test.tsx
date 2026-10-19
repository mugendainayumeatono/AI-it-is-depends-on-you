import { render, screen, act } from '@testing-library/react'
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

  const onAutoPick = vi.fn()

  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(now))
    global.fetch = vi.fn().mockImplementation(() => Promise.resolve({
      ok: true,
      json: () => Promise.resolve({ success: true })
    }))
    onAutoPick.mockClear()
  })

  it('should display turn time initially', () => {
    render(<Timer gameState={mockGameState} currentTeam={mockTeam} serverOffset={0} onAutoPick={onAutoPick} />)
    expect(screen.getByText(/Turn Time/i)).toBeDefined()
    // 10s turn duration, 0s elapsed
    expect(screen.getByText(/10s/)).toBeDefined()
  })

  it('should account for serverOffset when calculating time', () => {
    // Client is 5 seconds behind server (serverOffset = 5000)
    // Server says turn started at 'now', client thinks it's 'now'.
    // With offset, client thinks it's 'now + 5s', so 5s have "passed" according to server.
    render(<Timer gameState={mockGameState} currentTeam={mockTeam} serverOffset={5000} onAutoPick={onAutoPick} />)
    
    // 10s turn - 5s elapsed = 5s
    expect(screen.getByText(/5s/)).toBeDefined()
  })

  it('should switch to bonus time when turn time is exceeded', () => {
    // 11 seconds have passed since turnStartTime
    const state = { 
      ...mockGameState, 
      turnStartTime: new Date(now - 11000).toISOString() 
    }
    
    render(<Timer gameState={state} currentTeam={mockTeam} serverOffset={0} onAutoPick={onAutoPick} />)
    
    expect(screen.getByText(/Reserve Time/i)).toBeDefined()
    // 30s reserve - (11s - 10s) = 29s
    expect(screen.getByText(/29s/)).toBeDefined()
  })

  it('should auto-pick when reserve time runs out', async () => {
    // 10s turn duration, turn started 10s ago, reserve time 1s.
    // Total time allowed is 11s.
    const state = { 
      ...mockGameState, 
      turnStartTime: new Date(now - 10000).toISOString() 
    }
    const team = { ...mockTeam, reserveTime: 1 }
    
    render(<Timer gameState={state} currentTeam={team} serverOffset={0} onAutoPick={onAutoPick} />)
    
    // Advance time to 1.1s later (total 11.1s since start)
    await act(async () => {
      vi.advanceTimersByTime(1100)
    })
    
    expect(onAutoPick).toHaveBeenCalled()
  })

  it('should not call auto-pick multiple times due to ref locking', async () => {
    const state = { 
      ...mockGameState, 
      turnStartTime: new Date(now - 11000).toISOString() 
    }
    const team = { ...mockTeam, reserveTime: 0 } // Already expired
    
    render(<Timer gameState={state} currentTeam={team} serverOffset={0} onAutoPick={onAutoPick} />)
    
    await act(async () => {
      vi.advanceTimersByTime(100)
      vi.advanceTimersByTime(100)
      vi.advanceTimersByTime(100)
    })
    
    // Only called once because of isAutoPicking.current = true
    expect(onAutoPick).toHaveBeenCalledTimes(1)
  })
})
