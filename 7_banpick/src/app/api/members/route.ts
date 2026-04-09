import { NextResponse } from 'next/server'
import prisma from '@/lib/prisma'
import { triggerStateUpdate } from '@/lib/pusher'

export const dynamic = 'force-dynamic'

export async function POST(req: Request) {
  try {
    const { action, memberId, name, info } = await req.json()

    if (action === 'ADD') {
      await prisma.member.create({ data: { name, info: info || '' } })
    } else if (action === 'DELETE') {
      await prisma.member.delete({ where: { id: memberId } })
    } else if (action === 'UPDATE') {
      await prisma.member.update({ where: { id: memberId }, data: { name, info } })
    }

    await triggerStateUpdate()

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error(error)
    return NextResponse.json({ error: 'Failed to manage members' }, { status: 500 })
  }
}
