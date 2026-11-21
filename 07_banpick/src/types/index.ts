export type GameStatus = 'CONFIGURING' | 'PICKING' | 'COMPLETED'

export interface Member {
  id: string
  name: string
  info: string | null
  avatar: string | null
  background: string | null
  teamId: string | null
  isBanned: boolean
  pickedAt: string | null
  order?: number
  mediaVersion?: number
}

export interface Team {
  id: string
  name: string
  order: number
  reserveTime: number
  members: Member[]
}

export type TeamSummary = Omit<Team, 'members'>

export interface GameState {
  id: string
  version: number
  currentTeamIndex: number
  turnStartTime: string | null
  status: GameStatus
  turnDuration: number
  totalReserveTime: number
  teamCount: number
}

export interface NormalizedGameSnapshot {
  version: number
  serverTime: number
  lastMutationId?: string | null
  gameState: GameState
  teams: TeamSummary[]
  members: Member[]
}

export interface FullGameState {
  version: number
  serverTime: number
  lastMutationId?: string | null
  gameState: GameState
  teams: Team[]
  members: Member[]
}

/** Backwards-compatible shape for state responses & hooks */
export interface GameData {
  gameState: GameState
  teams: Team[]
  members: Member[]
  version?: number
  serverTime?: number | string
  lastMutationId?: string | null
}

export interface StartMutation {
  type: 'START'
  mutationId: string
  clientId?: string
  expectedVersion?: number
}

export interface PickMutation {
  type: 'PICK'
  mutationId: string
  clientId?: string
  memberId: string
  teamId: string
  expectedVersion?: number
}

export interface AutoPickMutation {
  type: 'AUTO_PICK'
  mutationId: string
  clientId?: string
  teamId?: string
  expectedVersion?: number
}

export interface RandomizeMutation {
  type: 'RANDOMIZE'
  mutationId: string
  clientId?: string
  expectedVersion?: number
  shuffledMemberIds?: string[]
}

export interface ConfigMutation {
  type: 'CONFIG'
  mutationId: string
  clientId?: string
  teamCount: number
  turnDuration: number
  totalReserveTime: number
  teamNames: string[]
  expectedVersion?: number
}

export interface MemberAddMutation {
  type: 'MEMBER_ADD'
  mutationId: string
  clientId?: string
  id?: string
  name: string
  info?: string | null
  avatar?: string | null
  background?: string | null
}

export interface MemberUpdateMutation {
  type: 'MEMBER_UPDATE'
  mutationId: string
  clientId?: string
  id: string
  name?: string
  info?: string | null
  avatar?: string | null
  background?: string | null
}

export interface MemberDeleteMutation {
  type: 'MEMBER_DELETE'
  mutationId: string
  clientId?: string
  id: string
}

export type GameMutation =
  | StartMutation
  | PickMutation
  | AutoPickMutation
  | RandomizeMutation
  | ConfigMutation
  | MemberAddMutation
  | MemberUpdateMutation
  | MemberDeleteMutation

export interface StateDelta {
  kind: 'delta'
  version: number
  prevVersion: number
  serverTime: number
  mutationId?: string | null
  clientId?: string | null
  op: 'START' | 'PICK' | 'AUTO_PICK'
  gameState: GameState
  teamPatch?: { id: string; reserveTime: number }
  memberPatch?: { id: string; teamId: string | null; pickedAt: string | null }
}

export interface SnapshotEvent {
  kind: 'snapshot'
  version: number
  serverTime: number
  mutationId?: string | null
  clientId?: string | null
  snapshot: NormalizedGameSnapshot
}

export interface InvalidateEvent {
  kind: 'invalidate'
  version: number
  serverTime: number
  mutationId?: string | null
}

export type RealtimeEvent = StateDelta | SnapshotEvent | InvalidateEvent

export interface SpeculativeClientEvent {
  mutationId: string
  clientId: string
  baseVersion: number
  sentAt: number
  mutation: GameMutation
}

export interface MutationSuccessResponse {
  success: true
  version: number
  serverTime: number
  lastMutationId?: string | null
  alreadyApplied?: boolean
  pickedMemberId?: string
  gameState: GameState
  teams: Team[]
  members: Member[]
  delta?: StateDelta
  snapshot?: NormalizedGameSnapshot
}

export interface MutationErrorResponse {
  success?: false
  error: string
  code?: string
  version?: number
  serverTime?: number
  alreadyApplied?: boolean
  gameState?: GameState
  teams?: Team[]
  members?: Member[]
}
