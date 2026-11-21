import { NextResponse } from 'next/server'
import { materializeState } from '@/lib/gameEngine'
import { publishRealtimeEvent } from '@/lib/realtime'
import { getStateStore } from '@/lib/stateStore'
import type { GameMutation, MutationErrorResponse, MutationSuccessResponse } from '@/types'

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

export async function POST(req: Request) {
  try {
    let body: Record<string, unknown>
    try {
      body = (await req.json()) as Record<string, unknown>
    } catch {
      return NextResponse.json<MutationErrorResponse>(
        { success: false, error: 'Invalid JSON request body', code: 'INVALID_JSON' },
        { status: 400, headers: NO_STORE_HEADERS }
      )
    }

    const action = typeof body.action === 'string' ? body.action.toUpperCase() : ''
    const targetId =
      typeof body.id === 'string' && body.id.trim() !== ''
        ? body.id
        : typeof body.memberId === 'string' && body.memberId.trim() !== ''
          ? body.memberId
          : undefined

    const mutationId =
      typeof body.mutationId === 'string' && body.mutationId.trim() !== ''
        ? body.mutationId
        : fallbackMutationId()
    const clientId = typeof body.clientId === 'string' ? body.clientId : undefined

    let mutation: GameMutation

    if (action === 'ADD') {
      mutation = {
        type: 'MEMBER_ADD',
        mutationId,
        clientId,
        id: targetId,
        name: typeof body.name === 'string' ? body.name : '',
        info:
          body.info === undefined
            ? ''
            : body.info === null
              ? null
              : String(body.info),
        avatar:
          body.avatar === undefined
            ? undefined
            : body.avatar === null
              ? null
              : String(body.avatar),
        background:
          body.background === undefined
            ? undefined
            : body.background === null
              ? null
              : String(body.background),
      }
    } else if (action === 'UPDATE') {
      if (!targetId) {
        return NextResponse.json<MutationErrorResponse>(
          { success: false, error: 'Member id is required', code: 'MISSING_MEMBER_ID' },
          { status: 400, headers: NO_STORE_HEADERS }
        )
      }
      mutation = {
        type: 'MEMBER_UPDATE',
        mutationId,
        clientId,
        id: targetId,
        name: body.name === undefined ? undefined : String(body.name),
        info:
          body.info === undefined
            ? undefined
            : body.info === null
              ? null
              : String(body.info),
        avatar:
          body.avatar === undefined
            ? undefined
            : body.avatar === null
              ? null
              : String(body.avatar),
        background:
          body.background === undefined
            ? undefined
            : body.background === null
              ? null
              : String(body.background),
      }
    } else if (action === 'DELETE') {
      if (!targetId) {
        return NextResponse.json<MutationErrorResponse>(
          { success: false, error: 'Member id is required', code: 'MISSING_MEMBER_ID' },
          { status: 400, headers: NO_STORE_HEADERS }
        )
      }
      mutation = {
        type: 'MEMBER_DELETE',
        mutationId,
        clientId,
        id: targetId,
      }
    } else {
      return NextResponse.json<MutationErrorResponse>(
        { success: false, error: 'Invalid member action', code: 'INVALID_ACTION' },
        { status: 400, headers: NO_STORE_HEADERS }
      )
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
  } catch (error: unknown) {
    console.error('API Members Error:', error)
    const message = error instanceof Error ? error.message : 'Failed to manage members'
    return NextResponse.json<MutationErrorResponse>(
      { success: false, error: message || 'Failed to manage members' },
      { status: 500, headers: NO_STORE_HEADERS }
    )
  }
}
