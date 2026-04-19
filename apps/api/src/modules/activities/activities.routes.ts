import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { authenticate } from '../../plugins/authenticate.js'
import * as activitiesService from './activities.service.js'
import type { ApiError } from '@lexis/types'

// ─── Schemas ──────────────────────────────────────────────

const ActivityTypeEnum = z.enum(['cloze', 'mcq', 'matching', 'ordering', 'open_writing', 'listening'])
const SrsModeEnum = z.enum(['flashcard', 'mini_lesson'])
const VisibilityEnum = z.enum(['private', 'public_template'])

const CreateActivitySchema = z.object({
  type: ActivityTypeEnum,
  title: z.string().min(1).max(255),
  content: z.unknown().refine((v) => v !== undefined, { message: 'content is required' }),
  scoringRules: z.unknown().optional(),
  skillTags: z.array(z.string()).optional(),
  srsMode: SrsModeEnum.optional(),
  imageUrl: z.string().url().optional(),
  visibility: VisibilityEnum.optional(),
})

const UpdateActivitySchema = z.object({
  title: z.string().min(1).max(255).optional(),
  content: z.unknown().optional(),
  scoringRules: z.unknown().optional(),
  skillTags: z.array(z.string()).optional(),
  srsMode: SrsModeEnum.optional(),
  imageUrl: z.string().url().optional(),
  visibility: VisibilityEnum.optional(),
})

const ValidateSchema = z.object({
  response: z.unknown().refine((v) => v !== undefined, { message: 'response is required' }),
})

// ─── Helpers ──────────────────────────────────────────────

function validate<T>(
  schema: z.ZodType<T>,
  data: unknown,
  reply: { status: (code: number) => { send: (body: ApiError) => void } },
): T | null {
  const result = schema.safeParse(data)
  if (!result.success) {
    reply.status(400).send({
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Invalid request body',
        details: result.error.flatten(),
      },
    })
    return null
  }
  return result.data
}

function handleError(
  err: unknown,
  reply: {
    status: (code: number) => { send: (body: unknown) => void }
    send: (body: unknown) => void
  },
) {
  const e = err as { statusCode?: number; code?: string; message?: string }
  const statusCode = e.statusCode ?? 500
  return reply.status(statusCode).send({
    error: {
      code: e.code ?? (statusCode === 404 ? 'NOT_FOUND' : 'INTERNAL_ERROR'),
      message: e.message ?? 'An unexpected error occurred',
    },
  })
}

// ─── /v1/lessons/:lessonId/activities ────────────────────
//
// Mounted at prefix /v1/lessons — handles activity listing
// and creation scoped to a lesson.

export async function lessonActivitiesRoutes(fastify: FastifyInstance) {
  /**
   * GET /v1/lessons/:lessonId/activities
   * List all activities for a lesson, ordered by position.
   *
   * Teachers receive the full activity (including answer keys).
   * Students receive answer-key-stripped content via stripAnswerKey().
   */
  fastify.get(
    '/:lessonId/activities',
    { preHandler: [authenticate] },
    async (request, reply) => {
      const { lessonId } = request.params as { lessonId: string }

      try {
        const activities = await activitiesService.listActivities(
          lessonId,
          request.user.tenantId,
        )

        // Strip answer keys for students
        if (request.user.role === 'student') {
          const stripped = activities.map((a) => ({
            ...a,
            content: activitiesService.stripAnswerKey(
              a.type as activitiesService.ActivityType,
              a.content,
            ),
            // Remove scoringRules entirely for students
            scoringRules: undefined,
          }))
          return reply.send({ data: stripped })
        }

        return reply.send({ data: activities })
      } catch (err) {
        return handleError(err, reply)
      }
    },
  )

  /**
   * POST /v1/lessons/:lessonId/activities
   * Create an activity inside a lesson.
   * Teachers only.
   */
  fastify.post(
    '/:lessonId/activities',
    { preHandler: [authenticate] },
    async (request, reply) => {
      if (request.user.role !== 'teacher') {
        return reply.status(403).send({
          error: { code: 'FORBIDDEN', message: 'Only teachers can create activities' },
        })
      }

      const { lessonId } = request.params as { lessonId: string }
      const body = validate(CreateActivitySchema, request.body, reply)
      if (!body) return

      try {
        const activity = await activitiesService.createActivity(
          lessonId,
          request.user.tenantId,
          body as activitiesService.CreateActivityInput,
        )
        return reply.status(201).send({ data: activity })
      } catch (err) {
        return handleError(err, reply)
      }
    },
  )
}

