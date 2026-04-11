import { prisma } from '@lexis/db'
import { logger } from '@lexis/logger'
import { eventBus } from '@lexis/events'
import {
  applyReviewWithStalenessCheck,
  nextReviewDate,
  updateStreakDays,
} from '@lexis/srs'

const log = logger('srs-service')

// ─── Types ────────────────────────────────────────────────

export interface SrsQueueItem {
  id: string
  activityId: string
  srsMode: 'flashcard' | 'mini_lesson'
  easeFactor: number
  intervalDays: number
  repetitions: number
  nextReview: Date
  activity: {
    id: string
    type: string
    title: string
    content: unknown
  }
}

export interface ReviewInput {
  quality: number // 0–5
}

export interface ReviewResult {
  srsItemId: string
  newIntervalDays: number
  newEaseFactor: number
  newRepetitions: number
  nextReviewDate: Date
  contentChanged: boolean
  streakDays: number
}

// ─── Queue ────────────────────────────────────────────────

/**
 * Return all SRS items due today (or overdue) for a student.
 * Items are ordered by next_review ascending so older items come first.
 */
export async function getQueue(studentId: string, tenantId: string): Promise<SrsQueueItem[]> {
  // Include everything up to end of today UTC
  const endOfToday = new Date()
  endOfToday.setUTCHours(23, 59, 59, 999)

  const items = await prisma.srsItem.findMany({
    where: {
      studentId,
      tenantId,
      nextReview: { lte: endOfToday },
    },
    include: {
      activity: {
        select: { id: true, type: true, title: true, content: true },
      },
    },
    orderBy: { nextReview: 'asc' },
  })

  return items.map((item) => ({
    id: item.id,
    activityId: item.activityId,
    srsMode: item.srsMode as 'flashcard' | 'mini_lesson',
    easeFactor: item.easeFactor,
    intervalDays: item.intervalDays,
    repetitions: item.repetitions,
    nextReview: item.nextReview,
    activity: item.activity,
  }))
}

// ─── Review ───────────────────────────────────────────────

/**
 * Log one SRS review:
 *   1. Validate input and ownership
 *   2. Apply SM-2 (with staleness check)
 *   3. Update srs_item
 *   4. Log activity_attempt
 *   5. Update student streak
 *   6. Emit srs.reviewed event
 */
export async function logReview(
  srsItemId: string,
  studentId: string,
  tenantId: string,
  input: ReviewInput,
): Promise<ReviewResult> {
  const { quality } = input

  if (!Number.isInteger(quality) || quality < 0 || quality > 5) {
    throw Object.assign(new Error('quality must be an integer 0–5'), { statusCode: 400 })
  }

  // ── Fetch item ────────────────────────────────────────
  const srsItem = await prisma.srsItem.findFirst({
    where: { id: srsItemId, studentId, tenantId },
  })
  if (!srsItem) {
    throw Object.assign(new Error('SRS item not found'), { statusCode: 404 })
  }

  // ── Fetch activity for version check ─────────────────
  const activity = await prisma.activity.findFirst({
    where: { id: srsItem.activityId, tenantId, deletedAt: null },
  })
  if (!activity) {
    throw Object.assign(new Error('Activity not found'), { statusCode: 404 })
  }

  // ── Apply SM-2 with staleness check ──────────────────
  const schedResult = applyReviewWithStalenessCheck(
    {
      easeFactor: srsItem.easeFactor,
      intervalDays: srsItem.intervalDays,
      repetitions: srsItem.repetitions,
      activityVersion: srsItem.activityVersion,
    },
    quality,
    activity.version,
  )

  const reviewDate = nextReviewDate(schedResult.intervalDays)

  // ── Streak: find most recent prior SRS review ─────────
  // Query BEFORE creating the new attempt to avoid counting the current one
  const srsActivityIds = await prisma.srsItem
    .findMany({ where: { studentId, tenantId }, select: { activityId: true } })
    .then((rows) => rows.map((r) => r.activityId))

  const lastAttempt =
    srsActivityIds.length > 0
      ? await prisma.activityAttempt.findFirst({
          where: {
            studentId,
            activityId: { in: srsActivityIds },
          },
          orderBy: { attemptedAt: 'desc' },
          select: { attemptedAt: true },
        })
      : null

  const studentProfile = await prisma.studentProfile.findUnique({
    where: { userId: studentId },
    select: { streakDays: true },
  })

  const newStreakDays = updateStreakDays(
    studentProfile?.streakDays ?? 0,
    lastAttempt?.attemptedAt ?? null,
    new Date(),
  )

  // ── Persist: update srs_item, log attempt, update streak ─
  await prisma.srsItem.update({
    where: { id: srsItemId },
    data: {
      easeFactor: schedResult.easeFactor,
      intervalDays: schedResult.intervalDays,
      repetitions: schedResult.repetitions,
      nextReview: reviewDate,
      activityVersion: activity.version,
    },
  })

  await prisma.activityAttempt.create({
    data: {
      studentId,
      activityId: srsItem.activityId,
      tenantId,
      correct: quality >= 3,
      score: quality / 5,
      response: { quality, srsItemId, srsReview: true },
    },
  })

  await prisma.studentProfile.updateMany({
    where: { userId: studentId, tenantId },
    data: { streakDays: newStreakDays },
  })

  // ── Emit event ────────────────────────────────────────
  eventBus.emit('srs.reviewed', { studentId, srsItemId, tenantId, quality })

  log.info(
    {
      srsItemId,
      studentId,
      quality,
      newIntervalDays: schedResult.intervalDays,
      contentChanged: schedResult.contentChanged,
    },
    'SRS review logged',
  )

  return {
    srsItemId,
    newIntervalDays: schedResult.intervalDays,
    newEaseFactor: schedResult.easeFactor,
    newRepetitions: schedResult.repetitions,
    nextReviewDate: reviewDate,
    contentChanged: schedResult.contentChanged,
    streakDays: newStreakDays,
  }
}

// ─── SRS item creation ────────────────────────────────────

/**
 * Create an srs_item for a student+activity if one doesn't exist yet.
 * Only called for activities that have srs_mode set.
 * Initial state: interval=1, ease_factor=2.5, due tomorrow.
 */
export async function createSrsItemIfNeeded(
  activityId: string,
  studentId: string,
  tenantId: string,
): Promise<void> {
  const activity = await prisma.activity.findFirst({
    where: { id: activityId, tenantId, deletedAt: null },
    select: { srsMode: true, version: true },
  })

  if (!activity?.srsMode) return // Not an SRS activity

  const existing = await prisma.srsItem.findFirst({
    where: { activityId, studentId, tenantId },
  })
  if (existing) return // Already enrolled

  await prisma.srsItem.create({
    data: {
      studentId,
      activityId,
      tenantId,
      srsMode: activity.srsMode,
      easeFactor: 2.5,
      intervalDays: 1,
      nextReview: nextReviewDate(1),
      activityVersion: activity.version,
      repetitions: 0,
    },
  })

  log.info({ activityId, studentId }, 'SRS item created')
}

// ─── Event bus listener setup ─────────────────────────────

/**
 * Wire up the event bus listener that auto-creates srs_items
 * when a student correctly answers an SRS-enabled activity.
 * Call once at app startup (after buildApp).
 */
export function initSrsListeners(): void {
  eventBus.on('activity.correct', ({ activityId, studentId, tenantId }) => {
    createSrsItemIfNeeded(activityId, studentId, tenantId).catch((err: unknown) => {
      log.error({ err, activityId, studentId }, 'Failed to create SRS item')
    })
  })
}
