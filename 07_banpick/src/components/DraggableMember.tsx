'use client'

import { useDraggable } from '@dnd-kit/core'
import { Member } from '@/types'

export default function DraggableMember({ member, disabled, isOverlay }: { member: Member, disabled?: boolean, isOverlay?: boolean }) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: member.id,
    disabled: disabled || !!member.teamId,
  })

  const style = transform ? {
    transform: `translate3d(${transform.x}px, ${transform.y}px, 0)`,
    zIndex: isDragging ? 100 : 1,
  } : undefined

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...listeners}
      {...attributes}
      className={`
        relative overflow-hidden p-4 rounded-lg border transition-all cursor-grab active:cursor-grabbing min-h-[80px] flex items-center gap-3
        ${member.teamId ? 'bg-gray-800 border-gray-700 text-gray-500 opacity-50' : 'bg-gray-700 border-gray-600 hover:border-gray-500 shadow-sm'}
        ${isDragging || isOverlay ? 'shadow-xl scale-105 border-indigo-500 z-50 bg-gray-600' : ''}
        ${!isOverlay && isDragging ? 'opacity-0' : ''}
      `}
    >
      {member.background && <img src={member.background} className="absolute inset-0 w-full h-full object-cover opacity-20 pointer-events-none" />}
      
      {member.avatar && (
        <img src={member.avatar} className="w-12 h-12 rounded-full object-cover border-2 border-gray-500 relative z-10 pointer-events-none" />
      )}
      
      <div className="relative z-10 pointer-events-none">
        <p className="font-bold text-lg text-gray-100">{member.name}</p>
        {member.info && <p className="text-xs text-gray-400 whitespace-pre-wrap">{member.info}</p>}
      </div>
    </div>
  )
}
