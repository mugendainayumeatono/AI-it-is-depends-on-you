import { describe, it, expect } from 'vitest'
import {
  applyMutation,
  applyRealtimeEvent,
  buildMediaUrl,
  createDefaultSnapshot,
  fisherYatesShuffle,
  isInlineDataUrl,
  isMediaProxyUrl,
  materializeState,
  normalizeState,
  parseNonNegativeInt,
} from '@/lib/gameEngine'
import type { NormalizedGameSnapshot, StateDelta } from '@/types'

function makeBaseSnapshot(nowMs = 1_700_000_000_000): NormalizedGameSnapshot {
  const snap = createDefaultSnapshot(nowMs)
  return {
    ...snap,
    version: 1,
    serverTime: nowMs,
    teams: [
      { id: 't2', name: 'Dire', order: 1, reserveTime: 60 },
      { id: 't1', name: 'Radiant', order: 0, reserveTime: 60 },
    ],
    members: [
      {
        id: 'm3',
        name: 'Charlie',
        info: 'Support',
        avatar: null,
        background: null,
        teamId: null,
        isBanned: false,
        pickedAt: null,
        mediaVersion: 0,
      },
      {
        id: 'm1',
        name: 'Alice',
        info: 'Carry',
        avatar: null,
        background: null,
        teamId: null,
        isBanned: false,
        pickedAt: null,
        mediaVersion: 0,
      },
      {
        id: 'm2',
        name: 'Bob',
        info: 'Mid',
        avatar: null,
        background: null,
        teamId: null,
        isBanned: false,
        pickedAt: null,
        mediaVersion: 0,
      },
    ],
  }
}

