import { describe, it, expect, vi, beforeEach } from 'vitest'
import { POST } from '@/app/api/config/route'
import prisma from '@/lib/prisma'

describe('API: /api/config', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should reset game and create new teams', async () => {
    const config = {
      teamCount: 2,
      turnDuration: 30,
      totalReserveTime: 120,
      teamNames: ['Alpha', 'Beta']
    }

    const req = new Request('http://localhost/api/config', {
      method: 'POST',
      body: JSON.stringify(config),
    })

    const response = await POST(req)
    const data = await response.json()

    expect(data.success).toBe(true)
    expect(prisma.team.deleteMany).toHaveBeenCalled()
    expect(prisma.gameState.upsert).toHaveBeenCalled()
    expect(prisma.team.create).toHaveBeenCalledTimes(2)
    expect(prisma.team.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ name: 'Alpha' })
    }))
  })
})
