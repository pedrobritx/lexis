/**
 * Badge evaluator registry.
 *
 * Each evaluator is an async function `(studentId, tenantId) => boolean`.
 * The registry maps badge slug → evaluator.
 *
 * Evaluators read the current DB state — they are called AFTER an event fires
 * and check whether the student now meets the badge criteria.
 */
import { prisma } from '@lexis/db'

export type Evaluator = (studentId: string, tenantId: string) => Promise<boolean>

// ── Helpers ───────────────────────────────────────────────

/** Count completed lessons for a student. */
async function completedLessonCount(studentId: string, tenantId: string): Promise<number> {
  return prisma.lessonProgress.count({
    where: { studentId, tenantId, status: 'completed' },
  })
}

/** Count SRS reviews (activity_attempts with response.srsReview === true). */
async function srsReviewCount(studentId: string, tenantId: string): Promise<number> {
  return prisma.activityAttempt.count({
    where: {
      studentId,
      tenantId,
      response: { path: ['srsReview'], equals: true },
    },
  })
}

// ── Lesson.completed evaluators ───────────────────────────

async function evalFirstSteps(studentId: string, tenantId: string): Promise<boolean> {
  return (await completedLessonCount(studentId, tenantId)) >= 1
}

async function evalBookworm(studentId: string, tenantId: string): Promise<boolean> {
  return (await completedLessonCount(studentId, tenantId)) >= 10
}

async function evalCenturyClub(studentId: string, tenantId: string): Promise<boolean> {
  return (await completedLessonCount(studentId, tenantId)) >= 100
}

/**
 * Course Conqueror: student has completed every non-deleted lesson
 * in at least one non-deleted, active course within the tenant.
 */
async function evalCourseConqueror(studentId: string, tenantId: string): Promise<boolean> {
  const courses = await prisma.course.findMany({
    where: { tenantId, deletedAt: null, status: 'active' },
    select: {
      id: true,
      units: {
        where: { deletedAt: null },
        select: {
          lessons: {
            where: { deletedAt: null },
            select: { id: true },
          },
        },
      },
    },
  })

  for (const course of courses) {
    const lessonIds = course.units.flatMap((u) => u.lessons.map((l) => l.id))
    if (lessonIds.length === 0) continue

    const completedCount = await prisma.lessonProgress.count({
      where: {
        studentId,
        lessonId: { in: lessonIds },
        status: 'completed',
      },
    })

    if (completedCount >= lessonIds.length) return true
  }

  return false
}

// ── Activity.correct evaluators ───────────────────────────

/**
 * Sharp Eye: the student's last 10 activity attempts are all correct.
 */
async function evalSharpEye(studentId: string, tenantId: string): Promise<boolean> {
  const recent = await prisma.activityAttempt.findMany({
    where: { studentId, tenantId },
    orderBy: { attemptedAt: 'desc' },
    take: 10,
    select: { correct: true },
  })
  return recent.length >= 10 && recent.every((a) => a.correct)
}

/**
 * Well-Rounded: student has at least 1 correct attempt across 3+ distinct activity types.
 */
async function evalWellRounded(studentId: string, tenantId: string): Promise<boolean> {
  const distinctTypes = await prisma.activity.findMany({
    where: {
      attempts: {
        some: { studentId, tenantId, correct: true },
      },
    },
    select: { type: true },
    distinct: ['type'],
  })
  return distinctTypes.length >= 3
}

/**
 * Grammar Master: ≥90% accuracy on grammar-tagged activities with ≥20 attempts.
 * Matches any skill_tag containing the pattern '_grammar' (e.g. "b1_grammar").
 */
async function evalGrammarMaster(studentId: string, tenantId: string): Promise<boolean> {
  const grammarTags = ['a1_grammar', 'a2_grammar', 'b1_grammar', 'b2_grammar', 'c1_grammar', 'c2_grammar']

  const attempts = await prisma.activityAttempt.findMany({
    where: {
      studentId,
      tenantId,
      activity: { skillTags: { hasSome: grammarTags } },
    },
    select: { correct: true },
  })

  if (attempts.length < 20) return false
  const correctCount = attempts.filter((a) => a.correct).length
  return correctCount / attempts.length >= 0.9
}

// ── SRS.reviewed evaluators ───────────────────────────────

async function evalReviewRookie(studentId: string, tenantId: string): Promise<boolean> {
  return (await srsReviewCount(studentId, tenantId)) >= 1
}

async function evalDedicatedLearner(studentId: string, tenantId: string): Promise<boolean> {
  return (await srsReviewCount(studentId, tenantId)) >= 50
}

// ── Streak.milestone evaluators ───────────────────────────

async function evalStreakDays(studentId: string, _tenantId: string, minDays: number): Promise<boolean> {
  const profile = await prisma.studentProfile.findUnique({
    where: { userId: studentId },
    select: { streakDays: true },
  })
  return (profile?.streakDays ?? 0) >= minDays
}

// ── Registry ──────────────────────────────────────────────

/**
 * Maps badge slug → evaluator function.
 * All evaluators share the same signature: (studentId, tenantId) => Promise<boolean>.
 */
const EVALUATOR_REGISTRY: Record<string, Evaluator> = {
  'first-steps': evalFirstSteps,
  'bookworm': evalBookworm,
  'century-club': evalCenturyClub,
  'course-conqueror': evalCourseConqueror,
  'sharp-eye': evalSharpEye,
  'well-rounded': evalWellRounded,
  'grammar-master': evalGrammarMaster,
  'review-rookie': evalReviewRookie,
  'dedicated-learner': evalDedicatedLearner,
  'on-a-roll': (s, t) => evalStreakDays(s, t, 3),
  'week-warrior': (s, t) => evalStreakDays(s, t, 7),
  'month-streak': (s, t) => evalStreakDays(s, t, 30),
}

export function getEvaluator(slug: string): Evaluator | undefined {
  return EVALUATOR_REGISTRY[slug]
}
