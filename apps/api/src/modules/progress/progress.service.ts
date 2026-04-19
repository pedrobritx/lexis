import { prisma } from '@lexis/db'
import { logger } from '@lexis/logger'
import { eventBus } from '@lexis/events'
import { validateAnswer, type ActivityType } from '../activities/activities.service.js'

const log = logger('progress-service')

// ─── Types ────────────────────────────────────────────────

export interface AttemptInput {
  response: unknown
}

export interface AttemptResult {
  attemptId: string
  correct: boolean
  score: number | null
  requiresManualGrading: boolean
  lessonCompleted: boolean
  xpAwarded: number
}

export interface ActivitySummary {
  id: string
  attempted: boolean
  correct: boolean | null
}

export interface LessonProgressSummary {
  status: 'not_started' | 'in_progress' | 'completed'
  activityCount: number
  attemptedCount: number
  scorePct: number | null
  completedAt: Date | null
  activities: ActivitySummary[]
}

// XP constants
const XP_CORRECT = 10
const XP_LESSON_COMPLETE = 50

// ─── Log attempt ─────────────────────────────────────────

/**
 * Record an activity attempt.
 * - Validates the response against the activity's answer key.
 * - Awards XP for correct answers.
 * - Auto-completes the lesson when all activities have a correct attempt.
 * - Emits 'lesson.completed' and 'activity.correct' events.
 */
export async function logAttempt(
  activityId: string,
  studentId: string,
  tenantId: string,
  input: AttemptInput,
): Promise<AttemptResult> {
  // Load activity (full, for server-side validation)
  const activity = await prisma.activity.findFirst({
    where: { id: activityId, tenantId, deletedAt: null },
    select: {
      id: true,
      lessonId: true,
      version: true,
      type: true,
      content: true,
      scoringRules: true,
    },
  })
  if (!activity) {
    throw Object.assign(new Error('Activity not found'), { statusCode: 404 })
  }

  // Server-side answer validation — students never send correct/score directly
  const { correct, score, requiresManualGrading } = validateAnswer(
    activity.type as ActivityType,
    activity.content,
    activity.scoringRules,
    input.response,
  )

  // Record the attempt
  const attempt = await prisma.activityAttempt.create({
    data: {
      studentId,
      activityId,
      tenantId,
      correct,
      score: score ?? null,
      response: (input.response as object) ?? null,
    },
  })

  let xpAwarded = 0

  // Award XP for correct answers
  if (correct) {
    xpAwarded += XP_CORRECT
    await prisma.studentProfile.updateMany({
      where: { userId: studentId, tenantId },
      data: { xpTotal: { increment: XP_CORRECT } },
    })

    eventBus.emit('activity.correct', { studentId, activityId, tenantId })
    log.info({ studentId, activityId }, 'activity.correct emitted')
  }

  // ── Lesson completion check ────────────────────────────
  const lessonId = activity.lessonId

  const allActivities = await prisma.activity.findMany({
    where: { lessonId, tenantId, deletedAt: null },
    select: { id: true },
  })

  const correctAttempts = await prisma.activityAttempt.findMany({
    where: {
      studentId,
      tenantId,
      activityId: { in: allActivities.map((a) => a.id) },
      correct: true,
    },
    distinct: ['activityId'],
    select: { activityId: true },
  })

  const allCorrect =
    correctAttempts.length === allActivities.length && allActivities.length > 0

  // lessonCompleted is true only when THIS attempt first completes the lesson.
  // If it was already completed before, we return false to avoid double signals.
  let lessonCompleted = false

  if (allCorrect) {
    const existingProgress = await prisma.lessonProgress.findUnique({
      where: { studentId_lessonId: { studentId, lessonId } },
    })

    if (!existingProgress || existingProgress.status !== 'completed') {
      // First-time completion
      lessonCompleted = true
      const scorePct = correctAttempts.length / allActivities.length

      await prisma.lessonProgress.upsert({
        where: { studentId_lessonId: { studentId, lessonId } },
        update: { status: 'completed', scorePct, completedAt: new Date() },
        create: {
          studentId,
          lessonId,
          tenantId,
          status: 'completed',
          scorePct,
          completedAt: new Date(),
        },
      })

      xpAwarded += XP_LESSON_COMPLETE
      await prisma.studentProfile.updateMany({
        where: { userId: studentId, tenantId },
        data: { xpTotal: { increment: XP_LESSON_COMPLETE } },
      })

      eventBus.emit('lesson.completed', { studentId, lessonId, tenantId })
      log.info({ studentId, lessonId }, 'lesson.completed emitted')
    }
    // else: lesson was already completed — no XP re-award, lessonCompleted stays false
  } else {
    // Mark as in_progress on the first attempt (unless already completed)
    await prisma.lessonProgress.upsert({
      where: { studentId_lessonId: { studentId, lessonId } },
      update: {},
      create: { studentId, lessonId, tenantId, status: 'in_progress' },
    })
  }

  return {
    attemptId: attempt.id,
    correct,
    score,
    requiresManualGrading,
    lessonCompleted,
    xpAwarded,
  }
}

// ─── Lesson progress summary ──────────────────────────────

/**
 * Returns a rich progress summary for a student on a lesson.
 * Computes status dynamically from attempt records + lesson_progress table.
 */
export async function getLessonProgress(
  lessonId: string,
  studentId: string,
  tenantId: string,
): Promise<LessonProgressSummary> {
  // Verify lesson exists in tenant
  const lesson = await prisma.lesson.findFirst({
    where: { id: lessonId, tenantId, deletedAt: null },
  })
  if (!lesson) {
    throw Object.assign(new Error('Lesson not found'), { statusCode: 404 })
  }

  // All activities for this lesson
  const activities = await prisma.activity.findMany({
    where: { lessonId, tenantId, deletedAt: null },
    select: { id: true },
    orderBy: [{ position: 'asc' }, { id: 'asc' }],
  })

  const activityIds = activities.map((a) => a.id)

  // All attempts by this student for these activities
  const attempts = await prisma.activityAttempt.findMany({
    where: { studentId, tenantId, activityId: { in: activityIds } },
    select: { activityId: true, correct: true },
  })

  // Per-activity status: attempted + any-correct
  const attemptMap = new Map<string, { attempted: boolean; correct: boolean }>()
  for (const att of attempts) {
    const prev = attemptMap.get(att.activityId)
    if (!prev) {
      attemptMap.set(att.activityId, { attempted: true, correct: att.correct })
    } else if (att.correct) {
      attemptMap.set(att.activityId, { attempted: true, correct: true })
    }
  }

  const activitySummaries: ActivitySummary[] = activities.map((a) => {
    const s = attemptMap.get(a.id)
    return {
      id: a.id,
      attempted: s?.attempted ?? false,
      correct: s !== undefined ? s.correct : null,
    }
  })

  const attemptedCount = activitySummaries.filter((a) => a.attempted).length

  // Persist record for status/scorePct/completedAt
  const progressRecord = await prisma.lessonProgress.findUnique({
    where: { studentId_lessonId: { studentId, lessonId } },
  })

  let status: 'not_started' | 'in_progress' | 'completed'
  if (progressRecord?.status === 'completed') {
    status = 'completed'
  } else if (attemptedCount > 0) {
    status = 'in_progress'
  } else {
    status = 'not_started'
  }

  return {
    status,
    activityCount: activities.length,
    attemptedCount,
    scorePct: progressRecord?.scorePct ?? null,
    completedAt: progressRecord?.completedAt ?? null,
    activities: activitySummaries,
  }
}
