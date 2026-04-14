/**
 * Activities module — Phase 1 Days 8 & 11
 *
 * Day 8:  Activity CRUD, type registry, validation (POST /v1/activities)
 * Day 11: Lesson delivery — ordered activity list (GET /v1/lessons/:id/activities)
 *
 * Full implementations built in their respective sprint days.
 * Stubs registered here so app.ts compiles cleanly from Day 1.
 */
import type { FastifyInstance } from 'fastify'

export async function lessonActivitiesRoutes(_fastify: FastifyInstance): Promise<void> {
  // Day 11 — GET /v1/lessons/:id/activities
}

export async function activitiesRoutes(_fastify: FastifyInstance): Promise<void> {
  // Day 8 — CRUD + POST /v1/activities/:id/validate
}
