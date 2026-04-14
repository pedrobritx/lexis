import { prisma } from '@lexis/db'
import { logger } from '@lexis/logger'
import {
  evalLessonCompleted,
  evalActivityCorrect,
  evalSrsReviewed,
  evalStreakMilestone,
  type TriggerCriteria,
} from './badge.evaluators.js'

const log = logger('badge-service')

// ─── Types ────────────────────────────────────────────────

export interface AwardedBadge {
  badgeId: string
  slug: string
  name: string
  xpReward: number
  rarity: string
}

// ─── Award flow ───────────────────────────────────────────

/**
 * Check and award all badges for a given trigger type.
 *
 * 1. Load all badges matching triggerType.
 * 2. Skip badges the student already has.
 * 3. Run the evaluator for each remaining badge.
 * 4. If evaluator returns true, insert student_badge + award XP.
 * 5. Return the list of newly awarded badges.
 */
export async function checkAndAwardBadges(
  triggerType: string,
  studentId: string,
  tenantId: string,
  extraPayload?: Record<string, unknown>, // e.g. { days: 7 } for streak
): Promise<AwardedBadge[]> {
  // Load all badges for this trigger type
  const badges = await prisma.badge.findMany({
    where: { triggerType, visibleToStudent: true },
  })
  if (badges.length === 0) return []

  // Load badges already held by this student
  const existing = await prisma.studentBadge.findMany({
    where: { studentId, badgeId: { in: badges.map(b => b.id) } },
    select: { badgeId: true },
  })
  const alreadyHeld = new Set(existing.map(e => e.badgeId))

  const awarded: AwardedBadge[] = []

  for (const badge of badges) {
    if (alreadyHeld.has(badge.id)) continue

    const criteria = badge.triggerCriteria as TriggerCriteria
    let qualifies = false

    try {
      if (triggerType === 'lesson.completed') {
        qualifies = await evalLessonCompleted(studentId, tenantId, criteria)
      } else if (triggerType === 'activity.correct') {
        qualifies = await evalActivityCorrect(studentId, tenantId, criteria)
      } else if (triggerType === 'srs.reviewed') {
        qualifies = await evalSrsReviewed(studentId, tenantId, criteria)
      } else if (triggerType === 'streak.milestone') {
        const days = (extraPayload?.days as number) ?? 0
        qualifies = evalStreakMilestone(days, criteria)
      }
    } catch (err) {
      log.error({ err, badgeSlug: badge.slug, studentId }, 'Badge evaluator threw')
      continue
    }

    if (!qualifies) continue

    // Award the badge
    try {
      await prisma.$transaction(async (tx) => {
        await tx.studentBadge.create({
          data: { studentId, badgeId: badge.id, tenantId },
        })
        if (badge.xpReward > 0) {
          await tx.studentProfile.updateMany({
            where: { userId: studentId, tenantId },
            data: { xpTotal: { increment: badge.xpReward } },
          })
        }
      })

      awarded.push({
        badgeId: badge.id,
        slug: badge.slug,
        name: badge.name,
        xpReward: badge.xpReward,
        rarity: badge.rarity,
      })

      log.info({ studentId, badgeSlug: badge.slug, xpReward: badge.xpReward }, 'Badge awarded')
    } catch (err: unknown) {
      // Unique constraint means another process awarded it simultaneously — ignore
      const isUniqueViolation =
        err instanceof Error && err.message.includes('Unique constraint')
      if (!isUniqueViolation) {
        log.error({ err, badgeSlug: badge.slug, studentId }, 'Failed to award badge')
      }
    }
  }

  return awarded
}
