import { after } from 'next/server'
import type { RealtimeEvent } from '@/types'
import { shouldTriggerPusher, triggerStateUpdate } from '@/lib/pusher'

export const UPSTASH_PUBSUB_CHANNEL = 'banpick:pubsub'

export interface UpstashConfig {
  url: string
  token: string
}

type LocalEventListener = (event: RealtimeEvent) => void

declare global {
  var __banpickLocalListeners: Set<LocalEventListener> | undefined
}

function getLocalListeners(): Set<LocalEventListener> {
  if (!globalThis.__banpickLocalListeners) {
    globalThis.__banpickLocalListeners = new Set<LocalEventListener>()
  }
  return globalThis.__banpickLocalListeners
}

export function getUpstashConfig(): UpstashConfig | null {
  const url = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL
  const token = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN

  if (!url || !token) {
    return null
  }

  return {
    url: url.replace(/\/+$/, ''),
    token,
  }
}

/**
 * Schedules background work using Next.js `after()` (Vercel Fluid Compute
 * post-response execution) with safe fallback to microtask scheduling outside
 * Next.js request scope (e.g., Vitest unit tests).
 */
export function scheduleAfter(task: () => void | Promise<void>): void {
  const run = async () => {
    try {
      await task()
    } catch (error) {
      console.error('[banpick] background task error:', error)
    }
  }

  try {
    after(run)
  } catch {
    void Promise.resolve().then(run)
  }
}

export function subscribeLocalEvents(listener: LocalEventListener): () => void {
  const listeners = getLocalListeners()
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function emitLocalEvent(event: RealtimeEvent): void {
  const listeners = getLocalListeners()
  for (const listener of listeners) {
    try {
      listener(event)
    } catch (error) {
      console.error('[banpick] local realtime listener error:', error)
    }
  }
}

export function publishRealtimeEvent(
  event: RealtimeEvent,
  opts?: { skipRedisPublish?: boolean }
): void {
  // Always deliver synchronously (<0.5ms) to same-instance SSE subscribers
  emitLocalEvent(event)

  // Optional non-blocking Pusher trigger via after() (never blocks HTTP response)
  if (shouldTriggerPusher()) {
    scheduleAfter(() => triggerStateUpdate(event))
  }

  // Fallback Redis publish only if caller explicitly did not publish inside Lua
  if (opts?.skipRedisPublish === false) {
    const upstash = getUpstashConfig()
    if (upstash) {
      scheduleAfter(async () => {
        await fetch(`${upstash.url}/publish/${encodeURIComponent(UPSTASH_PUBSUB_CHANNEL)}`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${upstash.token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(event),
        })
      })
    }
  }
}

function normalizeIncomingEvent(value: unknown): RealtimeEvent | null {
  if (!value || typeof value !== 'object') return null
  const obj = value as Record<string, unknown>
  if (
    (obj.kind !== 'delta' && obj.kind !== 'snapshot' && obj.kind !== 'invalidate') ||
    typeof obj.version !== 'number' ||
    typeof obj.serverTime !== 'number'
  ) {
    return null
  }
  if (obj.kind === 'snapshot' && obj.snapshot && typeof obj.snapshot === 'object') {
    const snap = obj.snapshot as Record<string, unknown>
    return {
      ...(obj as unknown as RealtimeEvent & { kind: 'snapshot' }),
      snapshot: {
        ...(snap as unknown as (RealtimeEvent & { kind: 'snapshot' })['snapshot']),
        teams: Array.isArray(snap.teams) ? snap.teams : [],
        members: Array.isArray(snap.members) ? snap.members : [],
      },
    }
  }
  return obj as unknown as RealtimeEvent
}

export interface UpstashPubSubOptions {
  channel?: string
  onReady?: () => void
  onDisconnect?: () => void
}

/**
 * Subscribes to Upstash Redis REST `/subscribe/<channel>` SSE endpoint and
 * forwards decoded RealtimeEvent payloads to `onEvent` until `signal` aborts.
 */
export async function subscribeUpstashPubSub(
  onEvent: (event: RealtimeEvent) => void,
  signal: AbortSignal,
  channelOrOpts: string | UpstashPubSubOptions = UPSTASH_PUBSUB_CHANNEL
): Promise<void> {
  const opts: UpstashPubSubOptions =
    typeof channelOrOpts === 'string' ? { channel: channelOrOpts } : channelOrOpts
  const channel = opts.channel ?? UPSTASH_PUBSUB_CHANNEL

  let readyFired = false
  const fireReady = () => {
    if (!readyFired) {
      readyFired = true
      opts.onReady?.()
    }
  }

  const upstash = getUpstashConfig()
  if (!upstash || signal.aborted) {
    fireReady()
    return
  }

  const endpoint = `${upstash.url}/subscribe/${encodeURIComponent(channel)}`
  let reader: ReadableStreamDefaultReader<Uint8Array> | null = null

  try {
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${upstash.token}`,
        Accept: 'text/event-stream',
      },
      signal,
    })

    if (!res.ok || !res.body) {
      fireReady()
      return
    }

    fireReady()

    reader = res.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''

    while (!signal.aborted) {
      const { value, done } = await reader.read()
      if (done) break

      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split(/\r?\n/)
      buffer = lines.pop() ?? ''

      for (const rawLine of lines) {
        const line = rawLine.trim()
        if (!line.startsWith('data:')) continue

        const payload = line.slice(5).trim()
        if (!payload.startsWith('message,')) continue

        // Format: "message,<channel>,<json>"
        const firstComma = payload.indexOf(',')
        const secondComma = payload.indexOf(',', firstComma + 1)
        if (secondComma === -1) continue

        const jsonPart = payload.slice(secondComma + 1)
        try {
          const parsed: unknown = JSON.parse(jsonPart)
          const normalized = normalizeIncomingEvent(parsed)
          if (normalized) {
            onEvent(normalized)
          }
        } catch {
          // Ignore malformed non-event messages
        }
      }
    }
  } catch (error) {
    if (!signal.aborted) {
      console.error('[banpick] Upstash pubsub subscribe error:', error)
    }
  } finally {
    fireReady()
    if (reader) {
      try {
        await reader.cancel()
      } catch {
        // Ignore cancel errors on abort
      }
    }
    if (!signal.aborted) {
      opts.onDisconnect?.()
    }
  }
}
