'use client'

import { useDroppable } from '@dnd-kit/core'
import { Team } from '@/types'

interface Props {
  team: Team
  isCurrentTurn: boolean
  isOverAnywhere: boolean
}

export default function DroppableTeam({ team, isCurrentTurn, isOverAnywhere }: Props) {
  const { setNodeRef, isOver } = useDroppable({
    id: team.id,
    disabled: !isCurrentTurn,
  })

  return (
    <div
      ref={setNodeRef}
      className={`
        flex-1 min-w-[250px] p-6 rounded-xl border-4 transition-all
        ${isCurrentTurn ? 'border-indigo-500 bg-indigo-50 shadow-inner' : 'border-gray-200 bg-gray-50'}
        ${isOver ? 'bg-indigo-200 border-indigo-600 scale-[1.02]' : ''}
      `}
    >
      <div className="flex justify-between items-center mb-6">
        <h2 className="text-2xl font-black uppercase tracking-tight">{team.name}</h2>
        <div className={`px-3 py-1 rounded-full text-sm font-bold ${team.reserveTime > 10 ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700 animate-pulse'}`}>
          Reserve: {team.reserveTime}s
        </div>
      </div>

      <div className="space-y-3">
        {team.members.map((member) => (
          <div key={member.id} className="p-3 bg-white rounded shadow-sm border border-indigo-100">
            <p className="font-bold">{member.name}</p>
            {member.info && <p className="text-xs text-gray-400">{member.info}</p>}
          </div>
        ))}
        {team.members.length === 0 && (
          <div className="border-2 border-dashed border-gray-300 rounded-lg p-8 flex items-center justify-center text-gray-400 italic">
            No one picked yet
          </div>
        )}
      </div>
    </div>
  )
}
