/**
 * Progress module — Phase 1 Day 10
 *
 * Lesson progress tracking, activity attempt logging, XP award.
 * Emits lesson.completed + activity.correct events for SRS and gamification.
 * Stubs registered here so app.ts compiles cleanly from Day 1.
 */
import type { FastifyInstance } from 'fastify'

export async function progressRoutes(_fastify: FastifyInstance): Promise<void> {
  // Day 10 — POST /v1/progress/activities/:id/attempt, lesson auto-complete
}
