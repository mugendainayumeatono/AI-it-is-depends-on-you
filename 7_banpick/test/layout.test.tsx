import { render, screen } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import RootLayout from '@/app/layout'

// Mock fonts as they can be tricky in test environments
vi.mock('next/font/google', () => ({
  Geist: () => ({ variable: 'geist' }),
  Geist_Mono: () => ({ variable: 'mono' }),
}))

describe('Layout: RootLayout', () => {
  it('should render children', () => {
    render(
      <RootLayout>
        <div data-testid="child">Content</div>
      </RootLayout>
    )
    expect(screen.getByTestId('child')).toBeDefined()
  })
})
