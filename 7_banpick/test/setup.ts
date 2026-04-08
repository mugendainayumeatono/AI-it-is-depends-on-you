import '@testing-library/jest-dom'
import { vi } from 'vitest'

// Mock Prisma
vi.mock('@/lib/prisma', () => ({
  default: {
    member: {
      findMany: vi.fn(),
      create: vi.fn(),
      delete: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
      count: vi.fn(),
    },
    team: {
      findMany: vi.fn(),
      create: vi.fn(),
      deleteMany: vi.fn(),
      update: vi.fn(),
    },
    gameState: {
      findUnique: vi.fn(),
      create: vi.fn(),
      upsert: vi.fn(),
      update: vi.fn(),
    },
    $transaction: vi.fn((p) => Promise.all(p)),
  },
}))

// Mock fetch for API tests
global.fetch = vi.fn()
