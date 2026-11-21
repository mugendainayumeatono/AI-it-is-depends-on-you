import '@testing-library/jest-dom'
import { beforeEach, vi } from 'vitest'
import { resetStateStore } from '@/lib/stateStore'

const prismaMock = vi.hoisted(() => {
  const mock = {
    member: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
      create: vi.fn(),
      createMany: vi.fn(),
      delete: vi.fn(),
      deleteMany: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
      upsert: vi.fn(),
      count: vi.fn(),
    },
    team: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
      create: vi.fn(),
      createMany: vi.fn(),
      delete: vi.fn(),
      deleteMany: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
      upsert: vi.fn(),
    },
    gameState: {
      findUnique: vi.fn(),
      create: vi.fn(),
      upsert: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
    },
    $transaction: vi.fn(),
  }

  mock.$transaction.mockImplementation((arg: unknown) => {
    if (typeof arg === 'function') {
      return (arg as (tx: typeof mock) => unknown)(mock)
    }
    return Promise.all(arg as Promise<unknown>[])
  })

  return mock
})

// Mock Prisma
vi.mock('@/lib/prisma', () => ({
  default: prismaMock,
}))

beforeEach(() => {
  resetStateStore()
  globalThis.__banpickPusherCache = undefined
  globalThis.__banpickLocalListeners?.clear()
  prismaMock.$transaction.mockImplementation((arg: unknown) => {
    if (typeof arg === 'function') {
      return (arg as (tx: typeof prismaMock) => unknown)(prismaMock)
    }
    return Promise.all(arg as Promise<unknown>[])
  })
})

// Mock fetch for API/client tests
global.fetch = vi.fn()
