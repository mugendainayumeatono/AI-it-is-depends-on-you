'use client'

import { useEffect, useState, useRef } from 'react'
import { GameState, Team } from '@/types'

interface Props {
  gameState: GameState
  currentTeam: Team
  serverOffset: number
  onAutoPick: () => void
}

export default function Timer({ gameState, currentTeam, serverOffset, onAutoPick }: Props) {
  // Use a ref to track if an auto-pick is already in progress to avoid multiple calls
  const isAutoPicking = useRef(false)

  const getSyncedNow = () => Date.now() + serverOffset

  const [timeLeft, setTimeLeft] = useState(0)
  const [isReserve, setIsReserve] = useState(false)

  useEffect(() => {
    // Reset auto-picking flag whenever turn changes
    isAutoPicking.current = false

    const updateTimer = () => {
      const now = getSyncedNow()
      const startTime = new Date(gameState.turnStartTime).getTime()
      const elapsed = Math.floor((now - startTime) / 1000)
      
      const turnDuration = gameState.turnDuration
      const reserveTime = currentTeam.reserveTime

      if (elapsed < turnDuration) {
        setTimeLeft(Math.max(0, turnDuration - elapsed))
        setIsReserve(false)
      } else {
        const remainingReserve = reserveTime - (elapsed - turnDuration)
        if (remainingReserve <= 0) {
          setTimeLeft(0)
          setIsReserve(true)
          
          // Trigger auto pick if we haven't already
          if (!isAutoPicking.current && gameState.status === 'PICKING') {
            isAutoPicking.current = true
            onAutoPick()
          }
        } else {
          setTimeLeft(remainingReserve)
          setIsReserve(true)
        }
      }
    }

    // Update immediately on mount or when props change
    updateTimer()

    const interval = setInterval(updateTimer, 100)

    return () => clearInterval(interval)
  }, [gameState, currentTeam, serverOffset, onAutoPick])

  return (
    <div className={`text-center p-8 rounded-full border-8 w-48 h-48 flex flex-col items-center justify-center transition-colors shadow-lg
      ${!isReserve 
        ? 'border-green-500 bg-green-900/30 text-green-400' 
        : timeLeft < 30 
          ? 'border-red-500 bg-red-900/30 text-red-400 animate-pulse' 
          : 'border-blue-500 bg-blue-900/30 text-blue-400'
      }`}
    >
      <p className="text-xs font-bold uppercase mb-1 tracking-wider">{isReserve ? 'Reserve Time' : 'Turn Time'}</p>
      <p className="text-6xl font-black">{timeLeft}s</p>
      <p className="text-xs mt-2 font-medium opacity-80">{currentTeam.name}'s Turn</p>
    </div>
  )
}
