'use client'

import { useState } from 'react'
import { Member, Team, GameState } from '@/types'
import { Plus, Trash2, Save, Play } from 'lucide-react'

interface Props {
  gameState: GameState
  teams: Team[]
  members: Member[]
  mutate: (data?: any, opts?: any) => void
}

export default function Configuration({ gameState, teams, members, mutate }: Props) {
  const [teamCount, setTeamCount] = useState(gameState.teamCount)
  const [turnDuration, setTurnDuration] = useState(gameState.turnDuration)
  const [totalReserveTime, setTotalReserveTime] = useState(gameState.totalReserveTime)
  const [teamNames, setTeamNames] = useState<string[]>(teams.map(t => t.name))
  const [newMemberName, setNewMemberName] = useState('')
  const [newMemberInfo, setNewMemberInfo] = useState('')

  const handleSaveConfig = async () => {
    await fetch('/api/config', {
      method: 'POST',
      body: JSON.stringify({ teamCount, turnDuration, totalReserveTime, teamNames }),
    })
    mutate()
  }

  const handleAddMember = async () => {
    if (!newMemberName) return
    await fetch('/api/members', {
      method: 'POST',
      body: JSON.stringify({ action: 'ADD', name: newMemberName, info: newMemberInfo }),
    })
    setNewMemberName('')
    setNewMemberInfo('')
    mutate()
  }

  const handleDeleteMember = async (id: string) => {
    await fetch('/api/members', {
      method: 'POST',
      body: JSON.stringify({ action: 'DELETE', memberId: id }),
    })
    mutate()
  }

  const handleStartGame = async () => {
    await fetch('/api/pick', {
      method: 'POST',
      body: JSON.stringify({ status: 'START' }),
    })
    mutate()
  }

  return (
    <div className="max-w-4xl mx-auto p-6 space-y-8 bg-white shadow-lg rounded-xl mt-10">
      <h1 className="text-3xl font-bold text-gray-800 border-b pb-4">Configuration</h1>
      
      <section className="space-y-4">
        <h2 className="text-xl font-semibold text-gray-700">Settings</h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="flex flex-col">
            <label className="text-sm text-gray-500 mb-1">Team Count</label>
            <input 
              type="number" 
              value={teamCount} 
              onChange={e => {
                const count = parseInt(e.target.value)
                setTeamCount(count)
                setTeamNames(prev => {
                  const next = [...prev]
                  while (next.length < count) next.push(`Team ${next.length + 1}`)
                  return next.slice(0, count)
                })
              }} 
              className="border rounded p-2"
            />
          </div>
          <div className="flex flex-col">
            <label className="text-sm text-gray-500 mb-1">Turn Duration (s)</label>
            <input type="number" value={turnDuration} onChange={e => setTurnDuration(parseInt(e.target.value))} className="border rounded p-2" />
          </div>
          <div className="flex flex-col">
            <label className="text-sm text-gray-500 mb-1">Reserve Time (s)</label>
            <input type="number" value={totalReserveTime} onChange={e => setTotalReserveTime(parseInt(e.target.value))} className="border rounded p-2" />
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4">
          {teamNames.map((name, i) => (
            <div key={i} className="flex flex-col">
              <label className="text-sm text-gray-500 mb-1">Team {i + 1} Name</label>
              <input 
                type="text" 
                value={name} 
                onChange={e => {
                  const next = [...teamNames]
                  next[i] = e.target.value
                  setTeamNames(next)
                }} 
                className="border rounded p-2"
              />
            </div>
          ))}
        </div>

        <button 
          onClick={handleSaveConfig}
          className="flex items-center gap-2 bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700 transition"
        >
          <Save size={18} /> Save Settings & Reset Game
        </button>
      </section>

      <section className="space-y-4 border-t pt-6">
        <h2 className="text-xl font-semibold text-gray-700">Members ({members.length})</h2>
        <div className="flex flex-wrap gap-4 items-end bg-gray-50 p-4 rounded">
          <div className="flex flex-col">
            <label className="text-sm text-gray-500 mb-1">Name</label>
            <input type="text" value={newMemberName} onChange={e => setNewMemberName(e.target.value)} className="border rounded p-2 w-48" placeholder="Name" />
          </div>
          <div className="flex flex-col">
            <label className="text-sm text-gray-500 mb-1">Info (Optional)</label>
            <input type="text" value={newMemberInfo} onChange={e => setNewMemberInfo(e.target.value)} className="border rounded p-2 w-64" placeholder="e.g. Carry, Mid" />
          </div>
          <button 
            onClick={handleAddMember}
            className="flex items-center gap-2 bg-green-600 text-white px-4 py-2 rounded hover:bg-green-700 transition"
          >
            <Plus size={18} /> Add Member
          </button>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          {members.map(m => (
            <div key={m.id} className="flex justify-between items-center p-3 bg-white border rounded hover:shadow-sm">
              <div>
                <p className="font-medium">{m.name}</p>
                <p className="text-xs text-gray-400">{m.info}</p>
              </div>
              <button onClick={() => handleDeleteMember(m.id)} className="text-red-400 hover:text-red-600">
                <Trash2 size={16} />
              </button>
            </div>
          ))}
        </div>
      </section>

      <div className="border-t pt-8 flex justify-center">
        <button 
          onClick={handleStartGame}
          disabled={members.length === 0 || teams.length === 0}
          className="flex items-center gap-2 bg-indigo-600 text-white px-8 py-3 rounded-full font-bold text-lg hover:bg-indigo-700 transition disabled:bg-gray-400"
        >
          <Play size={20} /> Start Picking Phase
        </button>
      </div>
    </div>
  )
}
