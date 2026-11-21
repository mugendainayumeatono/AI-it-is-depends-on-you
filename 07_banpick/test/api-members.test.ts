import { describe, it, expect, vi, beforeEach } from 'vitest'
import { POST } from '@/app/api/members/route'
import { GET as getMedia } from '@/app/api/members/[id]/media/route'
import prisma from '@/lib/prisma'
import { subscribeLocalEvents } from '@/lib/realtime'
import { PrismaStateStore, setStateStore } from '@/lib/stateStore'
import type { RealtimeEvent } from '@/types'

describe('API: POST /api/members & GET /api/members/[id]/media', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('InMemoryStateStore', () => {
    it('adds a member without images', async () => {
      const response = await POST(
        new Request('http://localhost/api/members', {
          method: 'POST',
          body: JSON.stringify({ action: 'ADD', id: 'm-basic', name: 'John Doe', info: 'Carry' }),
        })
      )
      const data = await response.json()

      expect(response.status).toBe(200)
      expect(data.success).toBe(true)
      expect(data.members).toHaveLength(1)
      expect(data.members[0]).toMatchObject({
        id: 'm-basic',
        name: 'John Doe',
        info: 'Carry',
        avatar: null,
        background: null,
        mediaVersion: 0,
      })
    })

    it('strips inline base64 to proxy URLs in state & broadcast, and serves immutable binary images via media proxy', async () => {
      const receivedEvents: RealtimeEvent[] = []
      const unsub = subscribeLocalEvents((ev) => receivedEvents.push(ev))

      const avatarBytes = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46])
      const bgBytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
      const avatarDataUrl = `data:image/jpeg;base64,${avatarBytes.toString('base64')}`
      const bgDataUrl = `data:image/png;base64,${bgBytes.toString('base64')}`

      const response = await POST(
        new Request('http://localhost/api/members', {
          method: 'POST',
          body: JSON.stringify({
            action: 'ADD',
            id: 'jane-1',
            name: 'Jane Doe',
            info: 'Mid',
            avatar: avatarDataUrl,
            background: bgDataUrl,
          }),
        })
      )
      unsub()

      const data = await response.json()
      expect(response.status).toBe(200)
      expect(data.success).toBe(true)
      expect(data.members[0].avatar).toBe('/api/members/jane-1/media?field=avatar&v=1')
      expect(data.members[0].background).toBe('/api/members/jane-1/media?field=background&v=1')

      // Broadcast event also has ZERO base64 blobs
      expect(receivedEvents).toHaveLength(1)
      expect(JSON.stringify(receivedEvents[0])).not.toContain('data:image/')
      expect(JSON.stringify(data)).not.toContain('data:image/')

      // GET /api/members/jane-1/media?field=avatar&v=1 decodes exact binary JPEG with immutable cache header
      const avatarRes = await getMedia(
        new Request('http://localhost/api/members/jane-1/media?field=avatar&v=1'),
        { params: Promise.resolve({ id: 'jane-1' }) }
      )
      expect(avatarRes.status).toBe(200)
      expect(avatarRes.headers.get('Content-Type')).toBe('image/jpeg')
      expect(avatarRes.headers.get('Cache-Control')).toBe('public, max-age=31536000, immutable')
      const returnedBytes = Buffer.from(await avatarRes.arrayBuffer())
      expect(returnedBytes.equals(avatarBytes)).toBe(true)

      // Background PNG
      const bgRes = await getMedia(
        new Request('http://localhost/api/members/jane-1/media?field=background&v=1'),
        { params: Promise.resolve({ id: 'jane-1' }) }
      )
      expect(bgRes.status).toBe(200)
      expect(bgRes.headers.get('Content-Type')).toBe('image/png')
      expect(Buffer.from(await bgRes.arrayBuffer()).equals(bgBytes)).toBe(true)

      // Edit member name WITHOUT changing image (client sends back existing proxy URL)
      const updateRes = await POST(
        new Request('http://localhost/api/members', {
          method: 'POST',
          body: JSON.stringify({
            action: 'UPDATE',
            id: 'jane-1',
            name: 'Jane Updated',
            info: 'Offlane',
            avatar: '/api/members/jane-1/media?field=avatar&v=1',
            background: '/api/members/jane-1/media?field=background&v=1',
          }),
        })
      )
      const updatedData = await updateRes.json()
      expect(updateRes.status).toBe(200)
      expect(updatedData.members[0]).toMatchObject({
        name: 'Jane Updated',
        info: 'Offlane',
        avatar: '/api/members/jane-1/media?field=avatar&v=1',
        background: '/api/members/jane-1/media?field=background&v=1',
        mediaVersion: 1,
      })

      // Stored binary media is STILL intact after edit!
      const preservedRes = await getMedia(
        new Request('http://localhost/api/members/jane-1/media?field=avatar&v=1'),
        { params: Promise.resolve({ id: 'jane-1' }) }
      )
      expect(preservedRes.status).toBe(200)
      expect(Buffer.from(await preservedRes.arrayBuffer()).equals(avatarBytes)).toBe(true)
    })

    it('validates media proxy query params, redirects external URLs, and cleans up media on DELETE', async () => {
      // Invalid field -> 400
      const badField = await getMedia(
        new Request('http://localhost/api/members/m1/media?field=invalid'),
        { params: Promise.resolve({ id: 'm1' }) }
      )
      expect(badField.status).toBe(400)

      // Missing member -> 404
      const missing = await getMedia(
        new Request('http://localhost/api/members/does-not-exist/media?field=avatar'),
        { params: Promise.resolve({ id: 'does-not-exist' }) }
      )
      expect(missing.status).toBe(404)

      // External URL redirects 302
      await POST(
        new Request('http://localhost/api/members', {
          method: 'POST',
          body: JSON.stringify({
            action: 'ADD',
            id: 'ext-1',
            name: 'External',
            avatar: 'https://cdn.example.com/avatar.png',
          }),
        })
      )
      const redirectRes = await getMedia(
        new Request('http://localhost/api/members/ext-1/media?field=avatar'),
        { params: Promise.resolve({ id: 'ext-1' }) }
      )
      expect(redirectRes.status).toBe(302)
      expect(redirectRes.headers.get('location')).toBe('https://cdn.example.com/avatar.png')

      // Delete supports legacy memberId field
      const delRes = await POST(
        new Request('http://localhost/api/members', {
          method: 'POST',
          body: JSON.stringify({ action: 'DELETE', memberId: 'ext-1' }),
        })
      )
      const delData = await delRes.json()
      expect(delRes.status).toBe(200)
      expect(delData.members).toHaveLength(0)
    })
  })

  describe('PrismaStateStore', () => {
    beforeEach(() => {
      setStateStore(new PrismaStateStore())
    })

    it('persists raw base64 blob in avatar column and proxy URL in avatarUrl column, preserving blob on metadata-only edit', async () => {
      const jpeg = 'data:image/jpeg;base64,/9j/4AAQSkZJRg=='

      ;(prisma.gameState.findUnique as any).mockResolvedValue({
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
      ;(prisma.gameState.updateMany as any).mockResolvedValue({ count: 1 })
      ;(prisma.member.create as any).mockResolvedValue({})

      const addRes = await POST(
        new Request('http://localhost/api/members', {
          method: 'POST',
          body: JSON.stringify({
            action: 'ADD',
            id: 'pm-1',
            name: 'Prisma Member',
            info: 'Support',
            avatar: jpeg,
          }),
        })
      )
      expect(addRes.status).toBe(200)
      expect(prisma.member.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          id: 'pm-1',
          name: 'Prisma Member',
          avatar: jpeg,
          avatarUrl: '/api/members/pm-1/media?field=avatar&v=1',
          mediaVersion: 1,
        }),
      })

      // Now edit without replacing avatar (proxy URL passed back)
      ;(prisma.member.findMany as any).mockResolvedValue([
        {
          id: 'pm-1',
          name: 'Prisma Member',
          info: 'Support',
          avatarUrl: '/api/members/pm-1/media?field=avatar&v=1',
          backgroundUrl: null,
          mediaVersion: 1,
          teamId: null,
          isBanned: false,
          pickedAt: null,
          order: 0,
        },
      ])
      ;(prisma.member.update as any).mockResolvedValue({})

      const updRes = await POST(
        new Request('http://localhost/api/members', {
          method: 'POST',
          body: JSON.stringify({
            action: 'UPDATE',
            id: 'pm-1',
            name: 'Renamed',
            avatar: '/api/members/pm-1/media?field=avatar&v=1',
          }),
        })
      )
      expect(updRes.status).toBe(200)
      const updateCallData = (prisma.member.update as any).mock.calls[0][0].data
      expect(updateCallData.name).toBe('Renamed')
      expect(updateCallData.avatarUrl).toBe('/api/members/pm-1/media?field=avatar&v=1')
      // Raw avatar column MUST NOT be overwritten when proxy URL is sent back!
      expect(updateCallData.avatar).toBeUndefined()
    })
  })
})
