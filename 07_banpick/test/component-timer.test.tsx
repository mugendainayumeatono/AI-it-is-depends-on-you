import { render, screen, act } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import Timer from '@/components/Timer'
import type { GameState, Team } from '@/types'

describe('Component: Timer', () => {
  const now = new Date('2026-04-08T12:00:00Z').getTime()

  const mockGameState: GameState = {
    id: 'singleton',
    version: 2,
    status: 'PICKING',
    currentTeamIndex: 0,
    turnDuration: 10,
    totalReserveTime: 60,
    teamCount: 2,
    turnStartTime: new Date(now).toISOString(),
  }

  const mockTeam: Team = {
    id: 'team1',
    name: 'Team Alpha',
    order: 0,
    reserveTime: 30,
    members: [],
  }

  const onAutoPick = vi.fn()

  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(now))
    onAutoPick.mockClear()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('should display turn time initially', () => {
    render(
      <Timer
        gameState={mockGameState}
        currentTeam={mockTeam}
        serverOffset={0}
        onAutoPick={onAutoPick}
      />
    )
    expect(screen.getByText(/Turn Time/i)).toBeDefined()
    expect(screen.getByText(/10s/)).toBeDefined()
  })

  it('should account for serverOffset when calculating time', () => {
    // Client is 5 seconds behind server (serverOffset = 5000)
    render(
      <Timer
        gameState={mockGameState}
        currentTeam={mockTeam}
        serverOffset={5000}
        onAutoPick={onAutoPick}
      />
    )

    // 10s turn - 5s elapsed = 5s
    expect(screen.getByText(/5s/)).toBeDefined()
  })

  it('should switch to reserve time when turn time is exceeded', () => {
    // 11 seconds have passed since turnStartTime
    const state: GameState = {
      ...mockGameState,
      turnStartTime: new Date(now - 11000).toISOString(),
    }

    render(
      <Timer
        gameState={state}
        currentTeam={mockTeam}
        serverOffset={0}
        onAutoPick={onAutoPick}
      />
    )

    expect(screen.getByText(/Reserve Time/i)).toBeDefined()
    // 30s reserve - (11s - 10s) = 29s
    expect(screen.getByText(/29s/)).toBeDefined()
  })

  it('should auto-pick when reserve time runs out', async () => {
    // 10s turn duration, turn started 10s ago, reserve time 1s -> total 11s
    const state: GameState = {
      ...mockGameState,
      turnStartTime: new Date(now - 10000).toISOString(),
    }
    const team: Team = { ...mockTeam, reserveTime: 1 }

    render(
      <Timer
        gameState={state}
        currentTeam={team}
        serverOffset={0}
        onAutoPick={onAutoPick}
      />
    )

    await act(async () => {
      vi.advanceTimersByTime(1100)
    })

    expect(onAutoPick).toHaveBeenCalledTimes(1)
  })

  it('should not call auto-pick multiple times due to turnKey ref locking', async () => {
    const state: GameState = {
      ...mockGameState,
      turnStartTime: new Date(now - 11000).toISOString(),
    }
    const team: Team = { ...mockTeam, reserveTime: 0 } // Already expired

    render(
      <Timer
        gameState={state}
        currentTeam={team}
        serverOffset={0}
        onAutoPick={onAutoPick}
      />
    )

    await act(async () => {
      vi.advanceTimersByTime(100)
      vi.advanceTimersByTime(100)
      vi.advanceTimersByTime(100)
    })

    expect(onAutoPick).toHaveBeenCalledTimes(1)
  })

  it('regression: passing a fresh/unmemoized onAutoPick callback across parent re-renders NEVER resets guard or fires duplicate AUTO_PICK', async () => {
    const expiredState: GameState = {
      ...mockGameState,
      version: 7,
      turnStartTime: new Date(now - 15000).toISOString(),
    }
    const team: Team = { ...mockTeam, reserveTime: 0 }
    const spy = vi.fn()

    const { rerender } = render(
      <Timer
        gameState={expiredState}
        currentTeam={team}
        serverOffset={0}
        onAutoPick={() => spy('render-1')}
      />
    )

    expect(spy).toHaveBeenCalledTimes(1)

    // Re-render parent multiple times with fresh unmemoized inline closures and new object references
    for (let i = 2; i <= 5; i++) {
      rerender(
        <Timer
          gameState={{ ...expiredState }}
          currentTeam={{ ...team }}
          serverOffset={0}
          onAutoPick={() => spy(`render-${i}`)}
        />
      )
      await act(async () => {
        vi.advanceTimersByTime(250)
      })
    }

    // Must still have fired strictly ONCE for version 7 turn!
    expect(spy).toHaveBeenCalledTimes(1)
    expect(spy).toHaveBeenCalledWith('render-1')

    // Once the server advances to the next turn (version 8 + new turnStartTime),
    // the latest callback IS invoked once when that new turn expires.
    const nextTurnStart = new Date(Date.now() - 12000).toISOString()
    rerender(
      <Timer
        gameState={{
          ...expiredState,
          version: 8,
          currentTeamIndex: 1,
          turnStartTime: nextTurnStart,
        }}
        currentTeam={{ ...team, id: 'team2', name: 'Team Beta', order: 1, reserveTime: 0 }}
        serverOffset={0}
        onAutoPick={() => spy('render-turn-2')}
      />
    )

    expect(spy).toHaveBeenCalledTimes(2)
    expect(spy).toHaveBeenLastCalledWith('render-turn-2')
  })

  it('should gracefully handle null turnStartTime without NaN or triggering auto-pick', async () => {
    const configuringState: GameState = {
      ...mockGameState,
      status: 'CONFIGURING',
      turnStartTime: null,
    }

    render(
      <Timer
        gameState={configuringState}
        currentTeam={mockTeam}
        serverOffset={0}
        onAutoPick={onAutoPick}
      />
    )

    expect(screen.getByText(/10s/)).toBeDefined()

    await act(async () => {
      vi.advanceTimersByTime(2000)
    })

    expect(onAutoPick).not.toHaveBeenCalled()
  })
})
