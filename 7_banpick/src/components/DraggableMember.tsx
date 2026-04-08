'use client'

import { useDraggable } from '@dnd-kit/core'
import { Member } from '@/types'

export default function DraggableMember({ member, disabled }: { member: Member, disabled?: boolean }) {
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
        p-4 rounded-lg border-2 transition-all cursor-grab active:cursor-grabbing
        ${member.teamId ? 'bg-gray-100 border-gray-200 text-gray-400 opacity-50' : 'bg-white border-blue-100 hover:border-blue-300 shadow-sm'}
        ${isDragging ? 'shadow-xl scale-105 border-blue-500' : ''}
      `}
    >
      <p className="font-bold text-lg">{member.name}</p>
      {member.info && <p className="text-sm opacity-70">{member.info}</p>}
    </div>
  )
}
