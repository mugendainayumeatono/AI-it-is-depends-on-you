import { describe, it, expect, vi, beforeEach } from 'vitest'
import { POST } from '@/app/api/pick/route'
import prisma from '@/lib/prisma'
import { NextRequest } from 'next/server'

// Mocks
vi.mock('@/lib/pusher', () => ({
  triggerStateUpdate: vi.fn(),
}))

describe('Concurrency: Multiple users picking at the same time', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    
    // Setup initial state for mocks
    ;(prisma.gameState.findUnique as any).mockResolvedValue({
      id: 'singleton',
      status: 'PICKING',
      currentTeamIndex: 0,
      teamCount: 2,
      turnDuration: 30,
      turnStartTime: new Date('2026-04-09T00:00:00Z'),
    })

    ;(prisma.team.findMany as any).mockResolvedValue([
      { id: 'teamA', name: 'Team A', order: 0, reserveTime: 60 },
      { id: 'teamB', name: 'Team B', order: 1, reserveTime: 60 },
    ])

    ;(prisma.member.count as any).mockResolvedValue(10)
  })

  it('should return 409 Conflict if optimistic concurrency check fails (P2025)', async () => {
    // Simulate Prisma throwing a P2025 error on update (which means turnStartTime didn't match)
    ;(prisma.$transaction as any).mockRejectedValueOnce({ code: 'P2025' })

    const req = new NextRequest('http://localhost/api/pick', {
      method: 'POST',
      body: JSON.stringify({ memberId: 'm1', teamId: 'teamA' }),
    })

    const response = await POST(req)
    const json = await response.json()

    expect(response.status).toBe(409)
    expect(json.error).toBe('Turn has already been taken')
  })

  it('should verify optimistic concurrency uses turnStartTime in where clause', async () => {
    ;(prisma.$transaction as any).mockResolvedValueOnce([])

    const req = new NextRequest('http://localhost/api/pick', {
      method: 'POST',
      body: JSON.stringify({ memberId: 'm1', teamId: 'teamA' }),
    })

    await POST(req)

    // Verify the update operation was called with the correct where clause
    const updateCallArgs = (prisma.gameState.update as any).mock.calls[0][0]
    
    expect(updateCallArgs.where).toEqual({
      id: 'singleton',
      turnStartTime: new Date('2026-04-09T00:00:00Z'),
    })
  })
})
