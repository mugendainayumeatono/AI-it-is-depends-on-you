'use client'

import { useGameState } from '@/hooks/useGameState'
import Configuration from '@/components/Configuration'
import Board from '@/components/Board'
import { Loader2 } from 'lucide-react'

export default function Home() {
  const { gameState, teams, members, isLoading, isError, mutate } = useGameState()

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="flex flex-col items-center gap-4">
          <Loader2 className="animate-spin text-indigo-600" size={48} />
          <p className="text-gray-500 font-medium">Loading session state...</p>
        </div>
      </div>
    )
  }

  if (isError) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="bg-red-50 text-red-600 p-6 rounded-lg shadow-sm border border-red-100">
          <p className="font-bold text-xl mb-2">Error Connecting to Database</p>
          <p>Please check your POSTGRES_PRISMA_URL environment variable.</p>
        </div>
      </div>
    )
  }

  if (gameState.status === 'CONFIGURING') {
    return <Configuration gameState={gameState} teams={teams} members={members} mutate={mutate} />
  }

  return <Board gameState={gameState} teams={teams} members={members} mutate={mutate} />
}
