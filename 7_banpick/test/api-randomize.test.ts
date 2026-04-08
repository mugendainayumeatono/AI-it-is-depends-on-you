import { describe, it, expect, vi, beforeEach } from 'vitest'
import { POST } from '@/app/api/randomize/route'
import prisma from '@/lib/prisma'

describe('API: /api/randomize', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should shuffle and assign members to teams', async () => {
    ;(prisma.team.findMany as any).mockResolvedValue([
      { id: 'team1', order: 0 },
      { id: 'team2', order: 1 }
    ])
    ;(prisma.member.findMany as any).mockResolvedValue([
      { id: 'm1' }, { id: 'm2' }, { id: 'm3' }, { id: 'm4' }
    ])

    const req = new Request('http://localhost/api/randomize', {
      method: 'POST'
    })

    const response = await POST(req)
    const data = await response.json()

    expect(data.success).toBe(true)
    expect(prisma.member.update).toHaveBeenCalledTimes(4)
    expect(prisma.gameState.update).toHaveBeenCalledWith(expect.objectContaining({
      data: { status: 'COMPLETED' }
    }))
  })
})
