import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import Configuration from '@/components/Configuration'
import type { GameState, Member, Team } from '@/types'

class MockFileReader {
  onload: ((e: { target: { result: string } }) => void) | null = null
  readAsDataURL(file: File) {
    if (this.onload) {
      this.onload({ target: { result: `data:image/png;base64,mocked-${file.name}` } })
    }
  }
}

class MockImage {
  onload: (() => void) | null = null
  width = 500
  height = 500
  set src(_val: string) {
    setTimeout(() => {
      if (this.onload) this.onload()
    }, 0)
  }
}

describe('Component: Configuration', () => {
  const mockState: GameState = {
    id: 'singleton',
    version: 1,
    teamCount: 2,
    turnDuration: 30,
    totalReserveTime: 120,
    status: 'CONFIGURING',
    currentTeamIndex: 0,
    turnStartTime: null,
  }

  const mockTeams: Team[] = [
    { id: 't1', name: 'T1', order: 0, reserveTime: 120, members: [] },
    { id: 't2', name: 'T2', order: 1, reserveTime: 120, members: [] },
  ]

  const mockMembers: Member[] = [
    {
      id: 'm1',
      name: 'Member 1',
      info: 'Info',
      avatar: '/api/members/m1/media?field=avatar&v=1',
      background: '/api/members/m1/media?field=background&v=1',
      teamId: null,
      isBanned: false,
      pickedAt: null,
      mediaVersion: 1,
    },
  ]

  beforeEach(() => {
    vi.clearAllMocks()
    global.fetch = vi.fn().mockImplementation(() =>
      Promise.resolve({
        json: () => Promise.resolve({ success: true }),
        ok: true,
      })
    )
    global.alert = vi.fn()
    global.FileReader = MockFileReader as any
    global.Image = MockImage as any

    HTMLCanvasElement.prototype.getContext = vi.fn().mockReturnValue({
      drawImage: vi.fn(),
    }) as any
    HTMLCanvasElement.prototype.toDataURL = vi
      .fn()
      .mockReturnValue('data:image/jpeg;base64,mocked-compressed')
  })

  it('should save settings via dispatchMutation with zero redundant GET /api/state', async () => {
    const dispatchMutation = vi.fn().mockResolvedValue({ ok: true })
    render(
      <Configuration
        gameState={mockState}
        teams={mockTeams}
        members={mockMembers}
        dispatchMutation={dispatchMutation}
      />
    )

    fireEvent.click(screen.getByText(/Save Settings/i))

    await waitFor(() => {
      expect(dispatchMutation).toHaveBeenCalledWith({
        type: 'CONFIG',
        teamCount: 2,
        turnDuration: 30,
        totalReserveTime: 120,
        teamNames: ['T1', 'T2'],
      })
    })
    expect(global.fetch).not.toHaveBeenCalled()
  })

  it('should preserve totalReserveTime = 0 without falling back to 120', async () => {
    const dispatchMutation = vi.fn().mockResolvedValue({ ok: true })
    render(
      <Configuration
        gameState={mockState}
        teams={mockTeams}
        members={mockMembers}
        dispatchMutation={dispatchMutation}
      />
    )

    const reserveInput = screen.getByDisplayValue('120')
    fireEvent.change(reserveInput, { target: { value: '0' } })
    expect(reserveInput).toHaveValue(0)

    fireEvent.click(screen.getByText(/Save Settings/i))

    await waitFor(() => {
      expect(dispatchMutation).toHaveBeenCalledWith({
        type: 'CONFIG',
        teamCount: 2,
        turnDuration: 30,
        totalReserveTime: 0,
        teamNames: ['T1', 'T2'],
      })
    })
  })

  it('should trigger onClose when Back to Board is clicked', () => {
    const onClose = vi.fn()
    render(
      <Configuration
        gameState={mockState}
        teams={mockTeams}
        members={mockMembers}
        dispatchMutation={vi.fn().mockResolvedValue({ ok: true })}
        onClose={onClose}
      />
    )
    fireEvent.click(screen.getByText(/Back to Board/i))
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('should add a member with name, info, avatar, and background via dispatchMutation and clear form immediately', async () => {
    const dispatchMutation = vi.fn().mockResolvedValue({ ok: true })
    const { container } = render(
      <Configuration
        gameState={mockState}
        teams={mockTeams}
        members={mockMembers}
        dispatchMutation={dispatchMutation}
      />
    )

    const nameInput = screen.getByPlaceholderText('Name')
    const infoInput = screen.getByPlaceholderText(/Multiline description/i)

    fireEvent.change(nameInput, { target: { value: 'New Player' } })
    fireEvent.change(infoInput, { target: { value: 'Plays well\nVery aggressive' } })

    const fileInputs = container.querySelectorAll('input[type="file"]')
    expect(fileInputs.length).toBe(2)

    const avatarFile = new File(['dummy content'], 'avatar.png', { type: 'image/png' })
    const backgroundFile = new File(['dummy content'], 'bg.png', { type: 'image/png' })

    fireEvent.change(fileInputs[0], { target: { files: [avatarFile] } })
    fireEvent.change(fileInputs[1], { target: { files: [backgroundFile] } })

    await waitFor(() => {
      const images = container.querySelectorAll(
        'img[src="data:image/jpeg;base64,mocked-compressed"]'
      )
      expect(images.length).toBe(2)
    })

    fireEvent.click(screen.getByText('Add'))

    // Form resets optimistically right away
    expect(nameInput).toHaveValue('')

    await waitFor(() => {
      expect(dispatchMutation).toHaveBeenCalledWith({
        type: 'MEMBER_ADD',
        id: expect.any(String),
        name: 'New Player',
        info: 'Plays well\nVery aggressive',
        avatar: 'data:image/jpeg;base64,mocked-compressed',
        background: 'data:image/jpeg;base64,mocked-compressed',
      })
    })
  })

  it('should preserve existing media proxy URLs when editing a member without re-uploading images', async () => {
    const dispatchMutation = vi.fn().mockResolvedValue({ ok: true })
    render(
      <Configuration
        gameState={mockState}
        teams={mockTeams}
        members={mockMembers}
        dispatchMutation={dispatchMutation}
      />
    )

    const editBtn = screen
      .getAllByRole('button')
      .find((b) => b.innerHTML.includes('lucide-pencil'))!
    fireEvent.click(editBtn)

    const nameInput = screen.getByDisplayValue('Member 1')
    fireEvent.change(nameInput, { target: { value: 'Updated Member' } })

    fireEvent.click(screen.getByText('Update'))

    await waitFor(() => {
      expect(dispatchMutation).toHaveBeenCalledWith({
        type: 'MEMBER_UPDATE',
        id: 'm1',
        name: 'Updated Member',
        info: 'Info',
        avatar: '/api/members/m1/media?field=avatar&v=1',
        background: '/api/members/m1/media?field=background&v=1',
      })
    })
  })

  it('should update team count and names array dynamically', () => {
    render(
      <Configuration
        gameState={mockState}
        teams={mockTeams}
        members={mockMembers}
        dispatchMutation={vi.fn().mockResolvedValue({ ok: true })}
      />
    )
    const input = screen.getByDisplayValue('2')
    fireEvent.change(input, { target: { value: '4' } })
    expect(screen.getByText(/Team 4 Name/i)).toBeDefined()
  })

  it('should dispatch MEMBER_DELETE when trash button is clicked', () => {
    const dispatchMutation = vi.fn().mockResolvedValue({ ok: true })
    render(
      <Configuration
        gameState={mockState}
        teams={mockTeams}
        members={mockMembers}
        dispatchMutation={dispatchMutation}
      />
    )
    const delBtn = screen
      .getAllByRole('button')
      .find((b) => b.innerHTML.includes('lucide-trash'))!
    fireEvent.click(delBtn)

    expect(dispatchMutation).toHaveBeenCalledWith({
      type: 'MEMBER_DELETE',
      id: 'm1',
    })
  })

  it('should show alert if member name is empty', () => {
    render(
      <Configuration
        gameState={mockState}
        teams={mockTeams}
        members={mockMembers}
        dispatchMutation={vi.fn().mockResolvedValue({ ok: true })}
      />
    )
    fireEvent.click(screen.getByText('Add'))
    expect(global.alert).toHaveBeenCalledWith('Please enter a name for the member.')
  })

  it('should cancel edit and reset inputs', () => {
    render(
      <Configuration
        gameState={mockState}
        teams={mockTeams}
        members={mockMembers}
        dispatchMutation={vi.fn().mockResolvedValue({ ok: true })}
      />
    )

    const editBtn = screen
      .getAllByRole('button')
      .find((b) => b.innerHTML.includes('lucide-pencil'))!
    fireEvent.click(editBtn)
    expect(screen.getByDisplayValue('Member 1')).toBeDefined()

    fireEvent.click(screen.getByTitle('Cancel Edit'))
    expect(screen.queryByDisplayValue('Member 1')).toBeNull()
  })

  it('should alert when dispatchMutation returns an error', async () => {
    const dispatchMutation = vi.fn().mockResolvedValue({ ok: false, error: 'Server Error' })
    render(
      <Configuration
        gameState={mockState}
        teams={mockTeams}
        members={mockMembers}
        dispatchMutation={dispatchMutation}
      />
    )

    fireEvent.change(screen.getByPlaceholderText('Name'), { target: { value: 'New Player' } })
    fireEvent.click(screen.getByText('Add'))

    await waitFor(() => {
      expect(global.alert).toHaveBeenCalledWith('Server Error')
    })
  })

  it('standalone fallback: posts to /api/config and /api/members when dispatchMutation is omitted', async () => {
    const mutate = vi.fn()
    render(
      <Configuration
        gameState={mockState}
        teams={mockTeams}
        members={mockMembers}
        mutate={mutate}
      />
    )

    fireEvent.click(screen.getByText(/Save Settings/i))
    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        '/api/config',
        expect.objectContaining({ method: 'POST' })
      )
    })

    const delBtn = screen
      .getAllByRole('button')
      .find((b) => b.innerHTML.includes('lucide-trash'))!
    fireEvent.click(delBtn)
    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        '/api/members',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ action: 'DELETE', id: 'm1', memberId: 'm1' }),
        })
      )
    })
  })
})
