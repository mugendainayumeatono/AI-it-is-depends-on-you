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

// Mock the global Image class to immediately fire onload
class MockImage {
  onload: (() => void) | null = null
  width = 500
  height = 500
  set src(val: string) {
    setTimeout(() => {
      if (this.onload) this.onload()
    }, 0)
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
      json: () => Promise.resolve({ success: true }),
      ok: true
    }))
    global.FileReader = MockFileReader as any
    global.Image = MockImage as any
    
    // Mock canvas context
    HTMLCanvasElement.prototype.getContext = vi.fn().mockReturnValue({
      drawImage: vi.fn(),
    }) as any
    HTMLCanvasElement.prototype.toDataURL = vi.fn().mockReturnValue('data:image/jpeg;base64,mocked-compressed')
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

    // Wait for the base64 conversion and state update to finish
    await waitFor(() => {
      const images = container.querySelectorAll('img[src="data:image/jpeg;base64,mocked-compressed"]')
      expect(images.length).toBe(2)
    })

    // Click Add Member
    const addBtn = screen.getByText('Add')
    fireEvent.click(addBtn)

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith('/api/members', expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ 
          action: 'ADD', 
          memberId: null,
          name: 'New Player', 
          info: 'Plays well\nVery aggressive',
          avatar: 'data:image/jpeg;base64,mocked-compressed',
          background: 'data:image/jpeg;base64,mocked-compressed'
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
    const buttons = screen.getAllByRole('button')
    // Find the button with the trash icon inside
    const delBtn = buttons.find(b => b.innerHTML.includes('lucide-trash')) || buttons[buttons.length - 2]
    fireEvent.click(delBtn)
    expect(global.fetch).toHaveBeenCalledWith('/api/members', expect.objectContaining({
      body: JSON.stringify({ action: 'DELETE', memberId: 'm1' })
    }))
  })

  it('should show alert if name is empty', () => {
    global.alert = vi.fn()
    render(<Configuration gameState={mockState as any} teams={mockTeams as any} members={mockMembers as any} mutate={mutate} />)
    const addBtn = screen.getByText('Add')
    fireEvent.click(addBtn)
    expect(global.alert).toHaveBeenCalledWith("Please enter a name for the member.")
  })

  it('should handle edit click and then update member', async () => {
    render(<Configuration gameState={mockState as any} teams={mockTeams as any} members={mockMembers as any} mutate={mutate} />)
    
    // Find edit button (lucide-pencil)
    const editBtn = screen.getAllByRole('button').find(b => b.innerHTML.includes('lucide-pencil'))!
    fireEvent.click(editBtn)

    // Name should be "Member 1"
    const nameInput = screen.getByDisplayValue('Member 1')
    fireEvent.change(nameInput, { target: { value: 'Updated Member' } })

    const saveBtn = screen.getByText('Update')
    fireEvent.click(saveBtn)

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith('/api/members', expect.objectContaining({
        body: expect.stringContaining('"action":"UPDATE"')
      }))
    })
  })

  it('should cancel edit', () => {
    render(<Configuration gameState={mockState as any} teams={mockTeams as any} members={mockMembers as any} mutate={mutate} />)
    
    const editBtn = screen.getAllByRole('button').find(b => b.innerHTML.includes('lucide-pencil'))!
    fireEvent.click(editBtn)

    const cancelBtn = screen.getByTitle('Cancel Edit')
    fireEvent.click(cancelBtn)

    expect(screen.queryByDisplayValue('Member 1')).toBeNull()
  })

  it('should handle fetch error in handleSubmitMember', async () => {
    global.alert = vi.fn()
    global.fetch = vi.fn().mockImplementation(() => Promise.resolve({
      ok: false,
      json: () => Promise.resolve({ error: 'Server Error' })
    }))

    render(<Configuration gameState={mockState as any} teams={mockTeams as any} members={mockMembers as any} mutate={mutate} />)
    
    const nameInput = screen.getByPlaceholderText('Name')
    fireEvent.change(nameInput, { target: { value: 'New Player' } })
    
    const addBtn = screen.getByText('Add')
    fireEvent.click(addBtn)

    await waitFor(() => {
      expect(global.alert).toHaveBeenCalledWith("Server Error")
    })
  })
})
