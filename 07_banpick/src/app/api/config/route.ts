import { NextResponse } from 'next/server'
import prisma from '@/lib/prisma'
import { triggerStateUpdate } from '@/lib/pusher'

export const dynamic = 'force-dynamic'

export async function POST(req: Request) {
  try {
    const body = await req.json()

    const teamCount = parseInt(body.teamCount) || 2
    const turnDuration = parseInt(body.turnDuration) || 30
    const totalReserveTime = parseInt(body.totalReserveTime) || 120
    const teamNames = Array.isArray(body.teamNames) ? body.teamNames : []

    const teamCreations = []
    for (let i = 0; i < teamCount; i++) {
      teamCreations.push(
        prisma.team.create({
          data: {
            name: teamNames[i] || `Team ${i + 1}`,
            order: i,
            reserveTime: totalReserveTime,
          },
        })
      )
    }

    // Reset everything
    await prisma.$transaction([
      prisma.member.updateMany({ data: { teamId: null, pickedAt: null, isBanned: false } }),
      prisma.team.deleteMany(),
      prisma.gameState.upsert({
        where: { id: 'singleton' },
        create: {
          id: 'singleton',
          teamCount,
          turnDuration,
          totalReserveTime,
          status: 'CONFIGURING',
        },
        update: {
          teamCount,
          turnDuration,
          totalReserveTime,
          status: 'CONFIGURING',
          currentTeamIndex: 0,
        },
      }),
      ...teamCreations
    ])

    await triggerStateUpdate()

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error(error)
    return NextResponse.json({ error: 'Failed to update config' }, { status: 500 })
  }
}
