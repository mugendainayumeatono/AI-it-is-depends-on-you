import PusherServer from 'pusher'
import type { InvalidateEvent, RealtimeEvent } from '@/types'

export const PUSHER_CHANNEL = 'banpick-channel'
export const PUSHER_PRIVATE_CHANNEL = 'private-banpick-channel'
export const PUSHER_EVENT = 'state-update'

/**
 * Safety margin below Pusher Channels' hard 10,240-byte event data limit.
 * Any serialized payload exceeding this threshold is downgraded to a tiny
 * `invalidate` event so Pusher never returns HTTP 413 Payload Too Large.
 */
export const PUSHER_MAX_SAFE_BYTES = 9000

interface CachedPusherEntry {
  signature: string
  instance: PusherServer
}

declare global {
  var __banpickPusherCache: CachedPusherEntry | undefined
}

function getPusherCredentials(): {
  appId: string
  key: string
  secret: string
  cluster: string
} | null {
  const appId = process.env.PUSHER_APP_ID
  const key = process.env.NEXT_PUBLIC_PUSHER_KEY
  const secret = process.env.PUSHER_SECRET
  const cluster = process.env.NEXT_PUBLIC_PUSHER_CLUSTER

  if (!appId || !key || !secret || !cluster) {
    return null
  }

  return { appId, key, secret, cluster }
}

export function isPusherServerConfigured(): boolean {
  return getPusherCredentials() !== null
}

export function getPusherServer(): PusherServer | null {
  const creds = getPusherCredentials()
  if (!creds) {
    return null
  }

  const signature = `${creds.appId}:${creds.key}:${creds.secret}:${creds.cluster}`
  const cached = globalThis.__banpickPusherCache
  if (cached && cached.signature === signature) {
    return cached.instance
  }

  const instance = new PusherServer({
    appId: creds.appId,
    key: creds.key,
    secret: creds.secret,
    cluster: creds.cluster,
    useTLS: true,
  })

  globalThis.__banpickPusherCache = { signature, instance }
  return instance
}

/**
 * Backwards-compatible module-level export for existing callers/tests.
 */
export const pusherServer = getPusherServer()

export function shouldTriggerPusher(): boolean {
  const method = (process.env.NEXT_PUBLIC_SYNC_METHOD || 'AUTO').toUpperCase()
  if (method === 'POLLING' || method === 'SSE') {
    return false
  }
  return isPusherServerConfigured()
}

export function buildSafePusherPayload(event?: RealtimeEvent): RealtimeEvent | (InvalidateEvent & { timestamp: number }) {
  if (!event) {
    const now = Date.now()
    return {
      kind: 'invalidate',
      version: 0,
      serverTime: now,
      timestamp: now,
      mutationId: null,
    }
  }

  const byteLen = Buffer.byteLength(JSON.stringify(event), 'utf8')
  if (byteLen > PUSHER_MAX_SAFE_BYTES) {
    return {
      kind: 'invalidate',
      version: event.version,
      serverTime: event.serverTime,
      mutationId: event.mutationId ?? null,
    }
  }

  return event
}

export async function triggerStateUpdate(event?: RealtimeEvent): Promise<void> {
  if (!shouldTriggerPusher()) return

  const server = getPusherServer()
  if (!server) return

  const payload = buildSafePusherPayload(event)

  try {
    await server.trigger(PUSHER_CHANNEL, PUSHER_EVENT, payload)
  } catch (error) {
    console.error('Pusher trigger error:', error)
  }
}
