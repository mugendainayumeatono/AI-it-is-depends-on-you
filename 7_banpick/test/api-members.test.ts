import { describe, it, expect, vi, beforeEach } from 'vitest'
import { POST } from '@/app/api/members/route'
import prisma from '@/lib/prisma'

describe('API: /api/members', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should add a new member', async () => {
    const req = new Request('http://localhost/api/members', {
      method: 'POST',
      body: JSON.stringify({ action: 'ADD', name: 'John Doe', info: 'Carry' }),
    })

    const response = await POST(req)
    const data = await response.json()

    expect(data.success).toBe(true)
    expect(prisma.member.create).toHaveBeenCalledWith({
      data: { name: 'John Doe', info: 'Carry' }
    })
  })

  it('should delete a member', async () => {
    const req = new Request('http://localhost/api/members', {
      method: 'POST',
      body: JSON.stringify({ action: 'DELETE', memberId: 'member1' }),
    })

    const response = await POST(req)
    const data = await response.json()

    expect(data.success).toBe(true)
    expect(prisma.member.delete).toHaveBeenCalledWith({
      where: { id: 'member1' }
    })
  })
})
