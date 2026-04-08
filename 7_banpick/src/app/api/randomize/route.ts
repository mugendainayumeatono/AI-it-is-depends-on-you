import { NextResponse } from 'next/server'
import prisma from '@/lib/prisma'

export async function POST() {
  try {
    const [teams, members] = await Promise.all([
      prisma.team.findMany({ orderBy: { order: 'asc' } }),
      prisma.member.findMany({ where: { teamId: null, isBanned: false } }),
    ])

    if (teams.length === 0) return NextResponse.json({ error: 'No teams configured' }, { status: 400 })

    const shuffledMembers = [...members].sort(() => Math.random() - 0.5)
    
    await prisma.$transaction(
      shuffledMembers.map((member, index) => {
        const teamIndex = index % teams.length
        return prisma.member.update({
          where: { id: member.id },
          data: { teamId: teams[teamIndex].id, pickedAt: new Date() },
        })
      })
    )

    await prisma.gameState.update({
      where: { id: 'singleton' },
      data: { status: 'COMPLETED' },
    })

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error(error)
    return NextResponse.json({ error: 'Failed to randomize' }, { status: 500 })
  }
}
