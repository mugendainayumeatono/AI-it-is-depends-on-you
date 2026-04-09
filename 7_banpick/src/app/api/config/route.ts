import { NextResponse } from 'next/server'
import prisma from '@/lib/prisma'
import { triggerStateUpdate } from '@/lib/pusher'

export const dynamic = 'force-dynamic'

export async function POST(req: Request) {
  try {
    const { teamCount, turnDuration, totalReserveTime, teamNames } = await req.json()

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
    ])

    // Create new teams
    for (let i = 0; i < teamCount; i++) {
      await prisma.team.create({
        data: {
          name: teamNames[i] || `Team ${i + 1}`,
          order: i,
          reserveTime: totalReserveTime,
        },
      })
    }

    await triggerStateUpdate()

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error(error)
    return NextResponse.json({ error: 'Failed to update config' }, { status: 500 })
  }
}
