/**
 * Enrollments module — Phase 1 Day 9
 *
 * Classroom CRUD, enrollment create/delete, session management.
 * Stubs registered here so app.ts compiles cleanly from Day 1.
 */
import type { FastifyInstance } from 'fastify'

export async function classroomsRoutes(_fastify: FastifyInstance): Promise<void> {
  // Day 9 — Classroom CRUD, POST /v1/classrooms/:id/enroll
}

export async function sessionsRoutes(_fastify: FastifyInstance): Promise<void> {
  // Day 9 — Session CRUD, auto-populate session_participants
}
