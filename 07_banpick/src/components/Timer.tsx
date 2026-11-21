'use client'

import { useEffect, useRef, useState } from 'react'
import type { GameState, Team } from '@/types'

interface Props {
  gameState: GameState
  currentTeam: Team
  serverOffset: number
  onAutoPick: () => void
}

interface TimerDisplay {
  timeLeft: number
  isReserve: boolean
  expired: boolean
}

function computeTimerDisplay(
  turnStartTime: string | null,
  turnDuration: number,
  reserveTime: number,
  serverOffset: number,
  status: GameState['status']
): TimerDisplay {
  if (status !== 'PICKING' || !turnStartTime) {
    return {
      timeLeft: Math.max(0, turnDuration),
      isReserve: false,
      expired: false,
    }
  }

  const startTime = Date.parse(turnStartTime)
  if (!Number.isFinite(startTime)) {
    return {
      timeLeft: Math.max(0, turnDuration),
      isReserve: false,
      expired: false,
    }
  }

  const now = Date.now() + serverOffset
  const elapsedTotalMs = now - startTime

  if (elapsedTotalMs < turnDuration * 1000) {
    return {
      timeLeft: Math.max(0, turnDuration - Math.floor(Math.max(0, elapsedTotalMs) / 1000)),
      isReserve: false,
      expired: false,
    }
  }

  const reserveElapsed = Math.floor((elapsedTotalMs - turnDuration * 1000) / 1000)
  const remainingReserve = reserveTime - reserveElapsed
  if (remainingReserve <= 0) {
    return {
      timeLeft: 0,
      isReserve: true,
      expired: true,
    }
  }

  return {
    timeLeft: remainingReserve,
    isReserve: true,
    expired: false,
  }
}

export default function Timer({ gameState, currentTeam, serverOffset, onAutoPick }: Props) {
  const onAutoPickRef = useRef(onAutoPick)
  const autoPickedTurnKeyRef = useRef<string | null>(null)

  const { status, turnStartTime, currentTeamIndex, turnDuration, version } = gameState
  const currentTeamId = currentTeam?.id
  const currentTeamReserve = currentTeam?.reserveTime ?? 0

  const [display, setDisplay] = useState<{ timeLeft: number; isReserve: boolean }>(() => {
    const initial = computeTimerDisplay(
      turnStartTime,
      turnDuration,
      currentTeamReserve,
      serverOffset,
      status
    )
    return { timeLeft: initial.timeLeft, isReserve: initial.isReserve }
  })

  useEffect(() => {
    onAutoPickRef.current = onAutoPick
  }, [onAutoPick])

  useEffect(() => {
    const turnKey = `${version ?? 0}:${turnStartTime ?? 'none'}`

    const updateTimer = () => {
      const next = computeTimerDisplay(
        turnStartTime,
        turnDuration,
        currentTeamReserve,
        serverOffset,
        status
      )

      setDisplay((prev) =>
        prev.timeLeft === next.timeLeft && prev.isReserve === next.isReserve
          ? prev
          : { timeLeft: next.timeLeft, isReserve: next.isReserve }
      )

      if (next.expired && status === 'PICKING' && autoPickedTurnKeyRef.current !== turnKey) {
        autoPickedTurnKeyRef.current = turnKey
        onAutoPickRef.current()
      }
    }

    updateTimer()

    const interval = setInterval(updateTimer, 100)
    return () => clearInterval(interval)
  }, [
    status,
    turnStartTime,
    currentTeamIndex,
    turnDuration,
    version,
    currentTeamId,
    currentTeamReserve,
    serverOffset,
  ])

  return (
    <div
      className={`text-center p-8 rounded-full border-8 w-48 h-48 flex flex-col items-center justify-center transition-colors shadow-lg
      ${
        !display.isReserve
          ? 'border-green-500 bg-green-900/30 text-green-400'
          : display.timeLeft < 30
            ? 'border-red-500 bg-red-900/30 text-red-400 animate-pulse'
            : 'border-blue-500 bg-blue-900/30 text-blue-400'
      }`}
    >
      <p className="text-xs font-bold uppercase mb-1 tracking-wider">
        {display.isReserve ? 'Reserve Time' : 'Turn Time'}
      </p>
      <p className="text-6xl font-black">{display.timeLeft}s</p>
      <p className="text-xs mt-2 font-medium opacity-80">{currentTeam.name}&apos;s Turn</p>
    </div>
  )
}
