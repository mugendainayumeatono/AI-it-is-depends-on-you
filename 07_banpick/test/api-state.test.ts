import { describe, it, expect, vi, beforeEach } from 'vitest'
import { GET } from '@/app/api/state/route'
import prisma from '@/lib/prisma'

describe('API: /api/state', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should return the current game state, teams and members', async () => {
    ;(prisma.gameState.findUnique as any).mockResolvedValue({ id: 'singleton', status: 'CONFIGURING' })
    ;(prisma.team.findMany as any).mockResolvedValue([{ id: 'team1', name: 'Team 1' }])
    ;(prisma.member.findMany as any).mockResolvedValue([{ id: 'm1', name: 'Member 1' }])

    const response = await GET()
    const data = await response.json()

    expect(data.gameState.status).toBe('CONFIGURING')
    expect(data.teams).toHaveLength(1)
    expect(data.members).toHaveLength(1)
    expect(data.serverTime).toBeDefined()
    expect(new Date(data.serverTime).getTime()).toBeGreaterThan(0)
  })

  it('should initialize state if it does not exist', async () => {
    ;(prisma.gameState.findUnique as any).mockResolvedValue(null)
    ;(prisma.gameState.create as any).mockResolvedValue({ id: 'singleton', status: 'CONFIGURING' })
    ;(prisma.team.findMany as any).mockResolvedValue([])
    ;(prisma.member.findMany as any).mockResolvedValue([])

    const response = await GET()
    const data = await response.json()

    expect(prisma.gameState.create).toHaveBeenCalled()
    expect(data.gameState.id).toBe('singleton')
  })
})
