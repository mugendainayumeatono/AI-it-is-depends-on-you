import { NextResponse } from 'next/server'
import { materializeState } from '@/lib/gameEngine'
import { shouldTriggerPusher, warmPusherConnection } from '@/lib/pusher'
import { scheduleAfter } from '@/lib/realtime'
import { getStateStore } from '@/lib/stateStore'

export const dynamic = 'force-dynamic'
export const preferredRegion = 'hnd1'

const NO_STORE_HEADERS = {
  'Cache-Control': 'no-store',
} as const

function parseSinceVersion(req?: Request): number | null {
  if (!req?.url) return null
  try {
    const url = new URL(req.url)
    const raw = url.searchParams.get('sinceVersion')
    if (raw === null || raw.trim() === '') return null
    const parsed = Number.parseInt(raw, 10)
    if (!Number.isFinite(parsed) || parsed < 0) return null
    return parsed
  } catch {
    return null
  }
}

export async function GET(req?: Request) {
  try {
    if (shouldTriggerPusher()) {
      scheduleAfter(() => warmPusherConnection())
    }

    const sinceVersion = parseSinceVersion(req)
    const store = getStateStore()

    if (sinceVersion !== null && store.getCurrentVersion) {
      const currentVersion = await store.getCurrentVersion()
      if (currentVersion <= sinceVersion) {
        return NextResponse.json(
          {
            unchanged: true,
            version: currentVersion,
            serverTime: Date.now(),
          },
          { headers: NO_STORE_HEADERS }
        )
      }
    }

    const snapshot = await store.getSnapshot()
    if (sinceVersion !== null && snapshot.version <= sinceVersion) {
      return NextResponse.json(
        {
          unchanged: true,
          version: snapshot.version,
          serverTime: snapshot.serverTime,
        },
        { headers: NO_STORE_HEADERS }
      )
    }

    const fullState = materializeState(snapshot)
    return NextResponse.json(fullState, { headers: NO_STORE_HEADERS })
  } catch (error) {
    console.error('GET /api/state error:', error)
    return NextResponse.json(
      { error: 'Failed to fetch state' },
      { status: 500, headers: NO_STORE_HEADERS }
    )
  }
}
