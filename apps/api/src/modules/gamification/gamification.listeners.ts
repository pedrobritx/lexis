/**
 * Gamification event listeners.
 *
 * Wires the event bus to badge evaluation on every relevant event.
 * Call `initGamificationListeners()` once at app startup, after `buildApp()`.
 *
 * Covered events:
 *   lesson.completed  → lesson-count badges + course-conqueror
 *   activity.correct  → streak/accuracy/variety badges
 *   srs.reviewed      → SRS-count badges
 *   streak.milestone  → streak-day badges
 */
import { eventBus } from '@lexis/events'
import { logger } from '@lexis/logger'
import { checkAndAwardBadges } from './badge.service.js'

const log = logger('gamification-listeners')

export function initGamificationListeners(): void {
  eventBus.on('lesson.completed', ({ studentId, tenantId }) => {
    checkAndAwardBadges(studentId, tenantId, 'lesson.completed').catch((err: unknown) => {
      log.error({ err, studentId }, 'Gamification error on lesson.completed')
    })
  })

  eventBus.on('activity.correct', ({ studentId, tenantId }) => {
    checkAndAwardBadges(studentId, tenantId, 'activity.correct').catch((err: unknown) => {
      log.error({ err, studentId }, 'Gamification error on activity.correct')
    })
  })

  eventBus.on('srs.reviewed', ({ studentId, tenantId }) => {
    checkAndAwardBadges(studentId, tenantId, 'srs.reviewed').catch((err: unknown) => {
      log.error({ err, studentId }, 'Gamification error on srs.reviewed')
    })
  })

  eventBus.on('streak.milestone', ({ studentId, tenantId }) => {
    checkAndAwardBadges(studentId, tenantId, 'streak.milestone').catch((err: unknown) => {
      log.error({ err, studentId }, 'Gamification error on streak.milestone')
    })
  })
}