// ─── /v1/activities/:id ────────────────────────────────────
//
// Mounted at prefix /v1/activities — handles get/update/delete
// on individual activities, and answer validation.

export async function activitiesRoutes(fastify: FastifyInstance) {
  /**
   * GET /v1/activities/:id
   * Retrieve a single activity.
   * Teachers get full content; students get answer-key-stripped content.
   */
  fastify.get(
    '/:id',
    { preHandler: [authenticate] },
    async (request, reply) => {
      const { id } = request.params as { id: string }

      try {
        const activity = await activitiesService.getActivity(id, request.user.tenantId)

        if (request.user.role === 'student') {
          return reply.send({
            data: {
              ...activity,
              content: activitiesService.stripAnswerKey(
                activity.type as activitiesService.ActivityType,
                activity.content,
              ),
              scoringRules: undefined,
            },
          })
        }

        return reply.send({ data: activity })
      } catch (err) {
        return handleError(err, reply)
      }
    },
  )

  /**
   * PATCH /v1/activities/:id
   * Update an activity. Increments version on content/scoringRules change.
   * Teachers only.
   */
  fastify.patch(
    '/:id',
    { preHandler: [authenticate] },
    async (request, reply) => {
      if (request.user.role !== 'teacher') {
        return reply.status(403).send({
          error: { code: 'FORBIDDEN', message: 'Only teachers can update activities' },
        })
      }

      const { id } = request.params as { id: string }
      const body = validate(UpdateActivitySchema, request.body, reply)
      if (!body) return

      try {
        const activity = await activitiesService.updateActivity(
          id,
          request.user.tenantId,
          body,
        )
        return reply.send({ data: activity })
      } catch (err) {
        return handleError(err, reply)
      }
    },
  )

  /**
   * DELETE /v1/activities/:id
   * Soft-delete an activity.
   * Teachers only.
   */
  fastify.delete(
    '/:id',
    { preHandler: [authenticate] },
    async (request, reply) => {
      if (request.user.role !== 'teacher') {
        return reply.status(403).send({
          error: { code: 'FORBIDDEN', message: 'Only teachers can delete activities' },
        })
      }

      const { id } = request.params as { id: string }

      try {
        const result = await activitiesService.deleteActivity(id, request.user.tenantId)
        return reply.send({ data: result })
      } catch (err) {
        return handleError(err, reply)
      }
    },
  )

  /**
   * POST /v1/activities/:id/validate
   * Validate a student's answer for an activity.
   * Returns: { correct, score, requiresManualGrading, details? }
   *
   * Does NOT record the attempt — use POST /v1/progress/activities/:id/attempt
   * for that. This endpoint is for real-time feedback during lesson delivery.
   */
  fastify.post(
    '/:id/validate',
    { preHandler: [authenticate] },
    async (request, reply) => {
      const { id } = request.params as { id: string }
      const body = validate(ValidateSchema, request.body, reply)
      if (!body) return

      try {
        const activity = await activitiesService.getActivity(id, request.user.tenantId)
        const result = activitiesService.validateAnswer(
          activity.type as activitiesService.ActivityType,
          activity.content,
          activity.scoringRules,
          body.response,
        )
        return reply.send({ data: result })
      } catch (err) {
        return handleError(err, reply)
      }
    },
  )
}
