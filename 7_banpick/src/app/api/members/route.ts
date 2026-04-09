import { NextResponse } from 'next/server'
import prisma from '@/lib/prisma'
import { triggerStateUpdate } from '@/lib/pusher'

export const dynamic = 'force-dynamic'

export async function POST(req: Request) {
  try {
    const { action, memberId, name, info, avatar, background } = await req.json()

    if (action === 'ADD') {
      await prisma.member.create({ data: { name, info: info || '', avatar, background } })
    } else if (action === 'DELETE') {
      await prisma.member.delete({ where: { id: memberId } })
    } else if (action === 'UPDATE') {
      await prisma.member.update({ where: { id: memberId }, data: { name, info, avatar, background } })
    }

    await triggerStateUpdate()

    return NextResponse.json({ success: true })
  } catch (error: any) {
    console.error("API Members Error:", error)
    return NextResponse.json({ error: error.message || 'Failed to manage members' }, { status: 500 })
  }
}
