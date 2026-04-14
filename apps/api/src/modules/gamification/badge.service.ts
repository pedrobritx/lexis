/**
 * Badge award service.
 *
 * `checkAndAwardBadges` is the main entry point — called from event listeners.
 * It finds all badges for the given trigger type, skips already-awarded ones,
 * runs each evaluator, and persists the award when criteria are met.
 */
import { prisma } from '@lexis/db'
import { logger } from '@lexis/logger'
import { BADGE_CATALOGUE } from './badge.catalogue.js'
import { getEvaluator } from './badge.evaluator.js'

const log = logger('badge-service')

// ── Award ─────────────────────────────────────────────────

/**
 * Create the student_badge row and increment xp_total.
 * Both writes are wrapped in a transaction so XP is never granted without the badge.
 */
async function awardBadge(
  studentId: string,
  tenantId: string,
  badgeId: string,
  xpReward: number,
): Promise<void> {
  await prisma.$transaction([
    prisma.studentBadge.create({
      data: { studentId, badgeId, tenantId },
    }),
    prisma.studentProfile.updateMany({
      where: { userId: studentId, tenantId },
      data: { xpTotal: { increment: xpReward } },
    }),
  ])
}

// ── Check + Award ─────────────────────────────────────────

/**
 * Evaluate all badges belonging to `triggerType` for this student.
 *
 * Steps per badge:
 *   1. Look up badge row in DB (must be seeded — skip if missing)
 *   2. Skip if student already has the badge
 *   3. Run evaluator — skip if criteria not met
 *   4. Award badge + XP
 *
 * Individual failures are caught and logged without halting other badges.
 */
export async function checkAndAwardBadges(
  studentId: string,
  tenantId: string,
  triggerType: string,
): Promise<void> {
  const definitions = BADGE_CATALOGUE.filter((b) => b.triggerType === triggerType)

  for (const def of definitions) {
    const evaluator = getEvaluator(def.slug)
    if (!evaluator) continue

    try {
      // Fetch the seeded badge row
      const badge = await prisma.badge.findUnique({ where: { slug: def.slug } })
      if (!badge) {
        log.warn({ slug: def.slug }, 'Badge not found in DB — run db:seed')
        continue
      }

      // Skip if already awarded
      const existing = await prisma.studentBadge.findUnique({
        where: { studentId_badgeId: { studentId, badgeId: badge.id } },
      })
      if (existing) continue

      // Evaluate criteria
      const earned = await evaluator(studentId, tenantId)
      if (!earned) continue

      // Award
      await awardBadge(studentId, tenantId, badge.id, badge.xpReward)

      log.info({ slug: def.slug, studentId, xpReward: badge.xpReward }, 'Badge awarded')
    } catch (err: unknown) {
      log.error({ err, slug: def.slug, studentId }, 'Badge evaluation error')
    }
  }
}
