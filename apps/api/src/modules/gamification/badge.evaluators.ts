import { prisma } from '@lexis/db'

// ─── Types ────────────────────────────────────────────────

export type TriggerCriteria = Record<string, unknown>

// Payload shapes by trigger type
export type LessonCompletedPayload = { studentId: string; lessonId: string; tenantId: string }
export type ActivityCorrectPayload = { studentId: string; activityId: string; tenantId: string }
export type SrsReviewedPayload = { studentId: string; srsItemId: string; tenantId: string; quality: number }
export type StreakMilestonePayload = { studentId: string; tenantId: string; days: number }

// ─── lesson.completed evaluator ──────────────────────────

/**
 * Handles:
 *   { type: 'count', threshold: N }      — total completed lessons >= N
 *   { type: 'course_conqueror' }          — all lessons in at least one course completed
 */
export async function evalLessonCompleted(
  studentId: string,
  tenantId: string,
  criteria: TriggerCriteria,
): Promise<boolean> {
  if (criteria.type === 'count') {
    const count = await prisma.lessonProgress.count({
      where: { studentId, tenantId, status: 'completed' },
    })
    return count >= (criteria.threshold as number)
  }

  if (criteria.type === 'course_conqueror') {
    // Get all lesson IDs the student has completed
    const completedRows = await prisma.lessonProgress.findMany({
      where: { studentId, tenantId, status: 'completed' },
      select: { lessonId: true },
    })
    if (completedRows.length === 0) return false

    const completedIds = new Set(completedRows.map(r => r.lessonId))

    // Find which courses those lessons belong to
    const completedLessons = await prisma.lesson.findMany({
      where: { id: { in: [...completedIds] }, deletedAt: null },
      select: { id: true, unit: { select: { courseId: true } } },
    })

    // Group completed lesson count by course
    const completedByCourse = new Map<string, number>()
    for (const l of completedLessons) {
      const cid = l.unit.courseId
      completedByCourse.set(cid, (completedByCourse.get(cid) ?? 0) + 1)
    }

    // For each candidate course, check if ALL lessons are in the completed set
    for (const [courseId, completedCount] of completedByCourse) {
      const totalInCourse = await prisma.lesson.count({
        where: { unit: { courseId }, deletedAt: null },
      })
      if (totalInCourse > 0 && completedCount >= totalInCourse) return true
    }
    return false
  }

  return false
}

// ─── activity.correct evaluator ──────────────────────────

/**
 * Handles:
 *   { type: 'consecutive_correct', threshold: N }
 *       — last N attempts (across all activities) are all correct
 *   { type: 'type_variety', threshold: N }
 *       — student has ≥ N distinct activity types with at least one correct answer
 *   { type: 'grammar_accuracy', accuracy_pct: P, min_attempts: M, skill_tag_pattern: S }
 *       — ≥ M attempts on grammar-tagged activities AND accuracy ≥ P%
 */
export async function evalActivityCorrect(
  studentId: string,
  tenantId: string,
  criteria: TriggerCriteria,
): Promise<boolean> {
  if (criteria.type === 'consecutive_correct') {
    const threshold = criteria.threshold as number
    const recent = await prisma.activityAttempt.findMany({
      where: { studentId, tenantId },
      orderBy: { attemptedAt: 'desc' },
      take: threshold,
      select: { correct: true },
    })
    return recent.length >= threshold && recent.every(a => a.correct)
  }

  if (criteria.type === 'type_variety') {
    // Get distinct activity types where student has at least one correct answer
    const correctAttempts = await prisma.activityAttempt.findMany({
      where: { studentId, tenantId, correct: true },
      include: { activity: { select: { type: true } } },
      distinct: ['activityId'],
    })
    const types = new Set(correctAttempts.map(a => a.activity.type))
    return types.size >= (criteria.threshold as number)
  }

  if (criteria.type === 'grammar_accuracy') {
    const accuracyPct = criteria.accuracy_pct as number
    const minAttempts = criteria.min_attempts as number
    const pattern = criteria.skill_tag_pattern as string // e.g. 'grammar'

    // Use raw SQL: count attempts on activities whose skill_tags contain the pattern
    type Row = { total: bigint; correct_count: bigint }
    const rows = await prisma.$queryRaw<Row[]>`
      SELECT
        COUNT(*)                                          AS total,
        SUM(CASE WHEN aa.correct THEN 1 ELSE 0 END)      AS correct_count
      FROM activity_attempts aa
      JOIN activities a ON a.id = aa.activity_id
      WHERE aa.student_id   = ${studentId}
        AND aa.tenant_id    = ${tenantId}
        AND EXISTS (
          SELECT 1
          FROM unnest(a.skill_tags) AS tag
          WHERE tag LIKE ${'%' + pattern + '%'}
        )
    `

    const row = rows[0]
    if (!row) return false
    const total = Number(row.total)
    const correct = Number(row.correct_count)
    if (total < minAttempts) return false
    return (correct / total) * 100 >= accuracyPct
  }

  return false
}

// ─── srs.reviewed evaluator ──────────────────────────────

/**
 * Handles:
 *   { type: 'count', threshold: N } — student has done ≥ N SRS reviews total
 */
export async function evalSrsReviewed(
  studentId: string,
  tenantId: string,
  criteria: TriggerCriteria,
): Promise<boolean> {
  if (criteria.type === 'count') {
    // SRS review attempts carry response.srsReview === true
    const count = await prisma.activityAttempt.count({
      where: {
        studentId,
        tenantId,
        response: { path: ['srsReview'], equals: true },
      },
    })
    return count >= (criteria.threshold as number)
  }
  return false
}

// ─── streak.milestone evaluator ──────────────────────────

/**
 * Handles:
 *   { type: 'streak_days', days: N } — the milestone event's days >= N
 *
 * The payload carries the exact new streak value; we just compare.
 */
export function evalStreakMilestone(
  currentDays: number,
  criteria: TriggerCriteria,
): boolean {
  if (criteria.type === 'streak_days') {
    return currentDays >= (criteria.days as number)
  }
  return false
}
