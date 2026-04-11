import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { authenticate } from '../../plugins/authenticate.js'
import * as srsService from './srs.service.js'
import type { ApiError } from '@lexis/types'

// ─── Schemas ──────────────────────────────────────────────

const ReviewBodySchema = z.object({
  quality: z.number().int().min(0).max(5),
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

// ─── Routes ───────────────────────────────────────────────

export async function srsRoutes(fastify: FastifyInstance) {
  /**
   * GET /v1/srs/queue
   * Return all SRS items due today for the authenticated student.
   * Items include the full activity content needed to render the review UI.
   * Students only.
   */
  fastify.get('/queue', { preHandler: [authenticate] }, async (request, reply) => {
    if (request.user.role !== 'student') {
      return reply.status(403).send({
        error: { code: 'FORBIDDEN', message: 'Only students can access the SRS queue' },
      })
    }

    try {
      const queue = await srsService.getQueue(request.user.userId, request.user.tenantId)
      return reply.send({ data: queue, count: queue.length })
    } catch (err) {
      return handleError(err, reply)
    }
  })

  /**
   * POST /v1/srs/items/:id/review
   * Log a review for a single SRS item.
   *
   * Body: { quality: 0-5 }
   *   0 = complete blackout
   *   3 = correct with difficulty
   *   5 = perfect response
   *
   * Response includes: updated interval, ease_factor, next review date,
   * whether content was stale (contentChanged), and current streak.
   * Students only.
   */
  fastify.post('/items/:id/review', { preHandler: [authenticate] }, async (request, reply) => {
    if (request.user.role !== 'student') {
      return reply.status(403).send({
        error: { code: 'FORBIDDEN', message: 'Only students can submit SRS reviews' },
      })
    }

    const { id } = request.params as { id: string }
    const body = validate(ReviewBodySchema, request.body, reply)
    if (!body) return

    try {
      const result = await srsService.logReview(
        id,
        request.user.userId,
        request.user.tenantId,
        body,
      )
      return reply.status(201).send({ data: result })
    } catch (err) {
      return handleError(err, reply)
    }
  })
}
