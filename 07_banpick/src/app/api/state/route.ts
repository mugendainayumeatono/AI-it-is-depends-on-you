import { NextResponse } from 'next/server'
import prisma from '@/lib/prisma'

export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    const [gameState, teams, members] = await Promise.all([
      prisma.gameState.findUnique({ where: { id: 'singleton' } }),
      prisma.team.findMany({ include: { members: true }, orderBy: { order: 'asc' } }),
      prisma.member.findMany({ orderBy: { name: 'asc' } }),
    ])

    if (!gameState) {
      // Initialize state if not exists
      const newState = await prisma.gameState.create({
        data: { id: 'singleton' },
      })
      return NextResponse.json({ gameState: newState, teams: [], members: [] })
    }

    return NextResponse.json({ 
      gameState, 
      teams, 
      members, 
      serverTime: new Date().toISOString() 
    })
  } catch (error) {
    console.error(error)
    return NextResponse.json({ error: 'Failed to fetch state' }, { status: 500 })
  }
}
