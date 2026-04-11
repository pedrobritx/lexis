import { describe, it, expect, vi, beforeEach } from 'vitest'

// ─── Mock @lexis/db (must be hoisted before imports) ─────

const mockPrisma = vi.hoisted(() => ({
  subscription: { findUnique: vi.fn() },
  enrollment: { groupBy: vi.fn() },
  course: { count: vi.fn() },
  mediaAsset: { aggregate: vi.fn() },
}))

vi.mock('@lexis/db', () => ({ prisma: mockPrisma }))

import { checkSubscriptionLimit, BillingLimitError } from './index.js'

// ─── Helpers ─────────────────────────────────────────────

const TENANT_ID = 'tenant-abc'

const defaultSub = {
  tenantId: TENANT_ID,
  planSlug: 'free',
  studentLimit: 3,
  lessonPlanLimit: 5,
  aiCreditsRemaining: 10,
  storageLimitBytes: BigInt(100 * 1024 * 1024), // 100 MB
}

function mockSub(overrides: Partial<typeof defaultSub> = {}) {
  mockPrisma.subscription.findUnique.mockResolvedValue({ ...defaultSub, ...overrides })
}

beforeEach(() => {
  vi.clearAllMocks()
})

// ─── students ─────────────────────────────────────────────

describe('checkSubscriptionLimit — students', () => {
  it('allows when under limit', async () => {
    mockSub({ studentLimit: 3 })
    mockPrisma.enrollment.groupBy.mockResolvedValue([{ studentId: 'a' }, { studentId: 'b' }])

    const result = await checkSubscriptionLimit(TENANT_ID, 'students')

    expect(result).toEqual({ allowed: true, current: 2, limit: 3 })
  })

  it('throws BillingLimitError when at limit', async () => {
    mockSub({ studentLimit: 3 })
    mockPrisma.enrollment.groupBy.mockResolvedValue([
      { studentId: 'a' },
      { studentId: 'b' },
      { studentId: 'c' },
    ])

    await expect(checkSubscriptionLimit(TENANT_ID, 'students')).rejects.toBeInstanceOf(
      BillingLimitError,
    )
  })

  it('BillingLimitError has statusCode 402', async () => {
    mockSub({ studentLimit: 3 })
    mockPrisma.enrollment.groupBy.mockResolvedValue([
      { studentId: 'a' },
      { studentId: 'b' },
      { studentId: 'c' },
    ])

    const err = await checkSubscriptionLimit(TENANT_ID, 'students').catch((e) => e)
    expect(err.statusCode).toBe(402)
    expect(err.details).toEqual({ current: 3, limit: 3, upgradeRequired: true })
  })

  it('returns unlimited when studentLimit is null', async () => {
    mockSub({ studentLimit: null })

    const result = await checkSubscriptionLimit(TENANT_ID, 'students')

    expect(result).toEqual({ allowed: true, current: 0, limit: null })
    expect(mockPrisma.enrollment.groupBy).not.toHaveBeenCalled()
  })
})

// ─── lesson_plans ─────────────────────────────────────────

describe('checkSubscriptionLimit — lesson_plans', () => {
  it('allows when under limit', async () => {
    mockSub({ lessonPlanLimit: 5 })
    mockPrisma.course.count.mockResolvedValue(2)

    const result = await checkSubscriptionLimit(TENANT_ID, 'lesson_plans')

    expect(result).toEqual({ allowed: true, current: 2, limit: 5 })
  })

  it('throws when at limit', async () => {
    mockSub({ lessonPlanLimit: 5 })
    mockPrisma.course.count.mockResolvedValue(5)

    await expect(checkSubscriptionLimit(TENANT_ID, 'lesson_plans')).rejects.toBeInstanceOf(
      BillingLimitError,
    )
  })

  it('returns unlimited when lessonPlanLimit is null', async () => {
    mockSub({ lessonPlanLimit: null })

    const result = await checkSubscriptionLimit(TENANT_ID, 'lesson_plans')

    expect(result).toEqual({ allowed: true, current: 0, limit: null })
    expect(mockPrisma.course.count).not.toHaveBeenCalled()
  })
})

// ─── ai_credits ───────────────────────────────────────────

describe('checkSubscriptionLimit — ai_credits', () => {
  it('allows when credits remain', async () => {
    mockSub({ aiCreditsRemaining: 5 })

    const result = await checkSubscriptionLimit(TENANT_ID, 'ai_credits')

    expect(result.allowed).toBe(true)
    expect(result.current).toBe(5)
  })

  it('throws when credits exhausted', async () => {
    mockSub({ aiCreditsRemaining: 0 })

    await expect(checkSubscriptionLimit(TENANT_ID, 'ai_credits')).rejects.toBeInstanceOf(
      BillingLimitError,
    )
  })

  it('returns unlimited for Growth plan (credits = -1)', async () => {
    mockSub({ aiCreditsRemaining: -1 })

    const result = await checkSubscriptionLimit(TENANT_ID, 'ai_credits')

    expect(result).toEqual({ allowed: true, current: -1, limit: null })
  })
})

// ─── storage ──────────────────────────────────────────────

describe('checkSubscriptionLimit — storage', () => {
  it('allows when under limit', async () => {
    mockSub({ storageLimitBytes: BigInt(100 * 1024 * 1024) })
    mockPrisma.mediaAsset.aggregate.mockResolvedValue({ _sum: { sizeBytes: BigInt(50 * 1024 * 1024) } })

    const result = await checkSubscriptionLimit(TENANT_ID, 'storage')

    expect(result.allowed).toBe(true)
    expect(result.current).toBe(50 * 1024 * 1024)
  })

  it('throws when over storage limit', async () => {
    mockSub({ storageLimitBytes: BigInt(100 * 1024 * 1024) })
    mockPrisma.mediaAsset.aggregate.mockResolvedValue({ _sum: { sizeBytes: BigInt(101 * 1024 * 1024) } })

    await expect(checkSubscriptionLimit(TENANT_ID, 'storage')).rejects.toBeInstanceOf(
      BillingLimitError,
    )
  })

  it('returns unlimited when storageLimitBytes is null', async () => {
    mockSub({ storageLimitBytes: null })

    const result = await checkSubscriptionLimit(TENANT_ID, 'storage')

    expect(result).toEqual({ allowed: true, current: 0, limit: null })
  })
})
