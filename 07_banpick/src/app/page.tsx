'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { Loader2 } from 'lucide-react'
import { useGameState } from '@/hooks/useGameState'
import Configuration from '@/components/Configuration'
import Board from '@/components/Board'

export default function Home() {
  const {
    gameState,
    teams,
    members,
    serverOffset,
    isLoading,
    isError,
    mutate,
    dispatchMutation,
  } = useGameState()
  const [showConfig, setShowConfig] = useState(false)

  const spotlightRef = useRef<HTMLDivElement | null>(null)
  const rafIdRef = useRef<number | null>(null)
  const pointerRef = useRef<{ x: number; y: number } | null>(null)

  useEffect(() => {
    return () => {
      if (rafIdRef.current !== null && typeof cancelAnimationFrame === 'function') {
        cancelAnimationFrame(rafIdRef.current)
        rafIdRef.current = null
      }
    }
  }, [])

  const handleMouseMove = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    pointerRef.current = { x: e.clientX, y: e.clientY }
    if (rafIdRef.current !== null) return

    const applyPosition = () => {
      rafIdRef.current = null
      const pos = pointerRef.current
      const el = spotlightRef.current
      if (!pos || !el) return
      el.style.setProperty('--mouse-x', `${pos.x}px`)
      el.style.setProperty('--mouse-y', `${pos.y}px`)
    }

    if (typeof requestAnimationFrame === 'function') {
      rafIdRef.current = requestAnimationFrame(applyPosition)
    } else {
      applyPosition()
    }
  }, [])

  if (isError) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-900 text-gray-200">
        <div className="bg-red-900/20 text-red-400 p-6 rounded-lg shadow-sm border border-red-800">
          <p className="font-bold text-xl mb-2">Error Connecting to Database</p>
          <p>Please check your POSTGRES_PRISMA_URL environment variable.</p>
        </div>
      </div>
    )
  }

  if (isLoading || !gameState) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-900 text-gray-200">
        <div className="flex flex-col items-center gap-4">
          <Loader2 className="animate-spin text-indigo-500" size={48} />
          <p className="font-medium text-gray-400">Loading session state...</p>
        </div>
      </div>
    )
  }

  return (
    <div
      className="relative min-h-screen bg-gray-900 text-gray-100 overflow-hidden"
      onMouseMove={handleMouseMove}
    >
      {/* Follow Mouse Effect Background (fixed viewport layer, rAF-throttled, zero forced layout) */}
      <div
        ref={spotlightRef}
        className="pointer-events-none fixed inset-0 z-0 transition-opacity duration-300 opacity-60"
        style={{
          background:
            'radial-gradient(1200px circle at var(--mouse-x, 50%) var(--mouse-y, 50%), rgba(99, 102, 241, 0.4) 0%, rgba(168, 85, 247, 0.15) 30%, transparent 80%)',
        }}
      />

      <div className="relative z-10">
        <Board
          gameState={gameState}
          teams={teams}
          members={members}
          serverOffset={serverOffset}
          mutate={mutate}
          dispatchMutation={dispatchMutation}
          setShowConfig={setShowConfig}
        />
      </div>

      {showConfig && (
        <div className="absolute inset-0 z-50 bg-gray-900/95 overflow-y-auto">
          <div className="min-h-screen p-8">
            <button
              onClick={() => setShowConfig(false)}
              className="mb-4 text-gray-400 hover:text-white flex items-center gap-2"
            >
              ← Back to Board
            </button>
            <Configuration
              gameState={gameState}
              teams={teams}
              members={members}
              mutate={mutate}
              dispatchMutation={dispatchMutation}
              onClose={() => setShowConfig(false)}
            />
          </div>
        </div>
      )}
    </div>
  )
}
