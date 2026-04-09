export interface Member {
  id: string
  name: string
  info: string | null
  avatar: string | null
  background: string | null
  teamId: string | null
  isBanned: boolean
  pickedAt: string | null
}

export interface Team {
  id: string
  name: string
  order: number
  reserveTime: number
  members: Member[]
}

export interface GameState {
  id: string
  currentTeamIndex: number
  turnStartTime: string
  status: 'CONFIGURING' | 'PICKING' | 'COMPLETED'
  turnDuration: number
  totalReserveTime: number
  teamCount: number
}
