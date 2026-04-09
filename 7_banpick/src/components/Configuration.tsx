'use client'

import { useState } from 'react'
import { Member, Team, GameState } from '@/types'
import { Plus, Trash2, Save, Play, Upload } from 'lucide-react'

interface Props {
  gameState: GameState
  teams: Team[]
  members: Member[]
  mutate: (data?: any, opts?: any) => void
  onClose?: () => void
}

export default function Configuration({ gameState, teams, members, mutate, onClose }: Props) {
  const [teamCount, setTeamCount] = useState(gameState.teamCount)
  const [turnDuration, setTurnDuration] = useState(gameState.turnDuration)
  const [totalReserveTime, setTotalReserveTime] = useState(gameState.totalReserveTime)
  const [teamNames, setTeamNames] = useState<string[]>(teams.map(t => t.name))
  const [newMemberName, setNewMemberName] = useState('')
  const [newMemberInfo, setNewMemberInfo] = useState('')
  const [newMemberAvatar, setNewMemberAvatar] = useState<string | null>(null)
  const [newMemberBackground, setNewMemberBackground] = useState<string | null>(null)

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>, setter: (val: string | null) => void) => {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = (event) => {
      setter(event.target?.result as string)
    }
    reader.readAsDataURL(file)
  }

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
      body: JSON.stringify({ action: 'ADD', name: newMemberName, info: newMemberInfo, avatar: newMemberAvatar, background: newMemberBackground }),
    })
    setNewMemberName('')
    setNewMemberInfo('')
    setNewMemberAvatar(null)
    setNewMemberBackground(null)
    mutate()
  }

  const handleDeleteMember = async (id: string) => {
    await fetch('/api/members', {
      method: 'POST',
      body: JSON.stringify({ action: 'DELETE', memberId: id }),
    })
    mutate()
  }

  const handleClose = () => {
    if (onClose) onClose()
  }

  return (
    <div className="max-w-4xl mx-auto p-6 space-y-8 bg-gray-800 shadow-2xl rounded-xl border border-gray-700 text-gray-200">
      <h1 className="text-3xl font-bold text-gray-100 border-b border-gray-700 pb-4">Configuration</h1>
      
      <section className="space-y-4">
        <h2 className="text-xl font-semibold text-gray-300">Settings</h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="flex flex-col">
            <label className="text-sm text-gray-400 mb-1">Team Count</label>
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
              className="border border-gray-600 bg-gray-700 rounded p-2 text-white"
            />
          </div>
          <div className="flex flex-col">
            <label className="text-sm text-gray-400 mb-1">Turn Duration (s)</label>
            <input type="number" value={turnDuration} onChange={e => setTurnDuration(parseInt(e.target.value))} className="border border-gray-600 bg-gray-700 rounded p-2 text-white" />
          </div>
          <div className="flex flex-col">
            <label className="text-sm text-gray-400 mb-1">Reserve Time (s)</label>
            <input type="number" value={totalReserveTime} onChange={e => setTotalReserveTime(parseInt(e.target.value))} className="border border-gray-600 bg-gray-700 rounded p-2 text-white" />
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4">
          {teamNames.map((name, i) => (
            <div key={i} className="flex flex-col">
              <label className="text-sm text-gray-400 mb-1">Team {i + 1} Name</label>
              <input 
                type="text" 
                value={name} 
                onChange={e => {
                  const next = [...teamNames]
                  next[i] = e.target.value
                  setTeamNames(next)
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
          <Save size={18} /> Save Settings & Reset Game
        </button>
      </section>

      <section className="space-y-4 border-t border-gray-700 pt-6">
        <h2 className="text-xl font-semibold text-gray-300">Members ({members.length})</h2>
        <div className="flex flex-wrap gap-4 items-start bg-gray-900/50 border border-gray-700 p-4 rounded">
          <div className="flex flex-col">
            <label className="text-sm text-gray-400 mb-1">Name</label>
            <input type="text" value={newMemberName} onChange={e => setNewMemberName(e.target.value)} className="border border-gray-600 bg-gray-700 rounded p-2 w-48 text-white" placeholder="Name" />
          </div>
          <div className="flex flex-col flex-1">
            <label className="text-sm text-gray-400 mb-1">Info (Optional)</label>
            <textarea value={newMemberInfo} onChange={e => setNewMemberInfo(e.target.value)} className="border border-gray-600 bg-gray-700 rounded p-2 w-full text-white min-h-[42px]" placeholder="Multiline description..." rows={3} />
          </div>
          
          <div className="flex flex-col gap-2 w-full sm:w-auto mt-2 sm:mt-0">
            <div className="flex gap-2">
              <label className="flex flex-col items-center justify-center border border-dashed border-gray-500 rounded p-2 cursor-pointer hover:bg-gray-700 w-24 h-24 relative overflow-hidden">
                {newMemberAvatar ? <img src={newMemberAvatar} className="absolute inset-0 w-full h-full object-cover" /> : <><Upload size={16} className="text-gray-400"/> <span className="text-xs text-gray-400 mt-1">Avatar</span></>}
                <input type="file" accept="image/*" className="hidden" onChange={e => handleFileChange(e, setNewMemberAvatar)} />
              </label>
              <label className="flex flex-col items-center justify-center border border-dashed border-gray-500 rounded p-2 cursor-pointer hover:bg-gray-700 w-32 h-24 relative overflow-hidden">
                {newMemberBackground ? <img src={newMemberBackground} className="absolute inset-0 w-full h-full object-cover" /> : <><Upload size={16} className="text-gray-400"/> <span className="text-xs text-gray-400 mt-1">Background</span></>}
                <input type="file" accept="image/*" className="hidden" onChange={e => handleFileChange(e, setNewMemberBackground)} />
              </label>
            </div>
            <button 
              onClick={handleAddMember}
              className="flex items-center justify-center gap-2 bg-green-600 text-white px-4 py-2 rounded hover:bg-green-700 transition"
            >
              <Plus size={18} /> Add Member
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          {members.map(m => (
            <div key={m.id} className="flex justify-between items-center p-3 bg-gray-700 border border-gray-600 rounded hover:border-gray-500 transition relative overflow-hidden">
              {m.background && <img src={m.background} className="absolute inset-0 w-full h-full object-cover opacity-20" />}
              <div className="flex items-center gap-3 relative z-10">
                {m.avatar && <img src={m.avatar} className="w-10 h-10 rounded-full object-cover border border-gray-500" />}
                <div>
                  <p className="font-medium text-white">{m.name}</p>
                  <p className="text-xs text-gray-400 whitespace-pre-wrap">{m.info}</p>
                </div>
              </div>
              <button onClick={() => handleDeleteMember(m.id)} className="text-red-400 hover:text-red-300 relative z-10">
                <Trash2 size={16} />
              </button>
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
