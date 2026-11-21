import prisma from '@/lib/prisma'
import {
  subscribeLocalEvents,
  subscribeUpstashPubSub,
} from '@/lib/realtime'
import { getStateStore } from '@/lib/stateStore'
import type { RealtimeEvent, SnapshotEvent } from '@/types'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const HEARTBEAT_INTERVAL_MS = 20_000
const RECONNECT_RECYCLE_MS = 50_000
const PRISMA_POLL_INTERVAL_MS = 500
const UPSTASH_SUBSCRIBE_READY_TIMEOUT_MS = 1_500

function parseSinceVersion(req: Request): number {
  try {
    const url = new URL(req.url)
    const raw = url.searchParams.get('sinceVersion')
    if (!raw) return 0
    const parsed = Number.parseInt(raw, 10)
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 0
  } catch {
    return 0
  }
}

export async function GET(req: Request) {
  const sinceVersion = parseSinceVersion(req)
  const store = getStateStore()
  const storeKind = store.getStoreKind()
  const encoder = new TextEncoder()

  let cleanupFn: (() => void) | null = null

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let closed = false
      let lastSentVersion = sinceVersion
      let catchUpDone = false
      const bufferedLive: RealtimeEvent[] = []

      const abortController = new AbortController()
      let unsubscribeLocal: (() => void) | null = null
      let heartbeatTimer: ReturnType<typeof setInterval> | null = null
      let recycleTimer: ReturnType<typeof setTimeout> | null = null
      let prismaPollTimer: ReturnType<typeof setInterval> | null = null
      let upstashReadyTimer: ReturnType<typeof setTimeout> | null = null
      let prismaPollInFlight = false

      const enqueueRaw = (chunk: string) => {
        if (closed) return
        try {
          controller.enqueue(encoder.encode(chunk))
        } catch {
          cleanup()
        }
      }

      const sendEvent = (eventName: string, data: unknown) => {
        enqueueRaw(`event: ${eventName}\ndata: ${JSON.stringify(data)}\n\n`)
      }

      const sendComment = (comment: string) => {
        enqueueRaw(`: ${comment}\n\n`)
      }

      const sendStateEvent = (event: RealtimeEvent) => {
        if (closed) return
        if (event.version <= lastSentVersion) return
        lastSentVersion = event.version
        sendEvent('state', event)
      }

      const onLiveEvent = (event: RealtimeEvent) => {
        if (closed) return
        if (!catchUpDone) {
          bufferedLive.push(event)
          return
        }
        sendStateEvent(event)
      }

      const cleanup = () => {
        if (closed) return
        closed = true

        if (heartbeatTimer) {
          clearInterval(heartbeatTimer)
          heartbeatTimer = null
        }
        if (recycleTimer) {
          clearTimeout(recycleTimer)
          recycleTimer = null
        }
        if (prismaPollTimer) {
          clearInterval(prismaPollTimer)
          prismaPollTimer = null
        }
        if (upstashReadyTimer) {
          clearTimeout(upstashReadyTimer)
          upstashReadyTimer = null
        }
        if (unsubscribeLocal) {
          unsubscribeLocal()
          unsubscribeLocal = null
        }
        if (!abortController.signal.aborted) {
          abortController.abort()
        }
        req.signal?.removeEventListener('abort', cleanup)

        try {
          controller.close()
        } catch {
          // Controller already closed
        }
      }

      cleanupFn = cleanup
      req.signal?.addEventListener('abort', cleanup)
      if (req.signal?.aborted) {
        cleanup()
        return
      }

      // Subscribe BEFORE catch-up query so no events are missed in the gap
      unsubscribeLocal = subscribeLocalEvents(onLiveEvent)
      let upstashReadyPromise: Promise<void> | null = null
      if (storeKind === 'upstash') {
        upstashReadyPromise = new Promise<void>((resolve) => {
          let settled = false
          const settle = () => {
            if (settled) return
            settled = true
            if (upstashReadyTimer) {
              clearTimeout(upstashReadyTimer)
              upstashReadyTimer = null
            }
            resolve()
          }
          upstashReadyTimer = setTimeout(settle, UPSTASH_SUBSCRIBE_READY_TIMEOUT_MS)
          void subscribeUpstashPubSub(onLiveEvent, abortController.signal, {
            onReady: settle,
            onDisconnect: () => {
              settle()
              if (!closed) {
                sendEvent('reconnect', {
                  version: lastSentVersion,
                  serverTime: Date.now(),
                })
                cleanup()
              }
            },
          })
        })
      }

      // Heartbeat & graceful 50s Vercel Fluid Compute stream recycle
      heartbeatTimer = setInterval(() => {
        sendComment('ping')
      }, HEARTBEAT_INTERVAL_MS)

      recycleTimer = setTimeout(() => {
        if (!closed) {
          sendEvent('reconnect', {
            version: lastSentVersion,
            serverTime: Date.now(),
          })
          cleanup()
        }
      }, RECONNECT_RECYCLE_MS)

      // Initial catch-up
      void (async () => {
        try {
          if (upstashReadyPromise) {
            await upstashReadyPromise
            if (closed) return
          }

          const snapshot = await store.getSnapshot()
          if (closed) return

          if (snapshot.version > sinceVersion) {
            const missed = sinceVersion > 0 ? await store.getEventsSince(sinceVersion) : null
            if (closed) return

            if (missed && missed.length > 0) {
              for (const ev of missed) {
                sendStateEvent(ev)
              }
            } else {
              const snapEvent: SnapshotEvent = {
                kind: 'snapshot',
                version: snapshot.version,
                serverTime: snapshot.serverTime,
                mutationId: snapshot.lastMutationId ?? null,
                clientId: null,
                snapshot,
              }
              sendStateEvent(snapEvent)
            }
          } else {
            lastSentVersion = Math.max(lastSentVersion, snapshot.version)
            sendEvent('connected', {
              version: snapshot.version,
              serverTime: snapshot.serverTime,
            })
          }

          catchUpDone = true

          // Flush any live events buffered during catch-up (monotonic deduped)
          if (bufferedLive.length > 0) {
            bufferedLive.sort((a, b) => a.version - b.version)
            for (const ev of bufferedLive) {
              sendStateEvent(ev)
            }
            bufferedLive.length = 0
          }

          // Multi-instance Neon-only fallback: lightweight version check every 500ms
          if (storeKind === 'prisma' && !closed) {
            prismaPollTimer = setInterval(() => {
              if (closed || prismaPollInFlight) return
              prismaPollInFlight = true
              void (async () => {
                try {
                  const row = await prisma.gameState.findUnique({
                    where: { id: 'singleton' },
                    select: { version: true },
                  })
                  if (closed || !row || row.version <= lastSentVersion) return

                  const fresh = await store.getSnapshot()
                  if (closed || fresh.version <= lastSentVersion) return

                  const snapEvent: SnapshotEvent = {
                    kind: 'snapshot',
                    version: fresh.version,
                    serverTime: fresh.serverTime,
                    mutationId: fresh.lastMutationId ?? null,
                    clientId: null,
                    snapshot: fresh,
                  }
                  sendStateEvent(snapEvent)
                } catch (err) {
                  if (!closed) {
                    console.error('[banpick] SSE prisma fallback poll error:', err)
                  }
                } finally {
                  prismaPollInFlight = false
                }
              })()
            }, PRISMA_POLL_INTERVAL_MS)
          }
        } catch (error) {
          if (!closed) {
            console.error('[banpick] SSE initial catch-up error:', error)
            cleanup()
          }
        }
      })()
    },
    cancel() {
      cleanupFn?.()
    },
  })

  return new Response(stream, {
    status: 200,
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  })
}
