'use client'

import { useEffect, useState, useRef } from 'react'
import { GameState, Team } from '@/types'

interface Props {
  gameState: GameState
  currentTeam: Team
  serverOffset: number
  mutate: (data?: any, opts?: any) => void
}

export default function Timer({ gameState, currentTeam, serverOffset, mutate }: Props) {
  // Use a ref to track if an auto-pick is already in progress to avoid multiple calls
  const isAutoPicking = useRef(false)

  const getSyncedNow = () => Date.now() + serverOffset

  const calculateInitialTime = () => {
    const now = getSyncedNow()
    const startTime = new Date(gameState.turnStartTime).getTime()
    const elapsed = Math.floor((now - startTime) / 1000)
    
    if (elapsed < gameState.turnDuration) {
      return gameState.turnDuration - elapsed
    } else {
      return Math.max(0, currentTeam.reserveTime - (elapsed - gameState.turnDuration))
    }
  }

  const [timeLeft, setTimeLeft] = useState(calculateInitialTime)
  const [isReserve, setIsReserve] = useState(() => {
    const now = getSyncedNow()
    const startTime = new Date(gameState.turnStartTime).getTime()
    const elapsed = Math.floor((now - startTime) / 1000)
    return elapsed >= gameState.turnDuration
  })

  useEffect(() => {
    // Reset auto-picking flag whenever turn changes
    isAutoPicking.current = false
  }, [gameState.turnStartTime])

  useEffect(() => {
    const interval = setInterval(() => {
      const now = getSyncedNow()
      const startTime = new Date(gameState.turnStartTime).getTime()
      const elapsed = Math.floor((now - startTime) / 1000)
      
      const turnDuration = gameState.turnDuration
      const reserveTime = currentTeam.reserveTime

      if (elapsed < turnDuration) {
        setTimeLeft(turnDuration - elapsed)
        setIsReserve(false)
      } else {
        const remainingReserve = reserveTime - (elapsed - turnDuration)
        if (remainingReserve <= 0) {
          setTimeLeft(0)
          setIsReserve(true)
          
          // Trigger auto pick if we haven't already
          if (!isAutoPicking.current) {
            isAutoPicking.current = true
            fetch('/api/pick', {
              method: 'POST',
              body: JSON.stringify({ action: 'AUTO_PICK' }),
            }).then(() => {
              mutate()
            }).catch(() => {
              isAutoPicking.current = false
            })
          }
        } else {
          setTimeLeft(remainingReserve)
          setIsReserve(true)
        }
      }
    }, 100) // Run more frequently for smoother UI

    return () => clearInterval(interval)
  }, [gameState, currentTeam, mutate, serverOffset])

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
