import { render, screen } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import DraggableMember from '@/components/DraggableMember'
import type { Member } from '@/types'

describe('Component: DraggableMember', () => {
  const mockMember: Member = {
    id: 'm1',
    name: 'LeBron',
    info: 'Carry',
    avatar: '/api/members/m1/media?field=avatar&v=1',
    background: '/api/members/m1/media?field=background&v=1',
    teamId: null,
    isBanned: false,
    pickedAt: null,
    mediaVersion: 1,
  }

  it('should render member name, info, and proxy media URLs', () => {
    const { container } = render(<DraggableMember member={mockMember} />)
    expect(screen.getByText(/LeBron/i)).toBeDefined()
    expect(screen.getByText(/Carry/i)).toBeDefined()

    const avatarImg = screen.getByAltText('LeBron')
    expect(avatarImg).toHaveAttribute('src', '/api/members/m1/media?field=avatar&v=1')

    const bgImg = container.querySelector('img[alt=""]')
    expect(bgImg).toHaveAttribute('src', '/api/members/m1/media?field=background&v=1')
  })

  it('should render picked styling when teamId is assigned', () => {
    const pickedMember: Member = {
      ...mockMember,
      teamId: 't1',
      pickedAt: '2026-04-08T12:00:00.000Z',
    }
    const { container } = render(<DraggableMember member={pickedMember} disabled={true} />)
    expect(container.firstElementChild?.className).toContain('opacity-50')
  })

  it('should apply overlay styling when isOverlay is true', () => {
    const { container } = render(
      <DraggableMember member={mockMember} disabled={true} isOverlay={true} />
    )
    expect(container.firstElementChild?.className).toContain('scale-105')
  })
})
