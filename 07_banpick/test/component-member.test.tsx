import { render, screen } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import DraggableMember from '@/components/DraggableMember'

describe('Component: DraggableMember', () => {
  const mockMember = { id: 'm1', name: 'LeBron', info: 'Carry', teamId: null, isBanned: false, pickedAt: null }

  it('should render member name and info', () => {
    render(<DraggableMember member={mockMember as any} />)
    expect(screen.getByText(/LeBron/i)).toBeDefined()
    expect(screen.getByText(/Carry/i)).toBeDefined()
  })
})
