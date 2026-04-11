import { logger } from '@lexis/logger'
import { eventBus } from '@lexis/events'
import { checkAndAwardBadges } from './badge.service.js'

const log = logger('gamification-listeners')

/**
 * Wire up event bus listeners for badge evaluation.
 * Call once at app startup (after buildApp).
 *
 * Events handled:
 *   lesson.completed  → check lesson count + course_conqueror badges
 *   activity.correct  → check consecutive, type variety, grammar accuracy badges
 *   srs.reviewed      → check SRS review count badges
 *   streak.milestone  → check streak day badges
 */
export function initGamificationListeners(): void {
  // ── lesson.completed ─────────────────────────────────
  eventBus.on('lesson.completed', ({ studentId, tenantId }) => {
    checkAndAwardBadges('lesson.completed', studentId, tenantId).catch((err: unknown) => {
      log.error({ err, studentId }, 'Gamification: lesson.completed handler failed')
    })
  })

  // ── activity.correct ─────────────────────────────────
  eventBus.on('activity.correct', ({ studentId, tenantId }) => {
    checkAndAwardBadges('activity.correct', studentId, tenantId).catch((err: unknown) => {
      log.error({ err, studentId }, 'Gamification: activity.correct handler failed')
    })
  })

  // ── srs.reviewed ─────────────────────────────────────
  eventBus.on('srs.reviewed', ({ studentId, tenantId }) => {
    checkAndAwardBadges('srs.reviewed', studentId, tenantId).catch((err: unknown) => {
      log.error({ err, studentId }, 'Gamification: srs.reviewed handler failed')
    })
  })

  // ── streak.milestone ─────────────────────────────────
  eventBus.on('streak.milestone', ({ studentId, tenantId, days }) => {
    checkAndAwardBadges('streak.milestone', studentId, tenantId, { days }).catch((err: unknown) => {
      log.error({ err, studentId, days }, 'Gamification: streak.milestone handler failed')
    })
  })

  log.info('Gamification listeners registered')
}
