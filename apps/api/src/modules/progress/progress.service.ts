import { prisma } from '@lexis/db'
import { logger } from '@lexis/logger'
import { eventBus } from '@lexis/events'
import { validateAnswer, type ActivityType } from '../activities/activities.service.js'

const log = logger('progress-service')

// ─── XP constants (from product decisions doc) ────────────
const XP_CORRECT_ANSWER = 10
const XP_LESSON_COMPLETE = 50

// ─── Types ────────────────────────────────────────────────

export interface LogAttemptInput {
  response: Record<string, unknown>
}

export interface AttemptResult {
  attemptId: string
  correct: boolean
  score: number | null
  requiresManualGrading: boolean
  details?: unknown
  xpAwarded: number
  lessonCompleted: boolean
}

export interface LessonProgressSummary {
  lessonId: string
  status: 'not_started' | 'in_progress' | 'completed'
  scorePct: number | null
  completedAt: Date | null
  activityCount: number
  attemptedCount: number
  activities: ActivityProgressItem[]
}

interface ActivityProgressItem {
  activityId: string
  title: string
  type: string
  attempted: boolean
  attemptCount: number
  correct: boolean | null
  score: number | null
}

// ─── Core: log attempt ────────────────────────────────────

export async function logAttempt(
  activityId: string,
  studentId: string,
  tenantId: string,
  input: LogAttemptInput,
): Promise<AttemptResult> {
  // Fetch activity (tenant-scoped)
  const activity = await prisma.activity.findFirst({
    where: { id: activityId, tenantId, deletedAt: null },
  })
  if (!activity) {
    throw Object.assign(new Error('Activity not found'), { statusCode: 404 })
  }

  // Validate the answer against the activity's answer key
  const validation = validateAnswer(
    activity.type as ActivityType,
    activity.content,
    activity.scoringRules,
    input.response,
  )

  // Persist the attempt
  const attempt = await prisma.activityAttempt.create({
    data: {
      studentId,
      activityId,
      tenantId,
      correct: validation.correct,
      score: validation.score,
      response: input.response as object,
    },
  })

  let xpAwarded = 0
  let lessonCompleted = false

  // Award XP for correct answer and emit event
  if (validation.correct) {
    await prisma.studentProfile.updateMany({
      where: { userId: studentId, tenantId },
      data: { xpTotal: { increment: XP_CORRECT_ANSWER } },
    })
    xpAwarded += XP_CORRECT_ANSWER
    eventBus.emit('activity.correct', { studentId, activityId, tenantId })
  }

  // Check for lesson completion (skip if already completed)
  const lessonId = activity.lessonId
  const existing = await prisma.lessonProgress.findUnique({
    where: { studentId_lessonId: { studentId, lessonId } },
  })

  if (existing?.status !== 'completed') {
    const { completed, scorePct } = await checkLessonCompletion(lessonId, studentId, tenantId)

    if (completed) {
      await prisma.lessonProgress.upsert({
        where: { studentId_lessonId: { studentId, lessonId } },
        create: {
          studentId,
          lessonId,
          tenantId,
          status: 'completed',
          scorePct,
          completedAt: new Date(),
        },
        update: {
          status: 'completed',
          scorePct,
          completedAt: new Date(),
        },
      })

      // Award lesson completion XP
      await prisma.studentProfile.updateMany({
        where: { userId: studentId, tenantId },
        data: { xpTotal: { increment: XP_LESSON_COMPLETE } },
      })
      xpAwarded += XP_LESSON_COMPLETE
      lessonCompleted = true

      eventBus.emit('lesson.completed', { studentId, lessonId, tenantId })
      log.info({ studentId, lessonId, tenantId }, 'Lesson completed')
    } else {
      // Ensure lesson_progress is at least in_progress
      await prisma.lessonProgress.upsert({
        where: { studentId_lessonId: { studentId, lessonId } },
        create: { studentId, lessonId, tenantId, status: 'in_progress' },
        update: { status: 'in_progress' },
      })
    }
  }

  log.info(
    { attemptId: attempt.id, activityId, studentId, correct: validation.correct, xpAwarded },
    'Activity attempt logged',
  )

  return {
    attemptId: attempt.id,
    correct: validation.correct,
    score: validation.score,
    requiresManualGrading: validation.requiresManualGrading,
    details: validation.details,
    xpAwarded,
    lessonCompleted,
  }
}

