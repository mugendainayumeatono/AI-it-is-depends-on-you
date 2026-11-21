import { render, screen } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import DroppableTeam from '@/components/DroppableTeam'
import type { Team } from '@/types'

describe('Component: DroppableTeam', () => {
  const mockTeam: Team = {
    id: 't1',
    name: 'Liquid',
    order: 0,
    reserveTime: 30,
    members: [
      {
        id: 'm1',
        name: 'Nisha',
        info: 'Mid',
        avatar: '/api/members/m1/media?field=avatar&v=1',
        background: '/api/members/m1/media?field=background&v=1',
        teamId: 't1',
        isBanned: false,
        pickedAt: '2026-04-08T12:00:00.000Z',
        mediaVersion: 1,
      },
    ],
  }

  it('should render team name, reserve time, and picked members', () => {
    const { container } = render(<DroppableTeam team={mockTeam} isCurrentTurn={true} />)
    expect(screen.getByText(/Liquid/i)).toBeDefined()
    expect(screen.getByText(/Reserve: 30s/i)).toBeDefined()
    expect(screen.getByText(/Nisha/i)).toBeDefined()
    expect(screen.getByText(/Mid/i)).toBeDefined()
    expect(container.firstElementChild?.className).toContain('border-indigo-500')
    expect(screen.getByAltText('Nisha')).toHaveAttribute(
      'src',
      '/api/members/m1/media?field=avatar&v=1'
    )
  })

  it('should show placeholder if no members', () => {
    const emptyTeam: Team = { ...mockTeam, members: [] }
    const { container } = render(<DroppableTeam team={emptyTeam} isCurrentTurn={false} />)
    expect(screen.getByText(/No one picked yet/i)).toBeDefined()
    expect(container.firstElementChild?.className).toContain('border-gray-700')
  })

  it('should highlight low reserve time in red', () => {
    const lowReserveTeam: Team = { ...mockTeam, reserveTime: 5, members: [] }
    render(<DroppableTeam team={lowReserveTeam} isCurrentTurn={true} />)
    const badge = screen.getByText(/Reserve: 5s/i)
    expect(badge.className).toContain('text-red-400')
  })
})
