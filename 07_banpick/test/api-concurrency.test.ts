import { describe, it, expect, vi, beforeEach } from 'vitest'
import { POST as pickPost } from '@/app/api/pick/route'
import { POST as configPost } from '@/app/api/config/route'
import { POST as membersPost } from '@/app/api/members/route'
import prisma from '@/lib/prisma'
import { PrismaStateStore, setStateStore } from '@/lib/stateStore'

async function setupPickingSession() {
  const cfgRes = await configPost(
    new Request('http://localhost/api/config', {
      method: 'POST',
      body: JSON.stringify({
        teamCount: 2,
        turnDuration: 30,
        totalReserveTime: 60,
        teamNames: ['Team A', 'Team B'],
      }),
    })
  )
  const cfg = await cfgRes.json()

  for (const id of ['m1', 'm2', 'm3', 'm4']) {
    await membersPost(
      new Request('http://localhost/api/members', {
        method: 'POST',
        body: JSON.stringify({ action: 'ADD', id, name: `Player ${id}` }),
      })
    )
  }

  const startRes = await pickPost(
    new Request('http://localhost/api/pick', {
      method: 'POST',
      body: JSON.stringify({ status: 'START' }),
    })
  )
  const started = await startRes.json()

  return {
    teamA: cfg.teams[0].id as string,
    teamB: cfg.teams[1].id as string,
    version: started.version as number,
  }
}

describe('Concurrency & Idempotency: Multiple clients acting simultaneously', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('InMemoryStateStore', () => {
    it('allows strictly ONE winner for concurrent manual picks and returns 409 with authoritative state to loser', async () => {
      const { teamA, version } = await setupPickingSession()

      const [res1, res2] = await Promise.all([
        pickPost(
          new Request('http://localhost/api/pick', {
            method: 'POST',
            body: JSON.stringify({
              mutationId: 'pick-client-1',
              memberId: 'm1',
              teamId: teamA,
              expectedVersion: version,
            }),
          })
        ),
        pickPost(
          new Request('http://localhost/api/pick', {
            method: 'POST',
            body: JSON.stringify({
              mutationId: 'pick-client-2',
              memberId: 'm2',
              teamId: teamA,
              expectedVersion: version,
            }),
          })
        ),
      ])

      const statuses = [res1.status, res2.status].sort()
      expect(statuses).toEqual([200, 409])

      const [body1, body2] = await Promise.all([res1.json(), res2.json()])
      const winner = res1.status === 200 ? body1 : body2
      const loser = res1.status === 409 ? body1 : body2

      expect(winner.success).toBe(true)
      expect(winner.version).toBe(version + 1)

      // Loser gets authoritative state directly in 409 body -> no extra GET /api/state needed!
      expect(loser.success).toBe(false)
      expect(loser.code).toBe('VERSION_CONFLICT')
      expect(loser.version).toBe(winner.version)
      expect(loser.gameState.currentTeamIndex).toBe(1)
      expect(loser.teams).toHaveLength(2)
      expect(loser.members).toHaveLength(4)
    })

    it('handles simultaneous multi-client AUTO_PICK expiry with ZERO 409 storms', async () => {
      const { teamA, version } = await setupPickingSession()

      const responses = await Promise.all(
        ['client-1', 'client-2', 'client-3', 'client-4'].map((cid) =>
          pickPost(
            new Request('http://localhost/api/pick', {
              method: 'POST',
              body: JSON.stringify({
                action: 'AUTO_PICK',
                mutationId: `auto-${cid}`,
                clientId: cid,
                teamId: teamA,
                expectedVersion: version,
              }),
            })
          )
        )
      )

      // Every single client receives 200 OK (ZERO 409 errors!)
      expect(responses.every((r) => r.status === 200)).toBe(true)

      const bodies = await Promise.all(responses.map((r) => r.json()))
      const applied = bodies.filter((b) => !b.alreadyApplied)
      const idempotent = bodies.filter((b) => b.alreadyApplied === true)

      expect(applied).toHaveLength(1)
      expect(idempotent).toHaveLength(3)
      // All clients converge on the exact same version (strictly 1 pick occurred!)
      expect(new Set(bodies.map((b) => b.version)).size).toBe(1)
      expect(bodies[0].version).toBe(version + 1)
    })

    it('deduplicates network retries with identical mutationId idempotently', async () => {
      const { teamA, version } = await setupPickingSession()

      const makeReq = () =>
        new Request('http://localhost/api/pick', {
          method: 'POST',
          body: JSON.stringify({
            mutationId: 'same-mutation-id',
            memberId: 'm1',
            teamId: teamA,
            expectedVersion: version,
          }),
        })

      const r1 = await pickPost(makeReq())
      const b1 = await r1.json()
      expect(r1.status).toBe(200)
      expect(b1.alreadyApplied).toBeFalsy()
      expect(b1.version).toBe(version + 1)

      const r2 = await pickPost(makeReq())
      const b2 = await r2.json()
      expect(r2.status).toBe(200)
      expect(b2.alreadyApplied).toBe(true)
      expect(b2.version).toBe(version + 1)
    })
  })

  describe('PrismaStateStore', () => {
    beforeEach(() => {
      setStateStore(new PrismaStateStore())
    })

    it('returns 409 Conflict with authoritative state when gameState.updateMany version lock matches 0 rows', async () => {
      ;(prisma.gameState.findUnique as any)
        // First read inside transaction sees version 2
        .mockResolvedValueOnce({
          id: 'singleton',
          version: 2,
          status: 'PICKING',
          currentTeamIndex: 0,
          teamCount: 2,
          turnDuration: 30,
          totalReserveTime: 60,
          turnStartTime: new Date('2026-04-09T00:00:00Z'),
        })
        // Second read after 409 conflict fetches latest version 3
        .mockResolvedValueOnce({
          id: 'singleton',
          version: 3,
          status: 'PICKING',
          currentTeamIndex: 1,
          teamCount: 2,
          turnDuration: 30,
          totalReserveTime: 60,
          turnStartTime: new Date('2026-04-09T00:00:05Z'),
        })

      ;(prisma.team.findMany as any).mockResolvedValue([
        { id: 'teamA', name: 'Team A', order: 0, reserveTime: 60 },
        { id: 'teamB', name: 'Team B', order: 1, reserveTime: 60 },
      ])
      ;(prisma.member.findMany as any).mockResolvedValue([
        {
          id: 'm1',
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
      ])
      // Concurrent writer already bumped version -> updateMany returns count: 0
      ;(prisma.gameState.updateMany as any).mockResolvedValueOnce({ count: 0 })

      const response = await pickPost(
        new Request('http://localhost/api/pick', {
          method: 'POST',
          body: JSON.stringify({ memberId: 'm1', teamId: 'teamA', expectedVersion: 2 }),
        })
      )
      const json = await response.json()

      expect(response.status).toBe(409)
      expect(json.error).toBe('Turn has already been taken')
      expect(json.code).toBe('VERSION_CONFLICT')
      expect(json.version).toBe(3)
      expect(json.gameState.currentTeamIndex).toBe(1)

      // Verify optimistic lock targeted exact version
      expect(prisma.gameState.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'singleton', version: 2 },
        })
      )
    })
  })
})
