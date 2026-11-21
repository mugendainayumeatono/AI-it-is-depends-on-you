import { describe, it, expect, vi, beforeEach } from 'vitest'
import { POST } from '@/app/api/config/route'
import { POST as membersPost } from '@/app/api/members/route'
import { POST as pickPost } from '@/app/api/pick/route'
import prisma from '@/lib/prisma'
import { PrismaStateStore, setStateStore } from '@/lib/stateStore'

describe('API: POST /api/config', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('InMemoryStateStore', () => {
    it('atomically resets draft state, unpicks members, and creates configured teams', async () => {
      // Seed and pick a member first
      const initCfg = await POST(
        new Request('http://localhost/api/config', {
          method: 'POST',
          body: JSON.stringify({
            teamCount: 2,
            turnDuration: 30,
            totalReserveTime: 120,
            teamNames: ['Old A', 'Old B'],
          }),
        })
      )
      const initData = await initCfg.json()

      await membersPost(
        new Request('http://localhost/api/members', {
          method: 'POST',
          body: JSON.stringify({ action: 'ADD', id: 'm1', name: 'Alice' }),
        })
      )
      await pickPost(
        new Request('http://localhost/api/pick', {
          method: 'POST',
          body: JSON.stringify({ status: 'START' }),
        })
      )
      await pickPost(
        new Request('http://localhost/api/pick', {
          method: 'POST',
          body: JSON.stringify({ memberId: 'm1', teamId: initData.teams[0].id }),
        })
      )

      // Now save new config -> resets status, unpicks m1, creates new teams
      const res = await POST(
        new Request('http://localhost/api/config', {
          method: 'POST',
          body: JSON.stringify({
            teamCount: 3,
            turnDuration: 25,
            totalReserveTime: 90,
            teamNames: ['Alpha', 'Beta', 'Gamma'],
          }),
        })
      )
      const data = await res.json()

      expect(res.status).toBe(200)
      expect(data.success).toBe(true)
      expect(data.gameState).toMatchObject({
        status: 'CONFIGURING',
        teamCount: 3,
        turnDuration: 25,
        totalReserveTime: 90,
        currentTeamIndex: 0,
        turnStartTime: null,
      })
      expect(data.teams.map((t: { name: string }) => t.name)).toEqual(['Alpha', 'Beta', 'Gamma'])
      expect(data.members[0].teamId).toBeNull()
      expect(data.members[0].pickedAt).toBeNull()
    })

    it('accepts turnDuration = 0 and totalReserveTime = 0 without falling back to defaults', async () => {
      const res = await POST(
        new Request('http://localhost/api/config', {
          method: 'POST',
          body: JSON.stringify({
            teamCount: 2,
            turnDuration: 0,
            totalReserveTime: 0,
            teamNames: ['Sudden', 'Death'],
          }),
        })
      )
      const data = await res.json()

      expect(res.status).toBe(200)
      expect(data.success).toBe(true)
      expect(data.gameState.turnDuration).toBe(0)
      expect(data.gameState.totalReserveTime).toBe(0)
      expect(data.teams).toHaveLength(2)
      expect(data.teams[0].reserveTime).toBe(0)
      expect(data.teams[1].reserveTime).toBe(0)
    })
  })

  describe('PrismaStateStore', () => {
    beforeEach(() => {
      setStateStore(new PrismaStateStore())
    })

    it('executes atomic interactive transaction with batched team.createMany', async () => {
      ;(prisma.gameState.findUnique as any).mockResolvedValue({
        id: 'singleton',
        version: 1,
        status: 'PICKING',
        currentTeamIndex: 1,
        turnStartTime: new Date(),
        turnDuration: 30,
        totalReserveTime: 120,
        teamCount: 2,
      })
      ;(prisma.team.findMany as any).mockResolvedValue([])
      ;(prisma.member.findMany as any).mockResolvedValue([])
      ;(prisma.gameState.updateMany as any).mockResolvedValue({ count: 1 })
      ;(prisma.member.updateMany as any).mockResolvedValue({ count: 0 })
      ;(prisma.team.deleteMany as any).mockResolvedValue({ count: 0 })
      ;(prisma.team.createMany as any).mockResolvedValue({ count: 2 })

      const res = await POST(
        new Request('http://localhost/api/config', {
          method: 'POST',
          body: JSON.stringify({
            teamCount: 2,
            turnDuration: 30,
            totalReserveTime: 0,
            teamNames: ['Alpha', 'Beta'],
          }),
        })
      )
      const data = await res.json()

      expect(res.status).toBe(200)
      expect(data.success).toBe(true)
      expect(data.gameState.totalReserveTime).toBe(0)
      expect(prisma.gameState.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'singleton', version: 1 },
          data: expect.objectContaining({
            version: 2,
            status: 'CONFIGURING',
            totalReserveTime: 0,
          }),
        })
      )
      expect(prisma.member.updateMany).toHaveBeenCalledWith({
        data: { teamId: null, pickedAt: null, isBanned: false },
      })
      expect(prisma.team.deleteMany).toHaveBeenCalledTimes(1)
      expect(prisma.team.createMany).toHaveBeenCalledWith({
        data: expect.arrayContaining([
          expect.objectContaining({ name: 'Alpha', order: 0, reserveTime: 0 }),
          expect.objectContaining({ name: 'Beta', order: 1, reserveTime: 0 }),
        ]),
      })
    })
  })
})
