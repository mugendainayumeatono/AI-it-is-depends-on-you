import { describe, it, expect, vi, beforeEach } from 'vitest'
import { POST } from '@/app/api/randomize/route'
import { POST as configPost } from '@/app/api/config/route'
import { POST as membersPost } from '@/app/api/members/route'
import prisma from '@/lib/prisma'
import { PrismaStateStore, setStateStore } from '@/lib/stateStore'

describe('API: POST /api/randomize', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('InMemoryStateStore', () => {
    it('shuffles and distributes members evenly across teams and marks COMPLETED', async () => {
      await configPost(
        new Request('http://localhost/api/config', {
          method: 'POST',
          body: JSON.stringify({
            teamCount: 2,
            turnDuration: 30,
            totalReserveTime: 120,
            teamNames: ['Radiant', 'Dire'],
          }),
        })
      )
      for (const name of ['M1', 'M2', 'M3', 'M4']) {
        await membersPost(
          new Request('http://localhost/api/members', {
            method: 'POST',
            body: JSON.stringify({ action: 'ADD', id: name.toLowerCase(), name }),
          })
        )
      }

      // Empty body (legacy POST()) works
      const response = await POST()
      const data = await response.json()

      expect(response.status).toBe(200)
      expect(data.success).toBe(true)
      expect(data.gameState.status).toBe('COMPLETED')
      expect(data.teams[0].members).toHaveLength(2)
      expect(data.teams[1].members).toHaveLength(2)
      expect(data.members.every((m: { teamId: string | null }) => m.teamId !== null)).toBe(true)
    })

    it('honors client-supplied shuffledMemberIds for deterministic optimistic parity', async () => {
      await configPost(
        new Request('http://localhost/api/config', {
          method: 'POST',
          body: JSON.stringify({
            teamCount: 2,
            turnDuration: 30,
            totalReserveTime: 120,
            teamNames: ['Team 1', 'Team 2'],
          }),
        })
      )
      for (const id of ['m1', 'm2', 'm3', 'm4']) {
        await membersPost(
          new Request('http://localhost/api/members', {
            method: 'POST',
            body: JSON.stringify({ action: 'ADD', id, name: id.toUpperCase() }),
          })
        )
      }

      const response = await POST(
        new Request('http://localhost/api/randomize', {
          method: 'POST',
          body: JSON.stringify({ shuffledMemberIds: ['m4', 'm3', 'm2', 'm1'] }),
        })
      )
      const data = await response.json()

      expect(response.status).toBe(200)
      const t1MemberIds = data.teams[0].members.map((m: { id: string }) => m.id).sort()
      const t2MemberIds = data.teams[1].members.map((m: { id: string }) => m.id).sort()
      expect(t1MemberIds).toEqual(['m2', 'm4'])
      expect(t2MemberIds).toEqual(['m1', 'm3'])
    })

    it('returns 400 if no teams are configured', async () => {
      const response = await POST()
      expect(response.status).toBe(400)
      const data = await response.json()
      expect(data.error).toBe('No teams configured')
    })
  })

  describe('PrismaStateStore', () => {
    beforeEach(() => {
      setStateStore(new PrismaStateStore())
    })

    it('batches team assignments with member.updateMany per team inside interactive transaction', async () => {
      ;(prisma.gameState.findUnique as any).mockResolvedValue({
        id: 'singleton',
        version: 2,
        status: 'CONFIGURING',
        currentTeamIndex: 0,
        turnStartTime: new Date(),
        turnDuration: 30,
        totalReserveTime: 120,
        teamCount: 2,
      })
      ;(prisma.team.findMany as any).mockResolvedValue([
        { id: 'team1', name: 'T1', order: 0, reserveTime: 120 },
        { id: 'team2', name: 'T2', order: 1, reserveTime: 120 },
      ])
      ;(prisma.member.findMany as any).mockResolvedValue([
        { id: 'm1', name: 'A', info: '', teamId: null, isBanned: false, pickedAt: null },
        { id: 'm2', name: 'B', info: '', teamId: null, isBanned: false, pickedAt: null },
        { id: 'm3', name: 'C', info: '', teamId: null, isBanned: false, pickedAt: null },
        { id: 'm4', name: 'D', info: '', teamId: null, isBanned: false, pickedAt: null },
      ])
      ;(prisma.gameState.updateMany as any).mockResolvedValue({ count: 1 })
      ;(prisma.member.updateMany as any).mockResolvedValue({ count: 2 })

      const response = await POST()
      const data = await response.json()

      expect(response.status).toBe(200)
      expect(data.success).toBe(true)
      expect(data.gameState.status).toBe('COMPLETED')
      // 2 batched updateMany calls (1 per team) instead of 4 individual updates!
      expect(prisma.member.updateMany).toHaveBeenCalledTimes(2)
      expect(prisma.gameState.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'singleton', version: 2 },
          data: expect.objectContaining({ version: 3, status: 'COMPLETED' }),
        })
      )
    })
  })
})
