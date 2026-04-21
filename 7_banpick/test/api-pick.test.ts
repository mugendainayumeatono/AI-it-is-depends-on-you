import { describe, it, expect, vi, beforeEach } from 'vitest'
import { POST } from '@/app/api/pick/route'
import prisma from '@/lib/prisma'
import { NextResponse } from 'next/server'

describe('API: /api/pick', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should start the game when status is START', async () => {
    const req = new Request('http://localhost/api/pick', {
      method: 'POST',
      body: JSON.stringify({ status: 'START' }),
    })

    const response = await POST(req)
    const data = await response.json()

    expect(data.success).toBe(true)
    expect(prisma.gameState.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: 'PICKING' })
    }))
  })

  it('should allow picking a member during picking phase', async () => {
    // Setup mock data
    ;(prisma.gameState.findUnique as any).mockResolvedValue({
      id: 'singleton',
      status: 'PICKING',
      currentTeamIndex: 0,
      turnDuration: 30,
      turnStartTime: new Date().toISOString(),
      teamCount: 2
    })
    ;(prisma.team.findMany as any).mockResolvedValue([
      { id: 'team1', order: 0, reserveTime: 120 },
      { id: 'team2', order: 1, reserveTime: 120 }
    ])
    ;(prisma.member.count as any).mockResolvedValue(5)

    const req = new Request('http://localhost/api/pick', {
      method: 'POST',
      body: JSON.stringify({ memberId: 'member1', teamId: 'team1' }),
    })

    const response = await POST(req)
    const data = await response.json()

    expect(data.success).toBe(true)
    expect(prisma.member.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'member1' },
      data: expect.objectContaining({ teamId: 'team1' })
    }))
  })

  it('should handle AUTO_PICK when action is AUTO_PICK', async () => {
    ;(prisma.gameState.findUnique as any).mockResolvedValue({
      id: 'singleton',
      status: 'PICKING',
      currentTeamIndex: 0,
      turnDuration: 30,
      turnStartTime: new Date().toISOString(),
      teamCount: 2
    })
    ;(prisma.team.findMany as any).mockResolvedValue([
      { id: 'team1', order: 0, reserveTime: 120 }
    ])
    ;(prisma.member.findMany as any).mockResolvedValue([
      { id: 'randomMember' }
    ])
    ;(prisma.member.count as any).mockResolvedValue(0)

    const req = new Request('http://localhost/api/pick', {
      method: 'POST',
      body: JSON.stringify({ action: 'AUTO_PICK' }),
    })

    const response = await POST(req)
    const data = await response.json()

    expect(data.success).toBe(true)
    expect(prisma.member.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'randomMember' }
    }))
  })

  it('should block picking if not current team turn', async () => {
    ;(prisma.gameState.findUnique as any).mockResolvedValue({
      status: 'PICKING',
      currentTeamIndex: 1 // Team 2's turn
    })
    ;(prisma.team.findMany as any).mockResolvedValue([
      { id: 'team1', order: 0 },
      { id: 'team2', order: 1 }
    ])

    const req = new Request('http://localhost/api/pick', {
      method: 'POST',
      body: JSON.stringify({ memberId: 'member1', teamId: 'team1' }),
    })

    const response = await POST(req)
    const data = await response.json()

    expect(response.status).toBe(400)
    expect(data.error).toBe('Not your turn')
  })

  it('should block picking if not in PICKING phase', async () => {
    ;(prisma.gameState.findUnique as any).mockResolvedValue({
      status: 'CONFIGURING'
    })

    const req = new Request('http://localhost/api/pick', {
      method: 'POST',
      body: JSON.stringify({ memberId: 'member1', teamId: 'team1' }),
    })

    const response = await POST(req)
    const data = await response.json()

    expect(response.status).toBe(400)
    expect(data.error).toBe('Not in picking phase')
  })
})
