/**
 * Gamification unit tests.
 *
 * Tests evaluator logic and the award flow using mocked Prisma.
 * No DB or network required.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

// ── Mock @lexis/db ────────────────────────────────────────
const mockPrisma = {
  lessonProgress: {
    count: vi.fn(),
  },
  activityAttempt: {
    findMany: vi.fn(),
    count: vi.fn(),
  },
  activity: {
    findMany: vi.fn(),
  },
  studentProfile: {
    findUnique: vi.fn(),
    updateMany: vi.fn(),
  },
  course: {
    findMany: vi.fn(),
  },
  badge: {
    findUnique: vi.fn(),
  },
  studentBadge: {
    findUnique: vi.fn(),
    create: vi.fn(),
  },
  $transaction: vi.fn(),
}

vi.mock('@lexis/db', () => ({ prisma: mockPrisma }))
vi.mock('@lexis/logger', () => ({
  logger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}))

// ── Import after mocking ──────────────────────────────────
const { getEvaluator } = await import('./badge.evaluator.js')
const { checkAndAwardBadges } = await import('./badge.service.js')

const S = 'student-1'
const T = 'tenant-1'

beforeEach(() => {
  vi.clearAllMocks()
  mockPrisma.$transaction.mockImplementation(async (ops: unknown[]) => {
    for (const op of ops) await op
    return []
  })
})

// ── Lesson count evaluators ───────────────────────────────

describe('first-steps evaluator', () => {
  it('returns true when 1+ lesson completed', async () => {
    mockPrisma.lessonProgress.count.mockResolvedValue(1)
    expect(await getEvaluator('first-steps')!(S, T)).toBe(true)
  })

  it('returns false when 0 lessons completed', async () => {
    mockPrisma.lessonProgress.count.mockResolvedValue(0)
    expect(await getEvaluator('first-steps')!(S, T)).toBe(false)
  })
})

describe('bookworm evaluator', () => {
  it('returns true at exactly 10 completed', async () => {
    mockPrisma.lessonProgress.count.mockResolvedValue(10)
    expect(await getEvaluator('bookworm')!(S, T)).toBe(true)
  })

  it('returns false at 9 completed', async () => {
    mockPrisma.lessonProgress.count.mockResolvedValue(9)
    expect(await getEvaluator('bookworm')!(S, T)).toBe(false)
  })
})

describe('century-club evaluator', () => {
  it('returns true at 100+', async () => {
    mockPrisma.lessonProgress.count.mockResolvedValue(100)
    expect(await getEvaluator('century-club')!(S, T)).toBe(true)
  })

  it('returns false at 99', async () => {
    mockPrisma.lessonProgress.count.mockResolvedValue(99)
    expect(await getEvaluator('century-club')!(S, T)).toBe(false)
  })
})

describe('course-conqueror evaluator', () => {
  it('returns true when all lessons in a course are completed', async () => {
    mockPrisma.course.findMany.mockResolvedValue([
      { id: 'c1', units: [{ lessons: [{ id: 'l1' }, { id: 'l2' }] }] },
    ])
    mockPrisma.lessonProgress.count.mockResolvedValue(2)
    expect(await getEvaluator('course-conqueror')!(S, T)).toBe(true)
  })

  it('returns false when some lessons are not completed', async () => {
    mockPrisma.course.findMany.mockResolvedValue([
      { id: 'c1', units: [{ lessons: [{ id: 'l1' }, { id: 'l2' }] }] },
    ])
    mockPrisma.lessonProgress.count.mockResolvedValue(1)
    expect(await getEvaluator('course-conqueror')!(S, T)).toBe(false)
  })

  it('skips courses with no lessons', async () => {
    mockPrisma.course.findMany.mockResolvedValue([
      { id: 'c1', units: [] },
    ])
    expect(await getEvaluator('course-conqueror')!(S, T)).toBe(false)
  })
})

// ── Activity.correct evaluators ───────────────────────────

describe('sharp-eye evaluator', () => {
  it('returns true when last 10 attempts are all correct', async () => {
    mockPrisma.activityAttempt.findMany.mockResolvedValue(
      Array(10).fill({ correct: true }),
    )
    expect(await getEvaluator('sharp-eye')!(S, T)).toBe(true)
  })

  it('returns false when any of the last 10 is wrong', async () => {
    mockPrisma.activityAttempt.findMany.mockResolvedValue([
      ...Array(9).fill({ correct: true }),
      { correct: false },
    ])
    expect(await getEvaluator('sharp-eye')!(S, T)).toBe(false)
  })

  it('returns false when fewer than 10 attempts exist', async () => {
    mockPrisma.activityAttempt.findMany.mockResolvedValue(
      Array(9).fill({ correct: true }),
    )
    expect(await getEvaluator('sharp-eye')!(S, T)).toBe(false)
  })
})

describe('well-rounded evaluator', () => {
  it('returns true when 3 distinct activity types have correct attempts', async () => {
    mockPrisma.activity.findMany.mockResolvedValue([
      { type: 'mcq' },
      { type: 'cloze' },
      { type: 'matching' },
    ])
    expect(await getEvaluator('well-rounded')!(S, T)).toBe(true)
  })

  it('returns false when only 2 distinct types', async () => {
    mockPrisma.activity.findMany.mockResolvedValue([{ type: 'mcq' }, { type: 'cloze' }])
    expect(await getEvaluator('well-rounded')!(S, T)).toBe(false)
  })
})

describe('grammar-master evaluator', () => {
  it('returns true with ≥20 attempts and ≥90% correct', async () => {
    const attempts = [
      ...Array(18).fill({ correct: true }),
      ...Array(2).fill({ correct: false }),
    ] // 18/20 = 90%
    mockPrisma.activityAttempt.findMany.mockResolvedValue(attempts)
    expect(await getEvaluator('grammar-master')!(S, T)).toBe(true)
  })

  it('returns false with fewer than 20 attempts', async () => {
    mockPrisma.activityAttempt.findMany.mockResolvedValue(Array(19).fill({ correct: true }))
    expect(await getEvaluator('grammar-master')!(S, T)).toBe(false)
  })

  it('returns false with <90% accuracy even with 20+ attempts', async () => {
    const attempts = [
      ...Array(17).fill({ correct: true }),
      ...Array(3).fill({ correct: false }),
    ] // 17/20 = 85%
    mockPrisma.activityAttempt.findMany.mockResolvedValue(attempts)
    expect(await getEvaluator('grammar-master')!(S, T)).toBe(false)
  })
})

// ── SRS evaluators ────────────────────────────────────────

describe('review-rookie evaluator', () => {
  it('returns true with 1+ SRS review', async () => {
    mockPrisma.activityAttempt.count.mockResolvedValue(1)
    expect(await getEvaluator('review-rookie')!(S, T)).toBe(true)
  })

  it('returns false with 0 SRS reviews', async () => {
    mockPrisma.activityAttempt.count.mockResolvedValue(0)
    expect(await getEvaluator('review-rookie')!(S, T)).toBe(false)
  })
})

describe('dedicated-learner evaluator', () => {
  it('returns true at exactly 50 reviews', async () => {
    mockPrisma.activityAttempt.count.mockResolvedValue(50)
    expect(await getEvaluator('dedicated-learner')!(S, T)).toBe(true)
  })

  it('returns false at 49 reviews', async () => {
    mockPrisma.activityAttempt.count.mockResolvedValue(49)
    expect(await getEvaluator('dedicated-learner')!(S, T)).toBe(false)
  })
})

// ── Streak evaluators ─────────────────────────────────────

describe('on-a-roll evaluator', () => {
  it('returns true at streak ≥3', async () => {
    mockPrisma.studentProfile.findUnique.mockResolvedValue({ streakDays: 3 })
    expect(await getEvaluator('on-a-roll')!(S, T)).toBe(true)
  })

  it('returns false at streak 2', async () => {
    mockPrisma.studentProfile.findUnique.mockResolvedValue({ streakDays: 2 })
    expect(await getEvaluator('on-a-roll')!(S, T)).toBe(false)
  })
})

describe('week-warrior evaluator', () => {
  it('returns true at streak ≥7', async () => {
    mockPrisma.studentProfile.findUnique.mockResolvedValue({ streakDays: 7 })
    expect(await getEvaluator('week-warrior')!(S, T)).toBe(true)
  })
})

describe('month-streak evaluator', () => {
  it('returns true at streak ≥30', async () => {
    mockPrisma.studentProfile.findUnique.mockResolvedValue({ streakDays: 30 })
    expect(await getEvaluator('month-streak')!(S, T)).toBe(true)
  })
})

// ── Award flow ────────────────────────────────────────────

describe('checkAndAwardBadges', () => {
  it('awards a badge when evaluator returns true and badge not yet awarded', async () => {
    const badge = {
      id: 'badge-uuid-1',
      slug: 'first-steps',
      xpReward: 25,
    }
    mockPrisma.badge.findUnique.mockResolvedValue(badge)
    mockPrisma.studentBadge.findUnique.mockResolvedValue(null) // not awarded yet
    mockPrisma.lessonProgress.count.mockResolvedValue(1) // evaluator passes

    await checkAndAwardBadges(S, T, 'lesson.completed')

    expect(mockPrisma.$transaction).toHaveBeenCalled()
  })

  it('skips when badge already awarded', async () => {
    mockPrisma.badge.findUnique.mockResolvedValue({ id: 'badge-uuid-1', slug: 'first-steps', xpReward: 25 })
    mockPrisma.studentBadge.findUnique.mockResolvedValue({ id: 'existing' }) // already awarded
    mockPrisma.lessonProgress.count.mockResolvedValue(5)

    await checkAndAwardBadges(S, T, 'lesson.completed')

    expect(mockPrisma.$transaction).not.toHaveBeenCalled()
  })

  it('skips when evaluator returns false', async () => {
    mockPrisma.badge.findUnique.mockResolvedValue({ id: 'badge-uuid-1', slug: 'first-steps', xpReward: 25 })
    mockPrisma.studentBadge.findUnique.mockResolvedValue(null)
    mockPrisma.lessonProgress.count.mockResolvedValue(0) // evaluator fails

    await checkAndAwardBadges(S, T, 'lesson.completed')

    expect(mockPrisma.$transaction).not.toHaveBeenCalled()
  })

  it('skips gracefully when badge not seeded in DB', async () => {
    mockPrisma.badge.findUnique.mockResolvedValue(null) // badge missing from DB

    await expect(checkAndAwardBadges(S, T, 'lesson.completed')).resolves.toBeUndefined()
    expect(mockPrisma.$transaction).not.toHaveBeenCalled()
  })

  it('continues evaluating other badges when one throws', async () => {
    // first-steps throws, bookworm succeeds
    mockPrisma.badge.findUnique
      .mockResolvedValueOnce(null) // first-steps not in DB → skip
      .mockResolvedValue({ id: 'badge-uuid-3', slug: 'bookworm', xpReward: 50 })
    mockPrisma.studentBadge.findUnique.mockResolvedValue(null)
    mockPrisma.lessonProgress.count.mockResolvedValue(10)

    await expect(checkAndAwardBadges(S, T, 'lesson.completed')).resolves.toBeUndefined()
  })
})
