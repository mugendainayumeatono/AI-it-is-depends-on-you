'use client'

import { useCallback, useMemo, useState } from 'react'
import {
  DndContext,
  DragEndEvent,
  DragOverlay,
  DragStartEvent,
  closestCenter,
} from '@dnd-kit/core'
import { Shuffle, Settings } from 'lucide-react'
import { applyMutation, materializeState, normalizeState } from '@/lib/gameEngine'
import type { DispatchMutationInput, DispatchMutationResult } from '@/hooks/useGameState'
import type { GameData, GameMutation, GameState, Member, Team } from '@/types'
import DroppableTeam from './DroppableTeam'
import DraggableMember from './DraggableMember'
import Timer from './Timer'

interface Props {
  gameState: GameState
  teams: Team[]
  members: Member[]
  serverOffset: number
  mutate?: (data?: GameData | Record<string, unknown>, opts?: { revalidate?: boolean }) => void
  dispatchMutation?: (mutation: DispatchMutationInput) => Promise<DispatchMutationResult>
  setShowConfig: (show: boolean) => void
}

function generateFallbackMutationId(): string {
  if (typeof globalThis.crypto !== 'undefined' && typeof globalThis.crypto.randomUUID === 'function') {
    return globalThis.crypto.randomUUID()
  }
  return `mut_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`
}

