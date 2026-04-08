'use client'

import { DndContext, DragEndEvent, DragOverlay, closestCenter } from '@dnd-kit/core'
import { GameState, Member, Team } from '@/types'
import DroppableTeam from './DroppableTeam'
import DraggableMember from './DraggableMember'
import Timer from './Timer'
import { useState } from 'react'
import { Shuffle } from 'lucide-react'

interface Props {
  gameState: GameState
  teams: Team[]
  members: Member[]
  mutate: () => void
}

export default function Board({ gameState, teams, members, mutate }: Props) {
  const [activeId, setActiveId] = useState<string | null>(null)
  const currentTeam = teams[gameState.currentTeamIndex]
  const unpickedMembers = members.filter(m => !m.teamId && !m.isBanned)

  const handleDragStart = (event: any) => {
    setActiveId(event.active.id)
  }

  const handleDragEnd = async (event: DragEndEvent) => {
    const { active, over } = event
    setActiveId(null)

    if (over && over.id === currentTeam.id) {
      // Optimistic update
      const memberId = active.id as string
      const teamId = over.id as string

      await fetch('/api/pick', {
        method: 'POST',
        body: JSON.stringify({ memberId, teamId }),
      })
      mutate()
    }
  }

  const handleRandomize = async () => {
    if (!confirm('Randomly assign all remaining members?')) return
    await fetch('/api/randomize', { method: 'POST' })
    mutate()
  }

  const handleReset = async () => {
    if (!confirm('Reset game to configuration phase?')) return
    await fetch('/api/config', {
      method: 'POST',
      body: JSON.stringify({ 
        teamCount: gameState.teamCount, 
        turnDuration: gameState.turnDuration, 
        totalReserveTime: gameState.totalReserveTime,
        teamNames: teams.map(t => t.name)
      }),
    })
    mutate()
  }

  const activeMember = members.find(m => m.id === activeId)

  return (
    <DndContext 
      collisionDetection={closestCenter} 
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
    >
      <div className="min-h-screen bg-gray-100 p-8 flex flex-col gap-8">
        <header className="flex justify-between items-center">
          <div className="flex gap-4">
            <button 
              onClick={handleRandomize}
              className="flex items-center gap-2 bg-yellow-500 text-white px-4 py-2 rounded hover:bg-yellow-600 transition font-bold shadow"
            >
              <Shuffle size={18} /> Random Teams
            </button>
            <button 
              onClick={handleReset}
              className="text-gray-500 hover:text-gray-700 font-medium"
            >
              Back to Config
            </button>
          </div>
          {gameState.status === 'PICKING' && (
            <Timer gameState={gameState} currentTeam={currentTeam} mutate={mutate} />
          )}
          {gameState.status === 'COMPLETED' && (
            <div className="bg-green-600 text-white px-8 py-4 rounded-xl shadow-lg animate-bounce">
              <p className="text-2xl font-black uppercase">Draft Completed!</p>
            </div>
          )}
          <div className="w-32" /> {/* Spacer */}
        </header>

        <div className="flex flex-col lg:flex-row gap-8 flex-1">
          {/* Unpicked Members Pool */}
          <div className="w-full lg:w-1/3 bg-white p-6 rounded-2xl shadow-sm space-y-4">
            <h3 className="text-xl font-bold text-gray-800 border-b pb-2">Available Members ({unpickedMembers.length})</h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 overflow-y-auto max-h-[70vh]">
              {unpickedMembers.map(member => (
                <DraggableMember 
                  key={member.id} 
                  member={member} 
                  disabled={gameState.status !== 'PICKING'} 
                />
              ))}
            </div>
            {unpickedMembers.length === 0 && gameState.status === 'PICKING' && (
              <p className="text-center text-gray-400 py-10">All members have been picked!</p>
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
          <div className="p-4 rounded-lg border-2 bg-white border-blue-500 shadow-2xl scale-110 opacity-90 cursor-grabbing">
            <p className="font-bold text-lg">{activeMember.name}</p>
            <p className="text-sm opacity-70">{activeMember.info}</p>
          </div>
        ) : null}
      </DragOverlay>
    </DndContext>
  )
}
