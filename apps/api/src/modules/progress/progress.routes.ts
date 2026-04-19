import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { authenticate } from '../../plugins/authenticate.js'
import { logAttempt, getLessonProgress } from './progress.service.js'

// ─── Schemas ──────────────────────────────────────────────

const AttemptBodySchema = z.object({
  response: z.unknown(),
})

// ─── Helpers ──────────────────────────────────────────────

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

// ─── Routes ───────────────────────────────────────────────

export async function progressRoutes(app: FastifyInstance): Promise<void> {
  /**
   * POST /v1/progress/activities/:id/attempt
   * Submit a student's attempt for an activity.
   * - Students only (teachers get 403).
   * - Server validates the response server-side via validateAnswer().
   * - Awards XP for correct answers and auto-completes lessons.
   */
  app.post(
    '/activities/:id/attempt',
    { preHandler: [authenticate] },
    async (req, reply) => {
      if (req.user.role !== 'student') {
        return reply.status(403).send({
          error: { code: 'FORBIDDEN', message: 'Only students can submit attempts' },
        })
      }

      const { id: activityId } = req.params as { id: string }

      const parsed = AttemptBodySchema.safeParse(req.body)
      if (!parsed.success) {
        return reply.status(400).send({
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Invalid request body',
            details: parsed.error.flatten(),
          },
        })
      }

      try {
        const result = await logAttempt(
          activityId,
          req.user.userId,
          req.user.tenantId,
          { response: parsed.data.response },
        )
        return reply.status(201).send({ data: result })
      } catch (err) {
        return handleError(err, reply)
      }
    },
  )

  /**
   * GET /v1/progress/lessons/:id
   * Get a student's progress for a lesson.
   * - Students query their own progress (no params required).
   * - Teachers must supply ?studentId= (400 if missing).
   */
  app.get(
    '/lessons/:id',
    { preHandler: [authenticate] },
    async (req, reply) => {
      const { id: lessonId } = req.params as { id: string }
      const { studentId: studentIdParam } = req.query as { studentId?: string }

      let targetStudentId: string

      if (req.user.role === 'teacher') {
        if (!studentIdParam) {
          return reply.status(400).send({
            error: {
              code: 'VALIDATION_ERROR',
              message: 'studentId query parameter is required for teachers',
            },
          })
        }
        targetStudentId = studentIdParam
      } else {
        // Students can only see their own progress
        targetStudentId = req.user.userId
      }

      try {
        const progress = await getLessonProgress(lessonId, targetStudentId, req.user.tenantId)
        return reply.send({ data: progress })
      } catch (err) {
        return handleError(err, reply)
      }
    },
  )
}