// ─── Lesson completion check ──────────────────────────────

async function checkLessonCompletion(
  lessonId: string,
  studentId: string,
  tenantId: string,
): Promise<{ completed: boolean; scorePct: number | null }> {
  const activities = await prisma.activity.findMany({
    where: { lessonId, tenantId, deletedAt: null },
    select: { id: true, type: true },
  })

  if (activities.length === 0) {
    return { completed: false, scorePct: null }
  }

  // Get the latest attempt per activity for this student
  const attempts = await prisma.activityAttempt.findMany({
    where: {
      activityId: { in: activities.map((a) => a.id) },
      studentId,
    },
    orderBy: { attemptedAt: 'desc' },
    select: { activityId: true, score: true, correct: true },
  })

  // Build a map: activityId → latest attempt (first occurrence since desc order)
  const latestByActivity = new Map<string, { score: number | null; correct: boolean }>()
  for (const att of attempts) {
    if (!latestByActivity.has(att.activityId)) {
      latestByActivity.set(att.activityId, { score: att.score, correct: att.correct })
    }
  }

  // All activities must have been attempted at least once
  const allAttempted = activities.every((a) => latestByActivity.has(a.id))
  if (!allAttempted) {
    return { completed: false, scorePct: null }
  }

  // Score: average over auto-gradeable activities (exclude open_writing)
  const scorable = activities.filter((a) => a.type !== 'open_writing')
  let scorePct: number | null = null
  if (scorable.length > 0) {
    const totalScore = scorable.reduce((sum, a) => {
      const att = latestByActivity.get(a.id)
      // Use explicit score if available; fall back to correct boolean
      const s = att?.score ?? (att?.correct ? 1 : 0)
      return sum + s
    }, 0)
    scorePct = totalScore / scorable.length
  }

  return { completed: true, scorePct }
}

// ─── Progress summary ─────────────────────────────────────

export async function getLessonProgress(
  lessonId: string,
  studentId: string,
  tenantId: string,
): Promise<LessonProgressSummary> {
  const lesson = await prisma.lesson.findFirst({
    where: { id: lessonId, tenantId, deletedAt: null },
    select: { id: true },
  })
  if (!lesson) {
    throw Object.assign(new Error('Lesson not found'), { statusCode: 404 })
  }

  const activities = await prisma.activity.findMany({
    where: { lessonId, tenantId, deletedAt: null },
    select: { id: true, type: true, title: true },
    orderBy: { id: 'asc' },
  })

  const attempts = await prisma.activityAttempt.findMany({
    where: {
      activityId: { in: activities.map((a) => a.id) },
      studentId,
    },
    orderBy: { attemptedAt: 'asc' },
    select: { id: true, activityId: true, correct: true, score: true, attemptedAt: true },
  })

  const progress = await prisma.lessonProgress.findUnique({
    where: { studentId_lessonId: { studentId, lessonId } },
  })

  // Build per-activity summary (latest attempt wins)
  const latestByActivity = new Map<string, { correct: boolean; score: number | null }>()
  const countByActivity = new Map<string, number>()
  for (const att of attempts) {
    countByActivity.set(att.activityId, (countByActivity.get(att.activityId) ?? 0) + 1)
    // Overwrite each time — last in asc order = latest
    latestByActivity.set(att.activityId, { correct: att.correct, score: att.score })
  }

  const activityItems: ActivityProgressItem[] = activities.map((a) => {
    const latest = latestByActivity.get(a.id) ?? null
    return {
      activityId: a.id,
      title: a.title,
      type: a.type,
      attempted: latestByActivity.has(a.id),
      attemptCount: countByActivity.get(a.id) ?? 0,
      correct: latest?.correct ?? null,
      score: latest?.score ?? null,
    }
  })

  const attemptedCount = activityItems.filter((a) => a.attempted).length

  return {
    lessonId,
    status: (progress?.status ?? 'not_started') as LessonProgressSummary['status'],
    scorePct: progress?.scorePct ?? null,
    completedAt: progress?.completedAt ?? null,
    activityCount: activities.length,
    attemptedCount,
    activities: activityItems,
  }
}
