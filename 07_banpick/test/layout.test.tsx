import { render, screen } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import RootLayout from '@/app/layout'

// Mock fonts & Vercel SpeedInsights for unit test environment
vi.mock('next/font/google', () => ({
  Geist: () => ({ variable: 'geist' }),
  Geist_Mono: () => ({ variable: 'mono' }),
}))

vi.mock('@vercel/speed-insights/next', () => ({
  SpeedInsights: () => null,
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
