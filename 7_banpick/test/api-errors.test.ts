import { describe, it, expect, vi, beforeEach } from 'vitest'
import { POST as configPost } from '@/app/api/config/route'
import { POST as membersPost } from '@/app/api/members/route'
import { POST as pickPost } from '@/app/api/pick/route'
import { POST as randomizePost } from '@/app/api/randomize/route'
import { GET as stateGet } from '@/app/api/state/route'
import prisma from '@/lib/prisma'

describe('API Error Handling', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('config API handles errors', async () => {
    ;(prisma.$transaction as any).mockRejectedValue(new Error('DB Error'))
    const response = await configPost(new Request('http://l/api/config', { method: 'POST', body: '{}' }))
    expect(response.status).toBe(500)
  })

  it('members API handles errors', async () => {
    ;(prisma.member.create as any).mockRejectedValue(new Error('DB Error'))
    const response = await membersPost(new Request('http://l/api/members', { method: 'POST', body: JSON.stringify({ action: 'ADD' }) }))
    expect(response.status).toBe(500)
  })

  it('pick API handles errors', async () => {
    ;(prisma.gameState.findUnique as any).mockRejectedValue(new Error('DB Error'))
    const response = await pickPost(new Request('http://l/api/pick', { method: 'POST', body: '{}' }))
    expect(response.status).toBe(500)
  })

  it('randomize API handles errors', async () => {
    ;(prisma.team.findMany as any).mockRejectedValue(new Error('DB Error'))
    const response = await randomizePost()
    expect(response.status).toBe(500)
  })

  it('state API handles errors', async () => {
    ;(prisma.gameState.findUnique as any).mockRejectedValue(new Error('DB Error'))
    const response = await stateGet()
    expect(response.status).toBe(500)
  })
})
