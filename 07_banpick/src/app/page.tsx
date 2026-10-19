'use client'

import { useGameState } from '@/hooks/useGameState'
import Configuration from '@/components/Configuration'
import Board from '@/components/Board'
import { Loader2, Settings } from 'lucide-react'
import { useState } from 'react'

export default function Home() {
  const { gameState, teams, members, serverOffset, isLoading, isError, mutate } = useGameState()
  const [showConfig, setShowConfig] = useState(false)

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-900 text-gray-200">
        <div className="flex flex-col items-center gap-4">
          <Loader2 className="animate-spin text-indigo-500" size={48} />
          <p className="font-medium text-gray-400">Loading session state...</p>
        </div>
      </div>
    )
  }

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

  return (
    <div className="relative min-h-screen bg-gray-900 text-gray-100 overflow-hidden">
      {/* Follow Mouse Effect Background */}
      <div 
        className="pointer-events-none absolute inset-0 z-0 transition-opacity duration-300 opacity-60"
        style={{
          background: 'radial-gradient(1200px circle at var(--mouse-x, 50%) var(--mouse-y, 50%), rgba(99, 102, 241, 0.4) 0%, rgba(168, 85, 247, 0.15) 30%, transparent 80%)'
        }}
        onMouseMove={(e) => {
          const rect = e.currentTarget.getBoundingClientRect()
          e.currentTarget.style.setProperty('--mouse-x', `${e.clientX - rect.left}px`)
          e.currentTarget.style.setProperty('--mouse-y', `${e.clientY - rect.top}px`)
        }}
      />
      
      <div className="relative z-10" onMouseMove={(e) => {
        const parent = e.currentTarget.parentElement
        if (parent) {
          const rect = parent.getBoundingClientRect()
          parent.style.setProperty('--mouse-x', `${e.clientX - rect.left}px`)
          parent.style.setProperty('--mouse-y', `${e.clientY - rect.top}px`)
        }
      }}>
        <Board gameState={gameState} teams={teams} members={members} serverOffset={serverOffset} mutate={mutate} setShowConfig={setShowConfig} />
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
            <Configuration gameState={gameState} teams={teams} members={members} mutate={mutate} onClose={() => setShowConfig(false)} />
          </div>
        </div>
      )}
    </div>
  )
}
