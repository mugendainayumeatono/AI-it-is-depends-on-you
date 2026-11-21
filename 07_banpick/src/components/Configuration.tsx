'use client'

import { useCallback, useMemo, useState } from 'react'
import { Plus, Trash2, Save, Upload, Pencil, X } from 'lucide-react'
import { parseNonNegativeInt } from '@/lib/gameEngine'
import type { DispatchMutationInput, DispatchMutationResult } from '@/hooks/useGameState'
import type { GameData, GameState, Member, Team } from '@/types'

interface Props {
  gameState: GameState
  teams: Team[]
  members: Member[]
  mutate?: (data?: GameData | Record<string, unknown>, opts?: { revalidate?: boolean }) => void
  dispatchMutation?: (mutation: DispatchMutationInput) => Promise<DispatchMutationResult>
  onClose?: () => void
}

interface ConfigDraft {
  baseKey: string
  dirty: boolean
  teamCount: number
  turnDuration: number
  totalReserveTime: number
  teamNames: string[]
}

function generateClientUuid(): string {
  if (typeof globalThis.crypto !== 'undefined' && typeof globalThis.crypto.randomUUID === 'function') {
    return globalThis.crypto.randomUUID()
  }
  return `mem_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`
}

export default function Configuration({
  gameState,
  teams,
  members,
  mutate,
  dispatchMutation,
  onClose,
}: Props) {
  const remoteTeamNames = useMemo(() => teams.map((t) => t.name), [teams])
  const remoteConfigKey = `${gameState.teamCount}|${gameState.turnDuration}|${gameState.totalReserveTime}|${remoteTeamNames.join('\u0000')}`

  const [draftConfig, setDraftConfig] = useState<ConfigDraft | null>(null)

  const activeDraft =
    draftConfig && (draftConfig.dirty || draftConfig.baseKey === remoteConfigKey)
      ? draftConfig
      : null

  const teamCount = activeDraft ? activeDraft.teamCount : gameState.teamCount
  const turnDuration = activeDraft ? activeDraft.turnDuration : gameState.turnDuration
  const totalReserveTime = activeDraft ? activeDraft.totalReserveTime : gameState.totalReserveTime
  const teamNames = activeDraft ? activeDraft.teamNames : remoteTeamNames

  const [newMemberName, setNewMemberName] = useState('')
  const [newMemberInfo, setNewMemberInfo] = useState('')
  const [newMemberAvatar, setNewMemberAvatar] = useState<string | null>(null)
  const [newMemberBackground, setNewMemberBackground] = useState<string | null>(null)
  const [editingMemberId, setEditingMemberId] = useState<string | null>(null)

  const updateDraft = useCallback(
    (updater: (current: ConfigDraft) => Partial<ConfigDraft>) => {
      setDraftConfig((prev) => {
        const base: ConfigDraft =
          prev && (prev.dirty || prev.baseKey === remoteConfigKey)
            ? prev
            : {
                baseKey: remoteConfigKey,
                dirty: false,
                teamCount: gameState.teamCount,
                turnDuration: gameState.turnDuration,
                totalReserveTime: gameState.totalReserveTime,
                teamNames: remoteTeamNames,
              }
        return {
          ...base,
          ...updater(base),
          baseKey: remoteConfigKey,
          dirty: true,
        }
      })
    },
    [
      gameState.teamCount,
      gameState.totalReserveTime,
      gameState.turnDuration,
      remoteConfigKey,
      remoteTeamNames,
    ]
  )

  const dispatch = useCallback(
    async (input: DispatchMutationInput): Promise<DispatchMutationResult> => {
      if (dispatchMutation) {
        return dispatchMutation(input)
      }

      // Standalone fallback when mounted without useGameState.dispatchMutation
      try {
        if (input.type === 'CONFIG') {
          const res = await fetch('/api/config', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              teamCount: input.teamCount,
              turnDuration: input.turnDuration,
              totalReserveTime: input.totalReserveTime,
              teamNames: input.teamNames,
            }),
          })
          if (!res.ok) {
            const errJson = (await res.json().catch(() => ({}))) as { error?: string }
            return { ok: false, error: errJson.error || 'Failed to save configuration' }
          }
          mutate?.()
          return { ok: true }
        }

        if (input.type === 'MEMBER_ADD') {
          const res = await fetch('/api/members', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              action: 'ADD',
              id: input.id,
              memberId: null,
              name: input.name,
              info: input.info ?? '',
              avatar: input.avatar ?? null,
              background: input.background ?? null,
            }),
          })
          if (!res.ok) {
            const errJson = (await res.json().catch(() => ({}))) as { error?: string }
            return { ok: false, error: errJson.error || 'Failed to save member' }
          }
          mutate?.()
          return { ok: true }
        }

        if (input.type === 'MEMBER_UPDATE') {
          const res = await fetch('/api/members', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              action: 'UPDATE',
              id: input.id,
              memberId: input.id,
              name: input.name,
              info: input.info,
              avatar: input.avatar,
              background: input.background,
            }),
          })
          if (!res.ok) {
            const errJson = (await res.json().catch(() => ({}))) as { error?: string }
            return { ok: false, error: errJson.error || 'Failed to save member' }
          }
          mutate?.()
          return { ok: true }
        }

        if (input.type === 'MEMBER_DELETE') {
          const res = await fetch('/api/members', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              action: 'DELETE',
              id: input.id,
              memberId: input.id,
            }),
          })
          if (!res.ok) {
            const errJson = (await res.json().catch(() => ({}))) as { error?: string }
            return { ok: false, error: errJson.error || 'Failed to delete member' }
          }
          mutate?.()
          return { ok: true }
        }

        return { ok: false, error: 'Unsupported configuration mutation' }
      } catch (e: unknown) {
        return {
          ok: false,
          error: e instanceof Error ? e.message : 'An error occurred while saving.',
        }
      }
    },
    [dispatchMutation, mutate]
  )

  const handleFileChange = (
    e: React.ChangeEvent<HTMLInputElement>,
    setter: (val: string | null) => void
  ) => {
    const file = e.target.files?.[0]
    if (!file) return

    const reader = new FileReader()
    reader.onload = (event) => {
      const img = new Image()
      img.onload = () => {
        const canvas = document.createElement('canvas')
        const MAX_DIMENSION = 400
        let width = img.width
        let height = img.height

        if (width > height && width > MAX_DIMENSION) {
          height *= MAX_DIMENSION / width
          width = MAX_DIMENSION
        } else if (height > MAX_DIMENSION) {
          width *= MAX_DIMENSION / height
          height = MAX_DIMENSION
        }

        canvas.width = width
        canvas.height = height
        const ctx = canvas.getContext('2d')
        if (ctx) {
          ctx.drawImage(img, 0, 0, width, height)
          const compressedBase64 = canvas.toDataURL('image/jpeg', 0.8)
          setter(compressedBase64)
        } else {
          setter(event.target?.result as string)
        }
      }
      img.src = event.target?.result as string
    }
    reader.readAsDataURL(file)
  }

  const handleSaveConfig = async () => {
    const safeTeamCount = parseNonNegativeInt(teamCount, 2, 1)
    const safeTurnDuration = parseNonNegativeInt(turnDuration, 30, 0)
    const safeTotalReserveTime = parseNonNegativeInt(totalReserveTime, 120, 0)
    const normalizedNames = Array.from({ length: safeTeamCount }, (_, i) =>
      teamNames[i] && teamNames[i].trim() !== '' ? teamNames[i] : `Team ${i + 1}`
    )

    // Clear dirty flag immediately so optimistic/confirmed config reflects live
    setDraftConfig(null)

    const result = await dispatch({
      type: 'CONFIG',
      teamCount: safeTeamCount,
      turnDuration: safeTurnDuration,
      totalReserveTime: safeTotalReserveTime,
      teamNames: normalizedNames,
    })
    if (!result.ok) {
      alert(result.error || 'Failed to save configuration.')
    }
  }

  const cancelEdit = () => {
    setEditingMemberId(null)
    setNewMemberName('')
    setNewMemberInfo('')
    setNewMemberAvatar(null)
    setNewMemberBackground(null)
  }

  const handleSubmitMember = async () => {
    if (!newMemberName.trim()) {
      alert('Please enter a name for the member.')
      return
    }

    const mutation: DispatchMutationInput = editingMemberId
      ? {
          type: 'MEMBER_UPDATE',
          id: editingMemberId,
          name: newMemberName,
          info: newMemberInfo,
          avatar: newMemberAvatar,
          background: newMemberBackground,
        }
      : {
          type: 'MEMBER_ADD',
          id: generateClientUuid(),
          name: newMemberName,
          info: newMemberInfo,
          avatar: newMemberAvatar,
          background: newMemberBackground,
        }

    // Optimistic update happens synchronously inside dispatchMutation; clear form immediately
    const promise = dispatch(mutation)
    cancelEdit()

    const result = await promise
    if (!result.ok) {
      alert(result.error || 'An error occurred while saving the member.')
    }
  }

  const handleEditClick = (m: Member) => {
    setEditingMemberId(m.id)
    setNewMemberName(m.name)
    setNewMemberInfo(m.info || '')
    setNewMemberAvatar(m.avatar)
    setNewMemberBackground(m.background)
  }

  const handleDeleteMember = (id: string) => {
    if (editingMemberId === id) cancelEdit()
    void dispatch({ type: 'MEMBER_DELETE', id })
  }

  const handleClose = () => {
    if (onClose) onClose()
  }

  return (
    <div className="max-w-4xl mx-auto p-6 space-y-8 bg-gray-800 shadow-2xl rounded-xl border border-gray-700 text-gray-200">
      <h1 className="text-3xl font-bold text-gray-100 border-b border-gray-700 pb-4">
        Configuration
      </h1>

      <section className="space-y-4">
        <h2 className="text-xl font-semibold text-gray-300">Settings</h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="flex flex-col">
            <label className="text-sm text-gray-400 mb-1">Team Count</label>
            <input
              type="number"
              min={1}
              value={teamCount}
              onChange={(e) => {
                const count = parseNonNegativeInt(e.target.value, 1, 1)
                updateDraft((prev) => {
                  const next = [...prev.teamNames]
                  while (next.length < count) next.push(`Team ${next.length + 1}`)
                  return {
                    teamCount: count,
                    teamNames: next.slice(0, count),
                  }
                })
              }}
              className="border border-gray-600 bg-gray-700 rounded p-2 text-white"
            />
          </div>
          <div className="flex flex-col">
            <label className="text-sm text-gray-400 mb-1">Turn Duration (s)</label>
            <input
              type="number"
              min={0}
              value={turnDuration}
              onChange={(e) => {
                const duration = parseNonNegativeInt(e.target.value, 0, 0)
                updateDraft(() => ({ turnDuration: duration }))
              }}
              className="border border-gray-600 bg-gray-700 rounded p-2 text-white"
            />
          </div>
          <div className="flex flex-col">
            <label className="text-sm text-gray-400 mb-1">Reserve Time (s)</label>
            <input
              type="number"
              min={0}
              value={totalReserveTime}
              onChange={(e) => {
                const reserve = parseNonNegativeInt(e.target.value, 0, 0)
                updateDraft(() => ({ totalReserveTime: reserve }))
              }}
              className="border border-gray-600 bg-gray-700 rounded p-2 text-white"
            />
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4">
          {teamNames.map((name, i) => (
            <div key={i} className="flex flex-col">
              <label className="text-sm text-gray-400 mb-1">Team {i + 1} Name</label>
              <input
                type="text"
                value={name}
                onChange={(e) => {
                  const nextValue = e.target.value
                  updateDraft((prev) => {
                    const next = [...prev.teamNames]
                    next[i] = nextValue
                    return { teamNames: next }
                  })
                }}
                className="border border-gray-600 bg-gray-700 rounded p-2 text-white"
              />
            </div>
          ))}
        </div>

        <button
          onClick={handleSaveConfig}
          className="flex items-center gap-2 bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700 transition"
        >
          <Save size={18} /> Save Settings &amp; Reset Game
        </button>
      </section>

      <section className="space-y-4 border-t border-gray-700 pt-6">
        <h2 className="text-xl font-semibold text-gray-300">Members ({members.length})</h2>
        <div
          className={`flex flex-wrap gap-4 items-start bg-gray-900/50 border ${
            editingMemberId
              ? 'border-indigo-500 shadow-[0_0_10px_rgba(79,70,229,0.2)]'
              : 'border-gray-700'
          } p-4 rounded transition-all`}
        >
          <div className="flex flex-col">
            <label className="text-sm text-gray-400 mb-1">Name</label>
            <input
              type="text"
              value={newMemberName}
              onChange={(e) => setNewMemberName(e.target.value)}
              className="border border-gray-600 bg-gray-700 rounded p-2 w-48 text-white"
              placeholder="Name"
            />
          </div>
          <div className="flex flex-col flex-1">
            <label className="text-sm text-gray-400 mb-1">Info (Optional)</label>
            <textarea
              value={newMemberInfo}
              onChange={(e) => setNewMemberInfo(e.target.value)}
              className="border border-gray-600 bg-gray-700 rounded p-2 w-full text-white min-h-[42px]"
              placeholder="Multiline description..."
              rows={3}
            />
          </div>

          <div className="flex flex-col gap-2 w-full sm:w-auto mt-2 sm:mt-0">
            <div className="flex gap-2">
              <label className="flex flex-col items-center justify-center border border-dashed border-gray-500 rounded p-2 cursor-pointer hover:bg-gray-700 w-24 h-24 relative overflow-hidden">
                {newMemberAvatar ? (
                  <img
                    src={newMemberAvatar}
                    alt="Avatar preview"
                    className="absolute inset-0 w-full h-full object-cover"
                  />
                ) : (
                  <>
                    <Upload size={16} className="text-gray-400" />{' '}
                    <span className="text-xs text-gray-400 mt-1">Avatar</span>
                  </>
                )}
                <input
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={(e) => handleFileChange(e, setNewMemberAvatar)}
                />
              </label>
              <label className="flex flex-col items-center justify-center border border-dashed border-gray-500 rounded p-2 cursor-pointer hover:bg-gray-700 w-32 h-24 relative overflow-hidden">
                {newMemberBackground ? (
                  <img
                    src={newMemberBackground}
                    alt="Background preview"
                    className="absolute inset-0 w-full h-full object-cover"
                  />
                ) : (
                  <>
                    <Upload size={16} className="text-gray-400" />{' '}
                    <span className="text-xs text-gray-400 mt-1">Background</span>
                  </>
                )}
                <input
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={(e) => handleFileChange(e, setNewMemberBackground)}
                />
              </label>
            </div>
            <div className="flex gap-2">
              <button
                onClick={handleSubmitMember}
                className="flex-1 flex items-center justify-center gap-2 bg-green-600 text-white px-4 py-2 rounded hover:bg-green-700 transition"
              >
                {editingMemberId ? <Save size={18} /> : <Plus size={18} />}
                {editingMemberId ? 'Update' : 'Add'}
              </button>
              {editingMemberId && (
                <button
                  onClick={cancelEdit}
                  className="flex items-center justify-center gap-1 bg-gray-600 text-white px-3 py-2 rounded hover:bg-gray-500 transition"
                  title="Cancel Edit"
                >
                  <X size={18} />
                </button>
              )}
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          {members.map((m) => (
            <div
              key={m.id}
              className="flex justify-between items-center p-3 bg-gray-700 border border-gray-600 rounded hover:border-gray-500 transition relative overflow-hidden group"
            >
              {m.background && (
                <img
                  src={m.background}
                  alt=""
                  className="absolute inset-0 w-full h-full object-cover opacity-20 pointer-events-none"
                />
              )}
              <div className="flex items-center gap-3 relative z-10">
                {m.avatar && (
                  <img
                    src={m.avatar}
                    alt={m.name}
                    className="w-10 h-10 rounded-full object-cover border border-gray-500"
                  />
                )}
                <div>
                  <p className="font-medium text-white">{m.name}</p>
                  <p className="text-xs text-gray-400 whitespace-pre-wrap">{m.info}</p>
                </div>
              </div>
              <div className="relative z-10 flex gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                <button
                  onClick={() => handleEditClick(m)}
                  className="text-blue-400 hover:text-blue-300 bg-gray-800 p-1.5 rounded-md"
                >
                  <Pencil size={16} />
                </button>
                <button
                  onClick={() => handleDeleteMember(m.id)}
                  className="text-red-400 hover:text-red-300 bg-gray-800 p-1.5 rounded-md"
                >
                  <Trash2 size={16} />
                </button>
              </div>
            </div>
          ))}
        </div>
      </section>

      <div className="border-t border-gray-700 pt-8 flex justify-center">
        <button
          onClick={handleClose}
          className="flex items-center gap-2 bg-gray-600 text-white px-8 py-3 rounded-full font-bold text-lg hover:bg-gray-500 transition"
        >
          Back to Board
        </button>
      </div>
    </div>
  )
}
