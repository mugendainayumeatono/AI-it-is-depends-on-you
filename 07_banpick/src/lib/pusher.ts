import https from 'node:https'
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

const PUSHER_WARM_COOLDOWN_MS = 20_000

interface CachedPusherEntry {
  signature: string
  instance: PusherServer
}

declare global {
  var __banpickPusherCache: CachedPusherEntry | undefined
  var __banpickPusherHttpsAgent: https.Agent | undefined
  var __banpickPusherWarmTimestamp: number | undefined
}

export function getPusherHttpsAgent(): https.Agent {
  if (!globalThis.__banpickPusherHttpsAgent) {
    globalThis.__banpickPusherHttpsAgent = new https.Agent({
      keepAlive: true,
      keepAliveMsecs: 30000,
      maxSockets: 16,
      maxFreeSockets: 4,
    })
  }
  return globalThis.__banpickPusherHttpsAgent
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
    agent: getPusherHttpsAgent(),
    timeout: 5000,
  } as PusherServer.Options)

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

export async function warmPusherConnection(): Promise<void> {
  if (!shouldTriggerPusher()) return

  const now = Date.now()
  const lastWarmed = globalThis.__banpickPusherWarmTimestamp ?? 0
  if (now - lastWarmed < PUSHER_WARM_COOLDOWN_MS) {
    return
  }

  const server = getPusherServer()
  if (!server || typeof (server as { get?: unknown }).get !== 'function') {
    return
  }

  globalThis.__banpickPusherWarmTimestamp = now
  try {
    await server.get({ path: `/channels/${PUSHER_CHANNEL}` })
  } catch {
    // Ignore background TLS pre-warm errors
  }
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
