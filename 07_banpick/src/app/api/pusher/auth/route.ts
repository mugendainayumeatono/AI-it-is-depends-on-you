import { NextResponse } from 'next/server'
import {
  getPusherServer,
  PUSHER_PRIVATE_CHANNEL,
  shouldTriggerPusher,
  warmPusherConnection,
} from '@/lib/pusher'
import { scheduleAfter } from '@/lib/realtime'

export const dynamic = 'force-dynamic'
export const preferredRegion = 'hnd1'

const NO_STORE_HEADERS = {
  'Cache-Control': 'no-store',
} as const

async function parseAuthBody(req: Request): Promise<{ socketId: string; channelName: string }> {
  const contentType = req.headers.get('content-type') || ''
  const raw = await req.text()

  if (contentType.includes('application/json') || raw.trim().startsWith('{')) {
    try {
      const parsed = JSON.parse(raw) as Record<string, unknown>
      return {
        socketId: typeof parsed.socket_id === 'string' ? parsed.socket_id : '',
        channelName: typeof parsed.channel_name === 'string' ? parsed.channel_name : '',
      }
    } catch {
      return { socketId: '', channelName: '' }
    }
  }

  const params = new URLSearchParams(raw)
  return {
    socketId: params.get('socket_id') ?? '',
    channelName: params.get('channel_name') ?? '',
  }
}

export async function POST(req: Request) {
  try {
    const pusher = getPusherServer()
    if (!pusher) {
      return NextResponse.json(
        { error: 'Pusher is not configured' },
        { status: 503, headers: NO_STORE_HEADERS }
      )
    }

    const { socketId, channelName } = await parseAuthBody(req)
    if (!socketId || !channelName) {
      return NextResponse.json(
        { error: 'Missing socket_id or channel_name' },
        { status: 400, headers: NO_STORE_HEADERS }
      )
    }

    if (channelName !== PUSHER_PRIVATE_CHANNEL) {
      return NextResponse.json(
        { error: 'Forbidden channel' },
        { status: 403, headers: NO_STORE_HEADERS }
      )
    }

    const authResponse = pusher.authorizeChannel(socketId, channelName)
    if (shouldTriggerPusher()) {
      scheduleAfter(() => warmPusherConnection())
    }
    return NextResponse.json(authResponse, { headers: NO_STORE_HEADERS })
  } catch (error) {
    console.error('POST /api/pusher/auth error:', error)
    return NextResponse.json(
      { error: 'Failed to authorize Pusher channel' },
      { status: 500, headers: NO_STORE_HEADERS }
    )
  }
}