export default function Board({
  gameState,
  teams,
  members,
  serverOffset,
  mutate,
  dispatchMutation,
  setShowConfig,
}: Props) {
  const [activeId, setActiveId] = useState<string | null>(null)
  const currentTeam = teams[gameState.currentTeamIndex]
  const currentTeamId = currentTeam?.id

  const unpickedMembers = useMemo(
    () => members.filter((m) => !m.teamId && !m.isBanned),
    [members]
  )
  const hasUnpicked = unpickedMembers.length > 0

  const dispatch = useCallback(
    async (input: DispatchMutationInput): Promise<DispatchMutationResult> => {
      if (dispatchMutation) {
        return dispatchMutation(input)
      }

      // Standalone fallback when mounted without useGameState.dispatchMutation
      const mutationId = input.mutationId || generateFallbackMutationId()
      const fullMutation = { ...input, mutationId } as GameMutation
      const nowMs = Date.now() + serverOffset
      const snapshot = normalizeState({
        version: gameState.version ?? 1,
        serverTime: nowMs,
        gameState: { ...gameState, version: gameState.version ?? 1 },
        teams,
        members,
      })

      const optimistic = applyMutation(snapshot, fullMutation, {
        nowMs,
        isOptimistic: true,
      })
      if (optimistic.ok && mutate) {
        mutate(materializeState(optimistic.next), { revalidate: false })
      }

      let url = '/api/pick'
      let body: Record<string, unknown> = {}
      switch (fullMutation.type) {
        case 'START':
          url = '/api/pick'
          body = { status: 'START', mutationId }
          break
        case 'PICK':
          url = '/api/pick'
          body = {
            memberId: fullMutation.memberId,
            teamId: fullMutation.teamId,
            mutationId,
            expectedVersion: fullMutation.expectedVersion,
          }
          break
        case 'AUTO_PICK':
          url = '/api/pick'
          body = {
            memberId: null,
            teamId: fullMutation.teamId,
            action: 'AUTO_PICK',
            mutationId,
            expectedVersion: fullMutation.expectedVersion,
          }
          break
        case 'RANDOMIZE':
          url = '/api/randomize'
          body = { mutationId }
          break
        case 'CONFIG':
          url = '/api/config'
          body = {
            teamCount: fullMutation.teamCount,
            turnDuration: fullMutation.turnDuration,
            totalReserveTime: fullMutation.totalReserveTime,
            teamNames: fullMutation.teamNames,
            mutationId,
          }
          break
        default:
          return { ok: false, error: 'Unsupported board mutation' }
      }

      try {
        const res = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        })
        if (!res.ok) {
          mutate?.()
          return { ok: false, error: `HTTP ${res.status}` }
        }
        const data = (await res.json()) as Record<string, unknown>
        if (data && data.gameState && mutate) {
          mutate(data, { revalidate: false })
        }
        return { ok: true }
      } catch (err) {
        mutate?.()
        return {
          ok: false,
          error: err instanceof Error ? err.message : 'Network error',
        }
      }
    },
    [dispatchMutation, gameState, members, mutate, serverOffset, teams]
  )

  const handleDragStart = useCallback((event: DragStartEvent) => {
    setActiveId(String(event.active.id))
  }, [])

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      const { active, over } = event
      setActiveId(null)

      if (over && currentTeamId && over.id === currentTeamId) {
        void dispatch({
          type: 'PICK',
          memberId: String(active.id),
          teamId: String(over.id),
        })
      }
    },
    [currentTeamId, dispatch]
  )

  const handleAutoPick = useCallback(() => {
    if (!hasUnpicked || !currentTeamId) return
    void dispatch({
      type: 'AUTO_PICK',
      teamId: currentTeamId,
      expectedVersion: gameState.version,
    })
  }, [currentTeamId, dispatch, gameState.version, hasUnpicked])

  const handleRandomize = useCallback(() => {
    if (!confirm('Randomly assign all remaining members?')) return
    void dispatch({ type: 'RANDOMIZE' })
  }, [dispatch])

  const handleStart = useCallback(() => {
    void dispatch({ type: 'START' })
  }, [dispatch])

  const handleReset = useCallback(() => {
    if (!confirm('Reset game to configuration phase and unpick all members?')) return
    void dispatch({
      type: 'CONFIG',
      teamCount: gameState.teamCount,
      turnDuration: gameState.turnDuration,
      totalReserveTime: gameState.totalReserveTime,
      teamNames: teams.map((t) => t.name),
    })
  }, [dispatch, gameState.teamCount, gameState.totalReserveTime, gameState.turnDuration, teams])

  const activeMember = useMemo(
    () => (activeId ? members.find((m) => m.id === activeId) : undefined),
    [activeId, members]
  )

  return (
    <DndContext
      collisionDetection={closestCenter}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
    >
      <div className="min-h-screen p-8 flex flex-col gap-8 text-gray-200">
        <header className="flex justify-between items-center bg-gray-800/80 p-4 rounded-2xl backdrop-blur-md border border-gray-700 shadow-lg">
          <div className="flex flex-col gap-2">
            <div className="flex gap-4">
              <button
                onClick={() => setShowConfig(true)}
                className="flex items-center gap-2 bg-gray-700 text-white px-4 py-2 rounded hover:bg-gray-600 transition font-medium border border-gray-600"
              >
                <Settings size={18} /> Configuration
              </button>
              <button
                onClick={handleRandomize}
                className="flex items-center gap-2 bg-yellow-600/90 text-white px-4 py-2 rounded hover:bg-yellow-500 transition font-medium shadow"
              >
                <Shuffle size={18} /> Random Teams
              </button>
              {gameState.status === 'CONFIGURING' && (
                <button
                  onClick={handleStart}
                  disabled={members.length === 0 || teams.length === 0}
                  className="flex items-center gap-2 bg-indigo-600 text-white px-4 py-2 rounded hover:bg-indigo-500 transition font-medium shadow disabled:bg-gray-600 disabled:text-gray-400 disabled:cursor-not-allowed"
                >
                  Start Picking
                </button>
              )}
              {(gameState.status === 'PICKING' || gameState.status === 'COMPLETED') && (
                <button
                  onClick={handleReset}
                  className="flex items-center gap-2 bg-red-900/50 text-red-400 border border-red-800 px-4 py-2 rounded hover:bg-red-900/80 transition font-medium shadow"
                >
                  Reset Draft
                </button>
              )}
            </div>
          </div>
          {gameState.status === 'PICKING' && currentTeam && (
            <Timer
              gameState={gameState}
              currentTeam={currentTeam}
              serverOffset={serverOffset}
              onAutoPick={handleAutoPick}
            />
          )}
          {gameState.status === 'COMPLETED' && (
            <div className="text-gray-300 px-8 py-4 border-2 border-gray-600 rounded-xl shadow-lg">
              <p className="text-2xl font-bold uppercase tracking-wider">Draft Completed</p>
            </div>
          )}
          <div className="w-[300px]" /> {/* Spacer to balance flex-between if Timer is center */}
        </header>

        <div className="flex flex-col lg:flex-row gap-8 flex-1">
          {/* Unpicked Members Pool */}
          <div className="w-full lg:w-1/3 bg-gray-800/80 p-6 rounded-2xl shadow-xl border border-gray-700 space-y-4 backdrop-blur-sm">
            <h3 className="text-xl font-bold text-gray-200 border-b border-gray-700 pb-2">
              Available Members ({unpickedMembers.length})
            </h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 overflow-y-auto max-h-[70vh] pr-2 custom-scrollbar">
              {unpickedMembers.map((member) => (
                <DraggableMember
                  key={member.id}
                  member={member}
                  disabled={gameState.status !== 'PICKING'}
                />
              ))}
            </div>
            {unpickedMembers.length === 0 && gameState.status === 'PICKING' && (
              <p className="text-center text-gray-500 py-10">All members have been picked!</p>
            )}
            {gameState.status === 'CONFIGURING' && (
              <div className="text-center text-gray-400 py-10 flex flex-col items-center gap-4">
                <p>Game is in configuration mode.</p>
                <p className="text-sm">Click &quot;Start Picking&quot; to begin drafting.</p>
              </div>
            )}
          </div>

          {/* Teams Grid */}
          <div className="flex-1 grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
            {teams.map((team, idx) => (
              <DroppableTeam
                key={team.id}
                team={team}
                isCurrentTurn={gameState.status === 'PICKING' && gameState.currentTeamIndex === idx}
              />
            ))}
          </div>
        </div>
      </div>

      <DragOverlay>
        {activeMember ? (
          <div className="rounded-lg shadow-2xl scale-110 opacity-90 cursor-grabbing relative overflow-hidden">
            <DraggableMember member={activeMember} disabled={true} isOverlay={true} />
          </div>
        ) : null}
      </DragOverlay>
    </DndContext>
  )
}
