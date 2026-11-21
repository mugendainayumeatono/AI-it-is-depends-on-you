import { describe, it, expect, vi, beforeEach } from 'vitest'
import { POST } from '@/app/api/pick/route'
import { POST as configPost } from '@/app/api/config/route'
import { POST as membersPost } from '@/app/api/members/route'
import prisma from '@/lib/prisma'
import { PrismaStateStore, setStateStore } from '@/lib/stateStore'

async function seedMemoryGame(memberNames = ['Alice', 'Bob']) {
  const cfgRes = await configPost(
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
  const cfgData = await cfgRes.json()

  const memberIds: string[] = []
  for (let i = 0; i < memberNames.length; i++) {
    const id = `m${i + 1}`
    memberIds.push(id)
    await membersPost(
      new Request('http://localhost/api/members', {
        method: 'POST',
        body: JSON.stringify({ action: 'ADD', id, name: memberNames[i], info: '' }),
      })
    )
  }

  return {
    teamIds: cfgData.teams.map((t: { id: string }) => t.id) as string[],
    memberIds,
  }
}

describe('API: POST /api/pick', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('InMemoryStateStore', () => {
    it('starts the game cleanly and handles stale duplicate START idempotently', async () => {
      await seedMemoryGame()

      const startRes = await POST(
        new Request('http://localhost/api/pick', {
          method: 'POST',
          body: JSON.stringify({ status: 'START', expectedVersion: 4 }),
        })
      )
      const startData = await startRes.json()

      expect(startRes.status).toBe(200)
      expect(startData.success).toBe(true)
      expect(startData.gameState.status).toBe('PICKING')
      expect(startData.delta).toMatchObject({ kind: 'delta', op: 'START' })

      // Second client sends START with old expectedVersion -> alreadyApplied (200, no version bump)
      const dupRes = await POST(
        new Request('http://localhost/api/pick', {
          method: 'POST',
          body: JSON.stringify({ status: 'START', expectedVersion: 4 }),
        })
      )
      const dupData = await dupRes.json()
      expect(dupRes.status).toBe(200)
      expect(dupData.alreadyApplied).toBe(true)
      expect(dupData.version).toBe(startData.version)
    })

    it('picks members, prevents double-pick, and atomically completes on final pick', async () => {
      const { teamIds, memberIds } = await seedMemoryGame(['Alice', 'Bob'])

      const startRes = await POST(
        new Request('http://localhost/api/pick', {
          method: 'POST',
          body: JSON.stringify({ status: 'START' }),
        })
      )
      const startData = await startRes.json()

      // Pick #1: Radiant picks Alice
      const pick1Res = await POST(
        new Request('http://localhost/api/pick', {
          method: 'POST',
          body: JSON.stringify({
            memberId: memberIds[0],
            teamId: teamIds[0],
            expectedVersion: startData.version,
          }),
        })
      )
      const pick1 = await pick1Res.json()
      expect(pick1Res.status).toBe(200)
      expect(pick1.success).toBe(true)
      expect(pick1.gameState.status).toBe('PICKING')
      expect(pick1.gameState.currentTeamIndex).toBe(1)
      expect(pick1.pickedMemberId).toBe(memberIds[0])
      expect(pick1.delta.memberPatch).toMatchObject({ id: memberIds[0], teamId: teamIds[0] })

      // Attempt to double-pick Alice on Dire's turn -> 409 MEMBER_UNAVAILABLE with authoritative state
      const doublePickRes = await POST(
        new Request('http://localhost/api/pick', {
          method: 'POST',
          body: JSON.stringify({
            memberId: memberIds[0],
            teamId: teamIds[1],
            expectedVersion: pick1.version,
          }),
        })
      )
      const doublePick = await doublePickRes.json()
      expect(doublePickRes.status).toBe(409)
      expect(doublePick.code).toBe('MEMBER_UNAVAILABLE')
      expect(doublePick.version).toBe(pick1.version)
      expect(doublePick.gameState).toBeDefined()
      expect(doublePick.teams).toHaveLength(2)

      // Pick #2 (final available member): Dire picks Bob -> atomic COMPLETED!
      const pick2Res = await POST(
        new Request('http://localhost/api/pick', {
          method: 'POST',
          body: JSON.stringify({
            memberId: memberIds[1],
            teamId: teamIds[1],
            expectedVersion: pick1.version,
          }),
        })
      )
      const pick2 = await pick2Res.json()
      expect(pick2Res.status).toBe(200)
      expect(pick2.success).toBe(true)
      expect(pick2.gameState.status).toBe('COMPLETED')
      expect(pick2.version).toBe(pick1.version + 1)
    })

    it('handles AUTO_PICK cleanly and makes superseded expectedVersion idempotent (NO 409 storm!)', async () => {
      const { teamIds } = await seedMemoryGame(['Alice', 'Bob'])

      const startRes = await POST(
        new Request('http://localhost/api/pick', {
          method: 'POST',
          body: JSON.stringify({ status: 'START' }),
        })
      )
      const startData = await startRes.json()

      // First client's timer expires and triggers AUTO_PICK at version N
      const auto1Res = await POST(
        new Request('http://localhost/api/pick', {
          method: 'POST',
          body: JSON.stringify({
            action: 'AUTO_PICK',
            teamId: teamIds[0],
            expectedVersion: startData.version,
          }),
        })
      )
      const auto1 = await auto1Res.json()
      expect(auto1Res.status).toBe(200)
      expect(auto1.success).toBe(true)
      expect(auto1.alreadyApplied).toBeFalsy()
      expect(auto1.pickedMemberId).toBeDefined()
      expect(auto1.delta.teamPatch).toEqual({ id: teamIds[0], reserveTime: 0 })

      // Second & third clients' timers also expire for the SAME turn (expectedVersion === startData.version)
      const auto2Res = await POST(
        new Request('http://localhost/api/pick', {
          method: 'POST',
          body: JSON.stringify({
            action: 'AUTO_PICK',
            teamId: teamIds[0],
            expectedVersion: startData.version,
          }),
        })
      )
      const auto2 = await auto2Res.json()
      expect(auto2Res.status).toBe(200)
      expect(auto2.success).toBe(true)
      expect(auto2.alreadyApplied).toBe(true)
      expect(auto2.version).toBe(auto1.version)
    })

    it('blocks picking when not in PICKING phase or not active team turn', async () => {
      const { teamIds, memberIds } = await seedMemoryGame(['Alice', 'Bob'])

      // Still CONFIGURING
      const resConfiguring = await POST(
        new Request('http://localhost/api/pick', {
          method: 'POST',
          body: JSON.stringify({ memberId: memberIds[0], teamId: teamIds[0] }),
        })
      )
      expect(resConfiguring.status).toBe(400)
      expect((await resConfiguring.json()).error).toBe('Not in picking phase')

      await POST(
        new Request('http://localhost/api/pick', {
          method: 'POST',
          body: JSON.stringify({ status: 'START' }),
        })
      )

      // Team 2 tries to pick during Team 1's turn
      const resWrongTurn = await POST(
        new Request('http://localhost/api/pick', {
          method: 'POST',
          body: JSON.stringify({ memberId: memberIds[0], teamId: teamIds[1] }),
        })
      )
      expect(resWrongTurn.status).toBe(400)
      expect((await resWrongTurn.json()).error).toBe('Not your turn')
    })
  })

  describe('PrismaStateStore', () => {
    beforeEach(() => {
      setStateStore(new PrismaStateStore())
    })

    it('acquires singleton version lock via gameState.updateMany and claims member via member.updateMany', async () => {
      ;(prisma.gameState.findUnique as any).mockResolvedValue({
        id: 'singleton',
        version: 2,
        status: 'PICKING',
        currentTeamIndex: 0,
        turnDuration: 30,
        totalReserveTime: 120,
        turnStartTime: new Date(),
        teamCount: 2,
      })
      ;(prisma.team.findMany as any).mockResolvedValue([
        { id: 'team1', name: 'T1', order: 0, reserveTime: 120 },
        { id: 'team2', name: 'T2', order: 1, reserveTime: 120 },
      ])
      ;(prisma.member.findMany as any).mockResolvedValue([
        {
          id: 'member1',
          name: 'Alice',
          info: '',
          avatarUrl: null,
          backgroundUrl: null,
          mediaVersion: 0,
          teamId: null,
          isBanned: false,
          pickedAt: null,
          order: 0,
        },
        {
          id: 'member2',
          name: 'Bob',
          info: '',
          avatarUrl: null,
          backgroundUrl: null,
          mediaVersion: 0,
          teamId: null,
          isBanned: false,
          pickedAt: null,
          order: 0,
        },
      ])
      ;(prisma.gameState.updateMany as any).mockResolvedValue({ count: 1 })
      ;(prisma.member.updateMany as any).mockResolvedValue({ count: 1 })
      ;(prisma.team.update as any).mockResolvedValue({})

      const response = await POST(
        new Request('http://localhost/api/pick', {
          method: 'POST',
          body: JSON.stringify({ memberId: 'member1', teamId: 'team1', expectedVersion: 2 }),
        })
      )
      const data = await response.json()

      expect(response.status).toBe(200)
      expect(data.success).toBe(true)
      expect(data.version).toBe(3)
      expect(prisma.gameState.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'singleton', version: 2 },
          data: expect.objectContaining({ version: 3, currentTeamIndex: 1 }),
        })
      )
      expect(prisma.member.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'member1', teamId: null, isBanned: false },
          data: expect.objectContaining({ teamId: 'team1' }),
        })
      )
    })
  })
})
