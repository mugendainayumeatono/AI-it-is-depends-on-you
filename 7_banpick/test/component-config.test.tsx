import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import Configuration from '@/components/Configuration'

class MockFileReader {
  onload: ((e: any) => void) | null = null
  readAsDataURL(file: File) {
    if (this.onload) {
      this.onload({ target: { result: `data:image/png;base64,mocked-${file.name}` } })
    }
  }
}

describe('Component: Configuration', () => {
  const mockState = { teamCount: 2, turnDuration: 30, totalReserveTime: 120, status: 'CONFIGURING' }
  const mockTeams = [{ name: 'T1' }, { name: 'T2' }]
  const mockMembers = [{ id: 'm1', name: 'Member 1', info: 'Info' }]
  const mutate = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
    global.fetch = vi.fn().mockImplementation(() => Promise.resolve({
      json: () => Promise.resolve({ success: true })
    }))
    global.FileReader = MockFileReader as any
  })

  it('should save settings', async () => {
    render(<Configuration gameState={mockState as any} teams={mockTeams as any} members={mockMembers as any} mutate={mutate} />)
    const btn = screen.getByText(/Save Settings/i)
    fireEvent.click(btn)
    expect(global.fetch).toHaveBeenCalledWith('/api/config', expect.objectContaining({ method: 'POST' }))
  })

  it('should trigger onClose when Back to Board is clicked', async () => {
    const onClose = vi.fn()
    render(<Configuration gameState={mockState as any} teams={mockTeams as any} members={mockMembers as any} mutate={mutate} onClose={onClose} />)
    const btn = screen.getByText(/Back to Board/i)
    fireEvent.click(btn)
    expect(onClose).toHaveBeenCalled()
  })

  it('should add a member with name, info, avatar, and background', async () => {
    const { container } = render(<Configuration gameState={mockState as any} teams={mockTeams as any} members={mockMembers as any} mutate={mutate} />)
    
    // Fill in Name and Info
    const nameInput = screen.getByPlaceholderText('Name')
    const infoInput = screen.getByPlaceholderText(/Multiline description/i)
    
    fireEvent.change(nameInput, { target: { value: 'New Player' } })
    fireEvent.change(infoInput, { target: { value: 'Plays well\nVery aggressive' } })

    // Upload files
    const fileInputs = container.querySelectorAll('input[type="file"]')
    expect(fileInputs.length).toBe(2)
    
    const avatarInput = fileInputs[0]
    const backgroundInput = fileInputs[1]

    const avatarFile = new File(['dummy content'], 'avatar.png', { type: 'image/png' })
    const backgroundFile = new File(['dummy content'], 'bg.png', { type: 'image/png' })

    fireEvent.change(avatarInput, { target: { files: [avatarFile] } })
    fireEvent.change(backgroundInput, { target: { files: [backgroundFile] } })

    // Click Add Member
    const addBtn = screen.getByText(/Add Member/i)
    fireEvent.click(addBtn)

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith('/api/members', expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ 
          action: 'ADD', 
          name: 'New Player', 
          info: 'Plays well\nVery aggressive',
          avatar: 'data:image/png;base64,mocked-avatar.png',
          background: 'data:image/png;base64,mocked-bg.png'
        })
      }))
    })
  })

  it('should update team count and names array', () => {
    render(<Configuration gameState={mockState as any} teams={mockTeams as any} members={mockMembers as any} mutate={mutate} />)
    const input = screen.getByDisplayValue('2')
    fireEvent.change(input, { target: { value: '4' } })
    // Should now show "Team 4 Name" label
    expect(screen.getByText(/Team 4 Name/i)).toBeDefined()
  })

  it('should call delete member API', async () => {
    render(<Configuration gameState={mockState as any} teams={mockTeams as any} members={mockMembers as any} mutate={mutate} />)
    const delBtn = screen.getByRole('button', { name: '' }) // The trash icon button
    fireEvent.click(delBtn)
    expect(global.fetch).toHaveBeenCalledWith('/api/members', expect.objectContaining({
      body: JSON.stringify({ action: 'DELETE', memberId: 'm1' })
    }))
  })

  it('should update team name', () => {
    render(<Configuration gameState={mockState as any} teams={mockTeams as any} members={mockMembers as any} mutate={mutate} />)
    const input = screen.getByDisplayValue('T1')
    fireEvent.change(input, { target: { value: 'Team Alpha' } })
    expect(input.getAttribute('value')).toBe('Team Alpha')
  })
})
