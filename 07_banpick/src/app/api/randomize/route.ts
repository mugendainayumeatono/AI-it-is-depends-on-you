import { NextResponse } from 'next/server'
import { materializeState } from '@/lib/gameEngine'
import { publishRealtimeEvent } from '@/lib/realtime'
import { getStateStore } from '@/lib/stateStore'
import type { MutationErrorResponse, MutationSuccessResponse, RandomizeMutation } from '@/types'

export const dynamic = 'force-dynamic'
export const preferredRegion = 'hnd1'

const NO_STORE_HEADERS = {
  'Cache-Control': 'no-store',
} as const

function fallbackMutationId(): string {
  if (typeof globalThis.crypto !== 'undefined' && typeof globalThis.crypto.randomUUID === 'function') {
    return globalThis.crypto.randomUUID()
  }
  return `mut_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`
}

export async function POST(req?: Request) {
  try {
    let body: Record<string, unknown> = {}
    if (req) {
      const rawText = await req.text()
      if (rawText.trim() !== '') {
        try {
          body = JSON.parse(rawText) as Record<string, unknown>
        } catch {
          return NextResponse.json<MutationErrorResponse>(
            { success: false, error: 'Invalid JSON request body', code: 'INVALID_JSON' },
            { status: 400, headers: NO_STORE_HEADERS }
          )
        }
      }
    }

    const mutationId =
      typeof body.mutationId === 'string' && body.mutationId.trim() !== ''
        ? body.mutationId
        : fallbackMutationId()
    const clientId = typeof body.clientId === 'string' ? body.clientId : undefined
    const expectedVersion =
      typeof body.expectedVersion === 'number' && Number.isFinite(body.expectedVersion)
        ? body.expectedVersion
        : undefined
    const shuffledMemberIds = Array.isArray(body.shuffledMemberIds)
      ? body.shuffledMemberIds.filter((id): id is string => typeof id === 'string')
      : undefined

    const mutation: RandomizeMutation = {
      type: 'RANDOMIZE',
      mutationId,
      clientId,
      expectedVersion,
      shuffledMemberIds,
    }

    const result = await getStateStore().mutate(mutation)
    const materialized = materializeState(result.snapshot)

    if (!result.ok) {
      const errorPayload: MutationErrorResponse = {
        success: false,
        error: result.error,
        code: result.code,
        version: materialized.version,
        serverTime: materialized.serverTime,
        gameState: materialized.gameState,
        teams: materialized.teams,
        members: materialized.members,
      }
      return NextResponse.json(errorPayload, {
        status: result.status,
        headers: NO_STORE_HEADERS,
      })
    }

    if (!result.alreadyApplied) {
      publishRealtimeEvent(result.event, {
        skipRedisPublish: result.publishedToRedis ?? true,
      })
    }

    const successPayload: MutationSuccessResponse = {
      success: true,
      version: materialized.version,
      serverTime: materialized.serverTime,
      lastMutationId: materialized.lastMutationId,
      alreadyApplied: result.alreadyApplied,
      gameState: materialized.gameState,
      teams: materialized.teams,
      members: materialized.members,
    }

    return NextResponse.json(successPayload, { headers: NO_STORE_HEADERS })
  } catch (error) {
    console.error('POST /api/randomize error:', error)
    return NextResponse.json<MutationErrorResponse>(
      { success: false, error: 'Failed to randomize' },
      { status: 500, headers: NO_STORE_HEADERS }
    )
  }
}
