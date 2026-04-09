import { NextResponse } from 'next/server'
import prisma from '@/lib/prisma'
import { triggerStateUpdate } from '@/lib/pusher'

export const dynamic = 'force-dynamic'

export async function POST(req: Request) {
  try {
    const { memberId, teamId, status, action } = await req.json()

    if (status === 'START') {
      await prisma.gameState.update({
        where: { id: 'singleton' },
        data: {
          status: 'PICKING',
          turnStartTime: new Date(),
          currentTeamIndex: 0,
        },
      })
      await triggerStateUpdate()
      return NextResponse.json({ success: true })
    }

    const gameState = await prisma.gameState.findUnique({ where: { id: 'singleton' } })
    if (!gameState || gameState.status !== 'PICKING') {
      return NextResponse.json({ error: 'Not in picking phase' }, { status: 400 })
    }

    const teams = await prisma.team.findMany({ orderBy: { order: 'asc' } })
    const currentTeam = teams[gameState.currentTeamIndex]

    let finalMemberId = memberId
    if (action === 'AUTO_PICK') {
      const availableMembers = await prisma.member.findMany({ where: { teamId: null, isBanned: false } })
      if (availableMembers.length === 0) return NextResponse.json({ success: true })
      finalMemberId = availableMembers[Math.floor(Math.random() * availableMembers.length)].id
    } else {
      if (currentTeam.id !== teamId) {
        return NextResponse.json({ error: 'Not your turn' }, { status: 400 })
      }
    }

    // Calculate time used
    const now = new Date()
    const elapsedSeconds = Math.floor((now.getTime() - new Date(gameState.turnStartTime).getTime()) / 1000)
    const extraTime = Math.max(0, elapsedSeconds - gameState.turnDuration)

    // Update team reserve time
    const newReserveTime = Math.max(0, currentTeam.reserveTime - extraTime)

    await prisma.$transaction([
      prisma.member.update({
        where: { id: finalMemberId },
        data: { teamId: currentTeam.id, pickedAt: now },
      }),
      prisma.team.update({
        where: { id: currentTeam.id },
        data: { reserveTime: newReserveTime },
      }),
      prisma.gameState.update({
        where: { id: 'singleton' },
        data: {
          currentTeamIndex: (gameState.currentTeamIndex + 1) % gameState.teamCount,
          turnStartTime: now,
        },
      }),
    ])

    // Check if all members picked
    const remainingMembers = await prisma.member.count({ where: { teamId: null, isBanned: false } })
    if (remainingMembers === 0) {
      await prisma.gameState.update({
        where: { id: 'singleton' },
        data: { status: 'COMPLETED' },
      })
    }

    await triggerStateUpdate()

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error(error)
    return NextResponse.json({ error: 'Failed to pick member' }, { status: 500 })
  }
}
