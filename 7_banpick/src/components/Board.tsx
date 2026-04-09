'use client'

import { DndContext, DragEndEvent, DragOverlay, closestCenter } from '@dnd-kit/core'
import { GameState, Member, Team } from '@/types'
import DroppableTeam from './DroppableTeam'
import DraggableMember from './DraggableMember'
import Timer from './Timer'
import { useState } from 'react'
import { Shuffle, Settings } from 'lucide-react'

interface Props {
  gameState: GameState
  teams: Team[]
  members: Member[]
  mutate: (data?: any, opts?: any) => void
  setShowConfig: (show: boolean) => void
}

export default function Board({ gameState, teams, members, mutate, setShowConfig }: Props) {
  const [activeId, setActiveId] = useState<string | null>(null)
  const currentTeam = teams[gameState.currentTeamIndex]
  const unpickedMembers = members.filter(m => !m.teamId && !m.isBanned)

  const handleDragStart = (event: any) => {
    setActiveId(event.active.id)
  }

  const handleDragEnd = async (event: DragEndEvent) => {
    const { active, over } = event
    setActiveId(null)

    if (over && currentTeam && over.id === currentTeam.id) {
      const memberId = active.id as string
      const teamId = over.id as string
      
      const pickedMember = members.find(m => m.id === memberId)
      if (!pickedMember) return

      // Optimistic update
      const optimisticData = {
        gameState: {
          ...gameState,
          currentTeamIndex: (gameState.currentTeamIndex + 1) % gameState.teamCount,
          turnStartTime: new Date().toISOString(),
        },
        members: members.map(m => m.id === memberId ? { ...m, teamId } : m),
        teams: teams.map(t => t.id === teamId ? { ...t, members: [...t.members, pickedMember] } : t)
      }

      mutate(optimisticData, { revalidate: false })

      try {
        await fetch('/api/pick', {
          method: 'POST',
          body: JSON.stringify({ memberId, teamId }),
        })
      } finally {
        mutate() // Revalidate with server truth
      }
    }
  }

  const handleRandomize = async () => {
    if (!confirm('Randomly assign all remaining members?')) return
    await fetch('/api/randomize', { method: 'POST' })
    mutate()
  }

  const activeMember = members.find(m => m.id === activeId)

  return (
    <DndContext 
      collisionDetection={closestCenter} 
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
    >
      <div className="min-h-screen p-8 flex flex-col gap-8 text-gray-200">
        <header className="flex justify-between items-center bg-gray-800/80 p-4 rounded-2xl backdrop-blur-md border border-gray-700 shadow-lg">
          <div className="flex gap-4">
            <button 
              onClick={() => setShowConfig(true)}
              className="flex items-center gap-2 bg-gray-700 text-white px-4 py-2 rounded hover:bg-gray-600 transition font-medium border border-gray-600"
            >
              <Settings size={18} /> Configuration
            </button>
            <button 
              onClick={handleRandomize}
              className="flex items-center gap-2 bg-yellow-600/90 text-white px-4 py-2 rounded hover:bg-yellow-500 transition font-medium shadow"
            >
              <Shuffle size={18} /> Random Teams
            </button>
          </div>
          {gameState.status === 'PICKING' && currentTeam && (
            <Timer gameState={gameState} currentTeam={currentTeam} mutate={mutate} />
          )}
          {gameState.status === 'COMPLETED' && (
            <div className="text-gray-300 px-8 py-4 border-2 border-gray-600 rounded-xl shadow-lg">
              <p className="text-2xl font-bold uppercase tracking-wider">Draft Completed</p>
            </div>
          )}
          <div className="w-[300px]" /> {/* Spacer to balance flex-between if Timer is center */}
        </header>

        <div className="flex flex-col lg:flex-row gap-8 flex-1">
          {/* Unpicked Members Pool */}
          <div className="w-full lg:w-1/3 bg-gray-800/80 p-6 rounded-2xl shadow-xl border border-gray-700 space-y-4 backdrop-blur-sm">
            <h3 className="text-xl font-bold text-gray-200 border-b border-gray-700 pb-2">Available Members ({unpickedMembers.length})</h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 overflow-y-auto max-h-[70vh] pr-2 custom-scrollbar">
              {unpickedMembers.map(member => (
                <DraggableMember 
                  key={member.id} 
                  member={member} 
                  disabled={gameState.status !== 'PICKING'} 
                />
              ))}
            </div>
            {unpickedMembers.length === 0 && gameState.status === 'PICKING' && (
              <p className="text-center text-gray-500 py-10">All members have been picked!</p>
            )}
            {gameState.status === 'CONFIGURING' && (
              <div className="text-center text-gray-400 py-10 flex flex-col items-center gap-4">
                <p>Game is in configuration mode.</p>
                <button onClick={() => setShowConfig(true)} className="px-4 py-2 bg-indigo-600 rounded text-white hover:bg-indigo-500">Go to Config</button>
              </div>
            )}
          </div>

          {/* Teams Grid */}
          <div className="flex-1 grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
            {teams.map((team, idx) => (
              <DroppableTeam 
                key={team.id} 
                team={team} 
                isCurrentTurn={gameState.status === 'PICKING' && gameState.currentTeamIndex === idx}
                isOverAnywhere={!!activeId}
              />
            ))}
          </div>
        </div>
      </div>

      <DragOverlay>
        {activeMember ? (
          <div className="rounded-lg shadow-2xl scale-110 opacity-90 cursor-grabbing relative overflow-hidden">
             <DraggableMember member={activeMember} disabled={true} isOverlay={true} />
          </div>
        ) : null}
      </DragOverlay>
    </DndContext>
  )
}
