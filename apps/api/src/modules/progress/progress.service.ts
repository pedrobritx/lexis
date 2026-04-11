import { prisma } from '@lexis/db'
import { logger } from '@lexis/logger'
import { eventBus } from '@lexis/events'

const log = logger('progress-service')

// ─── Types ────────────────────────────────────────────────

export interface AttemptInput {
  correct: boolean
  score?: number
  response?: unknown
}

export interface AttemptResult {
  attemptId: string
  correct: boolean
  score: number | null
  lessonCompleted: boolean
  xpAwarded: number
}

// XP per correct activity (base; badge bonuses applied separately)
const XP_CORRECT = 10
const XP_LESSON_COMPLETE = 50

// ─── Log attempt ─────────────────────────────────────────

/**
 * Record an activity attempt, check lesson completion, emit events.
 * Called by POST /v1/progress/activities/:id/attempt.
 */
export async function logAttempt(
  activityId: string,
  studentId: string,
  tenantId: string,
  input: AttemptInput,
): Promise<AttemptResult> {
  // Verify activity exists and belongs to tenant
  const activity = await prisma.activity.findFirst({
    where: { id: activityId, tenantId, deletedAt: null },
    select: { id: true, lessonId: true, version: true },
  })
  if (!activity) {
    throw Object.assign(new Error('Activity not found'), { statusCode: 404 })
  }

  // Record the attempt
  const attempt = await prisma.activityAttempt.create({
    data: {
      studentId,
      activityId,
      tenantId,
      correct: input.correct,
      score: input.score ?? null,
      response: (input.response as object) ?? null,
    },
  })

  let xpAwarded = 0

  // Award XP for correct answers
  if (input.correct) {
    xpAwarded += XP_CORRECT
    await prisma.studentProfile.updateMany({
      where: { userId: studentId, tenantId },
      data: { xpTotal: { increment: XP_CORRECT } },
    })

    // Emit event for SRS item creation + gamification
    eventBus.emit('activity.correct', { studentId, activityId, tenantId })
    log.info({ studentId, activityId }, 'activity.correct emitted')
  }

  // ── Lesson completion check ────────────────────────────
  // A lesson is complete when the student has at least one correct attempt
  // for every non-deleted activity in the lesson.
  const lessonId = activity.lessonId
  const allActivities = await prisma.activity.findMany({
    where: { lessonId, tenantId, deletedAt: null },
    select: { id: true },
  })

  const correctActivityIds = await prisma.activityAttempt.findMany({
    where: { studentId, tenantId, activityId: { in: allActivities.map(a => a.id) }, correct: true },
    distinct: ['activityId'],
    select: { activityId: true },
  })

  const lessonCompleted = correctActivityIds.length === allActivities.length && allActivities.length > 0

  if (lessonCompleted) {
    // Upsert lesson progress to completed
    const existingProgress = await prisma.lessonProgress.findUnique({
      where: { studentId_lessonId: { studentId, lessonId } },
    })

    if (!existingProgress || existingProgress.status !== 'completed') {
      const scorePct =
        allActivities.length > 0
          ? (correctActivityIds.length / allActivities.length) * 100
          : null

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

      // XP bonus for lesson completion
      xpAwarded += XP_LESSON_COMPLETE
      await prisma.studentProfile.updateMany({
        where: { userId: studentId, tenantId },
        data: { xpTotal: { increment: XP_LESSON_COMPLETE } },
      })

      eventBus.emit('lesson.completed', { studentId, lessonId, tenantId })
      log.info({ studentId, lessonId }, 'lesson.completed emitted')
    }
  }

  return {
    attemptId: attempt.id,
    correct: attempt.correct,
    score: attempt.score,
    lessonCompleted,
    xpAwarded,
  }
}

// ─── Progress summary ─────────────────────────────────────

/** Return a student's progress record for a specific lesson. */
export async function getLessonProgress(lessonId: string, studentId: string) {
  return prisma.lessonProgress.findUnique({
    where: { studentId_lessonId: { studentId, lessonId } },
  })
}
