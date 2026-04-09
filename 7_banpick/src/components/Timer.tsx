'use client'

import { useEffect, useState } from 'react'
import { GameState, Team } from '@/types'

interface Props {
  gameState: GameState
  currentTeam: Team
  mutate: (data?: any, opts?: any) => void
}

export default function Timer({ gameState, currentTeam, mutate }: Props) {
  const calculateInitialTime = () => {
    const now = new Date().getTime()
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
    const now = new Date().getTime()
    const startTime = new Date(gameState.turnStartTime).getTime()
    const elapsed = Math.floor((now - startTime) / 1000)
    return elapsed >= gameState.turnDuration
  })

  useEffect(() => {
    const interval = setInterval(() => {
      const now = new Date().getTime()
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
          fetch('/api/pick', {
            method: 'POST',
            body: JSON.stringify({ action: 'AUTO_PICK' }),
          }).then(() => mutate())
        } else {
          setTimeLeft(remainingReserve)
          setIsReserve(true)
        }
      }
    }, 1000)

    return () => clearInterval(interval)
  }, [gameState, currentTeam, mutate])

  return (
    <div className={`text-center p-8 rounded-full border-8 w-48 h-48 flex flex-col items-center justify-center transition-colors ${isReserve ? 'border-red-500 bg-red-50 text-red-600' : 'border-indigo-600 bg-indigo-50 text-indigo-700'}`}>
      <p className="text-xs font-bold uppercase mb-1">{isReserve ? 'Bonus Time' : 'Turn Time'}</p>
      <p className="text-6xl font-black">{timeLeft}s</p>
      <p className="text-xs mt-2 font-medium">{currentTeam.name}'s Turn</p>
    </div>
  )
}
