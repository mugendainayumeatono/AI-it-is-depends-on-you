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
        flex-1 min-w-[250px] p-6 rounded-xl border transition-all backdrop-blur-sm
        ${isCurrentTurn ? 'border-indigo-500 bg-indigo-900/30 shadow-[0_0_15px_rgba(79,70,229,0.3)]' : 'border-gray-700 bg-gray-800/50'}
        ${isOver ? 'bg-indigo-800/50 border-indigo-400 scale-[1.02]' : ''}
      `}
    >
      <div className="flex justify-between items-center mb-6">
        <h2 className="text-2xl font-black uppercase tracking-tight text-gray-100">{team.name}</h2>
        <div className={`px-3 py-1 rounded-full text-sm font-bold ${team.reserveTime > 10 ? 'bg-green-900/50 text-green-400 border border-green-800' : 'bg-red-900/50 text-red-400 border border-red-800 animate-pulse'}`}>
          Reserve: {team.reserveTime}s
        </div>
      </div>

      <div className="space-y-3">
        {team.members.map((member) => (
          <div key={member.id} className="relative overflow-hidden p-3 bg-gray-700/80 rounded shadow-sm border border-gray-600 flex items-center gap-3">
            {member.background && <img src={member.background} className="absolute inset-0 w-full h-full object-cover opacity-20 pointer-events-none" />}
            {member.avatar && <img src={member.avatar} className="w-10 h-10 rounded-full object-cover border border-gray-500 relative z-10 pointer-events-none" />}
            <div className="relative z-10 pointer-events-none">
              <p className="font-bold text-gray-100">{member.name}</p>
              {member.info && <p className="text-xs text-gray-400 whitespace-pre-wrap">{member.info}</p>}
            </div>
          </div>
        ))}
        {team.members.length === 0 && (
          <div className="border-2 border-dashed border-gray-600 rounded-lg p-8 flex items-center justify-center text-gray-500 italic bg-gray-800/30">
            No one picked yet
          </div>
        )}
      </div>
    </div>
  )
}
