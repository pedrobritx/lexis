// Day 8 stub — full implementation pending (activity CRUD, type registry, validation)
import type { FastifyInstance } from 'fastify'

/** Routes mounted at /v1/lessons/:lessonId — list activities for a lesson */
export async function lessonActivitiesRoutes(_app: FastifyInstance): Promise<void> {}

/** Routes mounted at /v1/activities — activity CRUD + validate */
export async function activitiesRoutes(_app: FastifyInstance): Promise<void> {}
