import { describe, it, expect, vi, beforeEach } from 'vitest'
import { GET } from '@/app/api/state/route'
import { POST as configPost } from '@/app/api/config/route'
import { POST as membersPost } from '@/app/api/members/route'
import prisma from '@/lib/prisma'
import { PrismaStateStore, setStateStore } from '@/lib/stateStore'

describe('API: GET /api/state', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('InMemoryStateStore', () => {
    it('returns full materialized state with version, serverTime, no-store header, and ZERO inline base64 blobs', async () => {
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

      const jpegBase64 = 'data:image/jpeg;base64,' + Buffer.from('fake-jpeg-bytes').toString('base64')
      await membersPost(
        new Request('http://localhost/api/members', {
          method: 'POST',
          body: JSON.stringify({
            action: 'ADD',
            id: 'mem-1',
            name: 'Miracle',
            info: 'Carry',
            avatar: jpegBase64,
            background: jpegBase64,
          }),
        })
      )

      const response = await GET(new Request('http://localhost/api/state'))
      expect(response.status).toBe(200)
      expect(response.headers.get('Cache-Control')).toBe('no-store')

      const data = await response.json()
      expect(data.version).toBe(3)
      expect(data.gameState.status).toBe('CONFIGURING')
      expect(data.teams).toHaveLength(2)
      expect(data.members).toHaveLength(1)
      expect(data.serverTime).toBeTypeOf('number')
      expect(data.members[0].avatar).toBe('/api/members/mem-1/media?field=avatar&v=1')
      expect(data.members[0].background).toBe('/api/members/mem-1/media?field=background&v=1')

      // Ensure ZERO inline base64 blobs leak into /api/state
      expect(JSON.stringify(data)).not.toContain('data:image/')
    })

    it('returns { unchanged: true } when sinceVersion >= current version, and full state when newer', async () => {
      const initialRes = await GET(new Request('http://localhost/api/state'))
      const initial = await initialRes.json()
      expect(initial.version).toBe(1)

      // Matching sinceVersion -> lightweight unchanged payload
      const unchangedRes = await GET(
        new Request(`http://localhost/api/state?sinceVersion=${initial.version}`)
      )
      const unchanged = await unchangedRes.json()
      expect(unchanged).toEqual({
        unchanged: true,
        version: 1,
        serverTime: expect.any(Number),
      })
      expect(unchanged.teams).toBeUndefined()
      expect(unchanged.members).toBeUndefined()

      // Mutate state -> version bumps to 2
      await configPost(
        new Request('http://localhost/api/config', {
          method: 'POST',
          body: JSON.stringify({
            teamCount: 2,
            turnDuration: 25,
            totalReserveTime: 60,
            teamNames: ['Alpha', 'Beta'],
          }),
        })
      )

      // Request with old sinceVersion=1 -> full materialized state
      const newerRes = await GET(new Request('http://localhost/api/state?sinceVersion=1'))
      const newer = await newerRes.json()
      expect(newer.unchanged).toBeUndefined()
      expect(newer.version).toBe(2)
      expect(newer.teams.map((t: { name: string }) => t.name)).toEqual(['Alpha', 'Beta'])
    })
  })

  describe('PrismaStateStore', () => {
    beforeEach(() => {
      setStateStore(new PrismaStateStore())
    })

    it('loads metadata-only member columns without fetching raw base64 blobs', async () => {
      ;(prisma.gameState.findUnique as any).mockResolvedValue({
        id: 'singleton',
        version: 4,
        status: 'CONFIGURING',
        currentTeamIndex: 0,
        turnStartTime: new Date(),
        turnDuration: 30,
        totalReserveTime: 120,
        teamCount: 1,
      })
      ;(prisma.team.findMany as any).mockResolvedValue([
        { id: 'team1', name: 'Team 1', order: 0, reserveTime: 120 },
      ])
      ;(prisma.member.findMany as any).mockResolvedValue([
        {
          id: 'm1',
          name: 'Member 1',
          info: 'Mid',
          avatarUrl: '/api/members/m1/media?field=avatar&v=1',
          backgroundUrl: null,
          mediaVersion: 1,
          teamId: null,
          isBanned: false,
          pickedAt: null,
          order: 0,
        },
      ])

      const response = await GET(new Request('http://localhost/api/state'))
      const data = await response.json()

      expect(data.version).toBe(4)
      expect(data.gameState.status).toBe('CONFIGURING')
      expect(data.gameState.turnStartTime).toBeNull()
      expect(data.teams).toHaveLength(1)
      expect(data.members[0].avatar).toBe('/api/members/m1/media?field=avatar&v=1')

      // Verify Prisma query uses explicit metadata select (excludes raw avatar/background columns)
      const findManyArg = (prisma.member.findMany as any).mock.calls[0][0]
      expect(findManyArg.select).toBeDefined()
      expect(findManyArg.select.avatar).toBeUndefined()
      expect(findManyArg.select.background).toBeUndefined()
      expect(findManyArg.select.avatarUrl).toBe(true)
    })

    it('initializes singleton via upsert if gameState does not exist', async () => {
      ;(prisma.gameState.findUnique as any).mockResolvedValue(null)
      ;(prisma.gameState.upsert as any).mockResolvedValue({
        id: 'singleton',
        version: 1,
        status: 'CONFIGURING',
        currentTeamIndex: 0,
        turnStartTime: new Date(),
        turnDuration: 30,
        totalReserveTime: 120,
        teamCount: 2,
      })
      ;(prisma.team.findMany as any).mockResolvedValue([])
      ;(prisma.member.findMany as any).mockResolvedValue([])

      const response = await GET()
      const data = await response.json()

      expect(prisma.gameState.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'singleton' },
        })
      )
      expect(data.gameState.id).toBe('singleton')
      expect(data.version).toBe(1)
    })
  })
})