describe('Pure Game Engine (src/lib/gameEngine.ts)', () => {
  describe('helpers & normalization', () => {
    it('parseNonNegativeInt preserves explicit 0 and handles invalid inputs safely', () => {
      expect(parseNonNegativeInt(0, 120, 0)).toBe(0)
      expect(parseNonNegativeInt('0', 120, 0)).toBe(0)
      expect(parseNonNegativeInt(45.9, 30, 0)).toBe(45)
      expect(parseNonNegativeInt('15', 30, 1)).toBe(15)
      expect(parseNonNegativeInt(-5, 120, 0)).toBe(120)
      expect(parseNonNegativeInt(0, 2, 1)).toBe(2)
      expect(parseNonNegativeInt('', 120, 0)).toBe(120)
      expect(parseNonNegativeInt(Number.NaN, 30, 0)).toBe(30)
      expect(parseNonNegativeInt(undefined, 120, 0)).toBe(120)
    })

    it('media URL helpers classify data URLs and proxy URLs accurately', () => {
      const url = buildMediaUrl('member 1/a', 'avatar', 3)
      expect(url).toBe('/api/members/member%201%2Fa/media?field=avatar&v=3')
      expect(isMediaProxyUrl(url)).toBe(true)
      expect(isInlineDataUrl(url)).toBe(false)
      expect(isInlineDataUrl('data:image/jpeg;base64,abc')).toBe(true)
      expect(isMediaProxyUrl('data:image/jpeg;base64,abc')).toBe(false)
      expect(isInlineDataUrl(null)).toBe(false)
      expect(isMediaProxyUrl(undefined)).toBe(false)
    })

    it('fisherYatesShuffle does not mutate input and produces deterministic permutations with custom rng', () => {
      const input = ['a', 'b', 'c', 'd', 'e']
      const vals = [0.1, 0.9, 0.2, 0.7]
      let idx = 0
      const shuffled = fisherYatesShuffle(input, () => vals[idx++ % vals.length])

      expect(input).toEqual(['a', 'b', 'c', 'd', 'e'])
      expect([...shuffled].sort()).toEqual(['a', 'b', 'c', 'd', 'e'])
      expect(shuffled).not.toEqual(input)
    })

    it('materializeState sorts teams by order ASC, members by name ASC, and team members by pickedAt ASC', () => {
      const snap = makeBaseSnapshot()
      snap.members[0].teamId = 't1'
      snap.members[0].pickedAt = '2026-04-08T12:00:05.000Z' // Charlie picked second
      snap.members[1].teamId = 't1'
      snap.members[1].pickedAt = '2026-04-08T12:00:01.000Z' // Alice picked first

      const full = materializeState(snap)
      expect(full.teams.map((t) => t.id)).toEqual(['t1', 't2'])
      expect(full.members.map((m) => m.name)).toEqual(['Alice', 'Bob', 'Charlie'])
      expect(full.teams[0].members.map((m) => m.name)).toEqual(['Alice', 'Charlie'])

      const roundTripped = normalizeState(full)
      expect(roundTripped.version).toBe(snap.version)
      expect(roundTripped.teams.map((t) => t.id)).toEqual(['t1', 't2'])
      expect(roundTripped.members.map((m) => m.name)).toEqual(['Alice', 'Bob', 'Charlie'])
    })
  })

  describe('all 8 mutations via applyMutation', () => {
    it('START transitions CONFIGURING -> PICKING and is idempotent on stale expectedVersion', () => {
      const t0 = 1_700_000_000_000
      const base = makeBaseSnapshot(t0)

      const res = applyMutation(
        base,
        { type: 'START', mutationId: 'mut-start', clientId: 'c1', expectedVersion: 1 },
        { nowMs: t0 + 500 }
      )
      expect(res.ok).toBe(true)
      if (!res.ok) return

      expect(res.next.version).toBe(2)
      expect(res.next.gameState.status).toBe('PICKING')
      expect(res.next.gameState.currentTeamIndex).toBe(0)
      expect(res.next.gameState.turnStartTime).toBe(new Date(t0 + 500).toISOString())
      expect(res.delta?.op).toBe('START')

      // Stale START with expectedVersion: 1 after already PICKING -> alreadyApplied
      const stale = applyMutation(
        res.next,
        { type: 'START', mutationId: 'mut-start-2', expectedVersion: 1 },
        { nowMs: t0 + 900 }
      )
      expect(stale.ok).toBe(true)
      if (!stale.ok) return
      expect(stale.alreadyApplied).toBe(true)
      expect(stale.next.version).toBe(2)
    })

    it('PICK computes exact Dota reserve time math and transitions to COMPLETED on last pick', () => {
      const t0 = 1_700_000_000_000
      const base = makeBaseSnapshot(t0)
      base.gameState.turnDuration = 30
      base.members = base.members.slice(0, 2) // 2 members total: m3 (Charlie) & m1 (Alice)

      const started = applyMutation(base, { type: 'START', mutationId: 's1' }, { nowMs: t0 })
      if (!started.ok) throw new Error('start failed')

      // Pick #1 after 45s elapsed -> 15s beyond 30s turnDuration -> reserve 60 - 15 = 45s
      const p1 = applyMutation(
        started.next,
        { type: 'PICK', mutationId: 'p1', memberId: 'm1', teamId: 't1', expectedVersion: 2 },
        { nowMs: t0 + 45_000 }
      )
      expect(p1.ok).toBe(true)
      if (!p1.ok) return

      expect(p1.next.version).toBe(3)
      expect(p1.next.gameState.status).toBe('PICKING')
      expect(p1.next.gameState.currentTeamIndex).toBe(1)
      expect(p1.delta?.teamPatch).toEqual({ id: 't1', reserveTime: 45 })
      expect(p1.delta?.memberPatch?.id).toBe('m1')
      expect(p1.pickedMemberId).toBe('m1')

      // Pick #2 after 10s elapsed (within turnDuration) -> full 60s reserve kept + last pick -> COMPLETED
      const p2 = applyMutation(
        p1.next,
        { type: 'PICK', mutationId: 'p2', memberId: 'm3', teamId: 't2', expectedVersion: 3 },
        { nowMs: t0 + 55_000 }
      )
      expect(p2.ok).toBe(true)
      if (!p2.ok) return

      expect(p2.next.version).toBe(4)
      expect(p2.next.gameState.status).toBe('COMPLETED')
      expect(p2.delta?.teamPatch).toEqual({ id: 't2', reserveTime: 60 })
    })

    it('PICK rejects invalid phase, version conflict, wrong turn, and already-picked/banned members', () => {
      const t0 = 1_700_000_000_000
      const base = makeBaseSnapshot(t0)

      // Not picking
      const rNotPicking = applyMutation(
        base,
        { type: 'PICK', mutationId: 'p0', memberId: 'm1', teamId: 't1' },
        { nowMs: t0 }
      )
      expect(rNotPicking).toMatchObject({ ok: false, status: 400, code: 'NOT_PICKING' })

      const started = applyMutation(base, { type: 'START', mutationId: 's1' }, { nowMs: t0 })
      if (!started.ok) throw new Error('start failed')

      // Version conflict
      const rConflict = applyMutation(
        started.next,
        { type: 'PICK', mutationId: 'p1', memberId: 'm1', teamId: 't1', expectedVersion: 1 },
        { nowMs: t0 }
      )
      expect(rConflict).toMatchObject({ ok: false, status: 409, code: 'VERSION_CONFLICT' })

      // Wrong turn (t2 tries to pick during t1's turn)
      const rWrongTurn = applyMutation(
        started.next,
        { type: 'PICK', mutationId: 'p2', memberId: 'm1', teamId: 't2' },
        { nowMs: t0 }
      )
      expect(rWrongTurn).toMatchObject({ ok: false, status: 400, code: 'NOT_YOUR_TURN' })

      // Reserve clamps at 0 if elapsed vastly exceeds turnDuration + reserveTime
      const rPick = applyMutation(
        started.next,
        { type: 'PICK', mutationId: 'p3', memberId: 'm1', teamId: 't1' },
        { nowMs: t0 + 500_000 }
      )
      if (!rPick.ok) throw new Error('expected ok')
      expect(rPick.delta?.teamPatch?.reserveTime).toBe(0)

      // Double-pick already picked member
      const rDouble = applyMutation(
        rPick.next,
        { type: 'PICK', mutationId: 'p4', memberId: 'm1', teamId: 't2' },
        { nowMs: t0 + 501_000 }
      )
      expect(rDouble).toMatchObject({ ok: false, status: 409, code: 'MEMBER_UNAVAILABLE' })
    })

    it('AUTO_PICK zeros reserve time, picks deterministically, supports optimistic mode, and handles idempotency', () => {
      const t0 = 1_700_000_000_000
      const base = makeBaseSnapshot(t0)
      const started = applyMutation(base, { type: 'START', mutationId: 's1' }, { nowMs: t0 })
      if (!started.ok) throw new Error('start failed')

      // Optimistic mode with >1 candidate and no randomFloat advances turn without guessing a member
      const opt = applyMutation(
        started.next,
        { type: 'AUTO_PICK', mutationId: 'ap-opt', teamId: 't1', expectedVersion: 2 },
        { nowMs: t0 + 1000, isOptimistic: true }
      )
      expect(opt.ok).toBe(true)
      if (!opt.ok) return
      expect(opt.next.gameState.currentTeamIndex).toBe(1)
      expect(opt.delta?.teamPatch).toEqual({ id: 't1', reserveTime: 0 })
      expect(opt.delta?.memberPatch).toBeUndefined()

      // Authoritative AUTO_PICK with randomFloat=0 selects sorted first available ('Alice' -> m1)
      const auth = applyMutation(
        started.next,
        { type: 'AUTO_PICK', mutationId: 'ap-1', teamId: 't1', expectedVersion: 2 },
        { nowMs: t0 + 1000, randomFloat: 0 }
      )
      expect(auth.ok).toBe(true)
      if (!auth.ok) return
      expect(auth.pickedMemberId).toBe('m1')
      expect(auth.delta?.teamPatch).toEqual({ id: 't1', reserveTime: 0 })
      expect(auth.delta?.memberPatch?.id).toBe('m1')

      // Second client sends AUTO_PICK with stale expectedVersion: 2 -> alreadyApplied (NO 409!)
      const idemp = applyMutation(
        auth.next,
        { type: 'AUTO_PICK', mutationId: 'ap-2', teamId: 't1', expectedVersion: 2 },
        { nowMs: t0 + 1050 }
      )
      expect(idemp.ok).toBe(true)
      if (!idemp.ok) return
      expect(idemp.alreadyApplied).toBe(true)
      expect(idemp.next.version).toBe(3)

      // Wrong teamId without stale expectedVersion -> 409 TURN_ALREADY_TAKEN
      const wrongTeam = applyMutation(
        auth.next,
        { type: 'AUTO_PICK', mutationId: 'ap-3', teamId: 't1', expectedVersion: 3 },
        { nowMs: t0 + 1100 }
      )
      expect(wrongTeam).toMatchObject({ ok: false, status: 409, code: 'TURN_ALREADY_TAKEN' })
    })

    it('RANDOMIZE respects shuffledMemberIds round-robin and transitions to COMPLETED', () => {
      const t0 = 1_700_000_000_000
      const base = makeBaseSnapshot(t0)

      const res = applyMutation(
        base,
        { type: 'RANDOMIZE', mutationId: 'rnd-1', shuffledMemberIds: ['m3', 'm2', 'm1'] },
        { nowMs: t0 + 100 }
      )
      expect(res.ok).toBe(true)
      if (!res.ok) return

      expect(res.next.gameState.status).toBe('COMPLETED')
      expect(res.next.members.find((m) => m.id === 'm3')?.teamId).toBe('t1')
      expect(res.next.members.find((m) => m.id === 'm2')?.teamId).toBe('t2')
      expect(res.next.members.find((m) => m.id === 'm1')?.teamId).toBe('t1')
      expect(res.event.kind).toBe('snapshot')

      // Rejects when no teams configured
      const emptyTeams = { ...base, teams: [] }
      const err = applyMutation(
        emptyTeams,
        { type: 'RANDOMIZE', mutationId: 'rnd-2' },
        { nowMs: t0 }
      )
      expect(err).toMatchObject({ ok: false, status: 400, code: 'NO_TEAMS' })
    })

    it('CONFIG resets picks, accepts totalReserveTime=0, and fills missing team names', () => {
      const t0 = 1_700_000_000_000
      const base = makeBaseSnapshot(t0)
      base.members[0].teamId = 't1'
      base.members[0].isBanned = true

      let seq = 0
      const res = applyMutation(
        base,
        {
          type: 'CONFIG',
          mutationId: 'cfg-1',
          teamCount: 3,
          turnDuration: 20,
          totalReserveTime: 0,
          teamNames: ['Alpha', ''],
        },
        { nowMs: t0 + 50, generateId: () => `gen-t-${++seq}` }
      )
      expect(res.ok).toBe(true)
      if (!res.ok) return

      expect(res.next.gameState).toMatchObject({
        status: 'CONFIGURING',
        teamCount: 3,
        turnDuration: 20,
        totalReserveTime: 0,
        currentTeamIndex: 0,
        turnStartTime: null,
      })
      expect(res.next.teams).toEqual([
        { id: 'gen-t-1', name: 'Alpha', order: 0, reserveTime: 0 },
        { id: 'gen-t-2', name: 'Team 2', order: 1, reserveTime: 0 },
        { id: 'gen-t-3', name: 'Team 3', order: 2, reserveTime: 0 },
      ])
      expect(res.next.members.every((m) => m.teamId === null && !m.isBanned && m.pickedAt === null)).toBe(true)
    })

    it('MEMBER_ADD, MEMBER_UPDATE, MEMBER_DELETE handle media proxy URLs and idempotency', () => {
      const t0 = 1_700_000_000_000
      const base = makeBaseSnapshot(t0)
      const dataUrl = 'data:image/jpeg;base64,/9j/4AAQSkZJRg=='

      // Optimistic ADD keeps inline data URL for instant preview
      const optAdd = applyMutation(
        base,
        { type: 'MEMBER_ADD', mutationId: 'ma-opt', id: 'm99', name: 'Zoe', avatar: dataUrl },
        { nowMs: t0, isOptimistic: true }
      )
      expect(optAdd.ok).toBe(true)
      if (!optAdd.ok) return
      expect(optAdd.next.members.find((m) => m.id === 'm99')?.avatar).toBe(dataUrl)

      // Authoritative ADD strips inline base64 to proxy URL with mediaVersion=1
      const authAdd = applyMutation(
        base,
        { type: 'MEMBER_ADD', mutationId: 'ma-auth', id: 'm99', name: 'Zoe', avatar: dataUrl },
        { nowMs: t0, isOptimistic: false }
      )
      expect(authAdd.ok).toBe(true)
      if (!authAdd.ok) return
      const added = authAdd.next.members.find((m) => m.id === 'm99')!
      expect(added.avatar).toBe('/api/members/m99/media?field=avatar&v=1')
      expect(added.mediaVersion).toBe(1)

      // UPDATE preserving proxy URL keeps mediaVersion=1
      const updKeep = applyMutation(
        authAdd.next,
        {
          type: 'MEMBER_UPDATE',
          mutationId: 'mu-1',
          id: 'm99',
          name: 'Zoe Prime',
          avatar: '/api/members/m99/media?field=avatar&v=1',
        },
        { nowMs: t0 + 100 }
      )
      expect(updKeep.ok).toBe(true)
      if (!updKeep.ok) return
      const kept = updKeep.next.members.find((m) => m.id === 'm99')!
      expect(kept.name).toBe('Zoe Prime')
      expect(kept.avatar).toBe('/api/members/m99/media?field=avatar&v=1')
      expect(kept.mediaVersion).toBe(1)

      // UPDATE with new inline data URL bumps mediaVersion -> 2
      const updNew = applyMutation(
        updKeep.next,
        {
          type: 'MEMBER_UPDATE',
          mutationId: 'mu-2',
          id: 'm99',
          avatar: 'data:image/png;base64,iVBORw0KGgo=',
        },
        { nowMs: t0 + 200 }
      )
      expect(updNew.ok).toBe(true)
      if (!updNew.ok) return
      const bumped = updNew.next.members.find((m) => m.id === 'm99')!
      expect(bumped.avatar).toBe('/api/members/m99/media?field=avatar&v=2')
      expect(bumped.mediaVersion).toBe(2)

      // DELETE removes member; second DELETE is idempotent
      const del1 = applyMutation(
        updNew.next,
        { type: 'MEMBER_DELETE', mutationId: 'md-1', id: 'm99' },
        { nowMs: t0 + 300 }
      )
      expect(del1.ok).toBe(true)
      if (!del1.ok) return
      expect(del1.next.members.some((m) => m.id === 'm99')).toBe(false)

      const del2 = applyMutation(
        del1.next,
        { type: 'MEMBER_DELETE', mutationId: 'md-2', id: 'm99' },
        { nowMs: t0 + 400 }
      )
      expect(del2.ok).toBe(true)
      if (!del2.ok) return
      expect(del2.alreadyApplied).toBe(true)
    })
  })

  describe('applyRealtimeEvent monotonic gate & gap detection', () => {
    it('drops stale events, applies contiguous deltas, and flags gaps & invalidates for full sync', () => {
      const t0 = 1_700_000_000_000
      const base = makeBaseSnapshot(t0)
      const started = applyMutation(base, { type: 'START', mutationId: 's1' }, { nowMs: t0 })
      if (!started.ok) throw new Error('start failed')
      const v2 = started.next

      // Monotonic guard drops <= version
      expect(
        applyRealtimeEvent(v2, { kind: 'invalidate', version: 2, serverTime: t0 + 1 })
      ).toEqual({ applied: false, needsFullSync: false, next: v2 })

      // Contiguous delta v2 -> v3 applies cleanly
      const picked = applyMutation(
        v2,
        { type: 'PICK', mutationId: 'p1', memberId: 'm1', teamId: 't1' },
        { nowMs: t0 + 5_000 }
      )
      if (!picked.ok || !picked.delta) throw new Error('pick failed')

      const applied = applyRealtimeEvent(v2, picked.delta)
      expect(applied.applied).toBe(true)
      expect(applied.needsFullSync).toBe(false)
      expect(applied.next?.version).toBe(3)
      expect(applied.next?.members.find((m) => m.id === 'm1')?.teamId).toBe('t1')

      // Gap delta (prevVersion=4 !== current=3) signals needsFullSync
      const gapDelta: StateDelta = {
        ...picked.delta,
        version: 5,
        prevVersion: 4,
      }
      expect(applyRealtimeEvent(applied.next, gapDelta)).toEqual({
        applied: false,
        needsFullSync: true,
        next: applied.next,
      })

      // Invalidate with higher version signals needsFullSync
      expect(
        applyRealtimeEvent(applied.next, { kind: 'invalidate', version: 6, serverTime: t0 + 6_000 })
      ).toEqual({ applied: false, needsFullSync: true, next: applied.next })

      // Snapshot with higher version replaces directly
      const snapEventRes = applyRealtimeEvent(applied.next, {
        kind: 'snapshot',
        version: 7,
        serverTime: t0 + 7_000,
        snapshot: { ...v2, version: 7 },
      })
      expect(snapEventRes.applied).toBe(true)
      expect(snapEventRes.needsFullSync).toBe(false)
      expect(snapEventRes.next?.version).toBe(7)
    })

    it('safely coerces non-array snapshot.teams and snapshot.members to [] without throwing', () => {
      const t0 = 1_700_000_000_000
      const base = makeBaseSnapshot(t0)

      // Simulate malformed Redis cjson empty-object `{}` payloads for teams & members
      const malformedSnapshotEvent = {
        kind: 'snapshot' as const,
        version: 5,
        serverTime: t0 + 5_000,
        snapshot: {
          version: 5,
          serverTime: t0 + 5_000,
          gameState: { ...base.gameState, version: 5 },
          teams: {} as unknown as NormalizedGameSnapshot['teams'],
          members: {} as unknown as NormalizedGameSnapshot['members'],
        },
      }

      const res = applyRealtimeEvent(base, malformedSnapshotEvent)
      expect(res.applied).toBe(true)
      expect(res.needsFullSync).toBe(false)
      expect(res.next?.teams).toEqual([])
      expect(res.next?.members).toEqual([])
    })
  })
})
