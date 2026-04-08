import { render, screen } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import DroppableTeam from '@/components/DroppableTeam'

describe('Component: DroppableTeam', () => {
  const mockTeam = { 
    id: 't1', 
    name: 'Liquid', 
    reserveTime: 30, 
    members: [{ id: 'm1', name: 'Nisha', info: 'Mid' }] 
  }

  it('should render team name and picked members', () => {
    render(<DroppableTeam team={mockTeam as any} isCurrentTurn={true} isOverAnywhere={false} />)
    expect(screen.getByText(/Liquid/i)).toBeDefined()
    expect(screen.getByText(/Nisha/i)).toBeDefined()
  })

  it('should show placeholder if no members', () => {
    const emptyTeam = { ...mockTeam, members: [] }
    render(<DroppableTeam team={emptyTeam as any} isCurrentTurn={false} isOverAnywhere={false} />)
    expect(screen.getByText(/No one picked yet/i)).toBeDefined()
  })
})
