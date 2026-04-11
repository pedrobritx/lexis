import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { authenticate } from '../../plugins/authenticate.js'
import * as placementService from './placement.service.js'
import type { ApiError } from '@lexis/types'

// ─── Request schemas ──────────────────────────────────────

const SubmitSchema = z.object({
  answers: z.record(z.string(), z.string()),
})

// ─── Validation helper ────────────────────────────────────

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

// ─── Plugin ───────────────────────────────────────────────

export async function placementRoutes(fastify: FastifyInstance) {
  /**
   * GET /v1/placement/test
   * Returns all 15 questions (without correct answers).
   * Any authenticated user may fetch the test to preview it.
   */
  fastify.get('/test', { preHandler: [authenticate] }, async (_request, reply) => {
    return reply.send({ data: placementService.getTest() })
  })

  /**
   * POST /v1/placement/submit
   * Scores the student's answers, persists the result, updates cefr_level.
   * Students only.
   */
  fastify.post('/submit', { preHandler: [authenticate] }, async (request, reply) => {
    if (request.user.role !== 'student') {
      return reply.status(403).send({
        error: { code: 'FORBIDDEN', message: 'Only students can submit placement tests' },
      })
    }

    const body = validate(SubmitSchema, request.body, reply)
    if (!body) return

    const result = await placementService.submit(
      request.user.userId,
      request.user.tenantId,
      body,
    )
    return reply.status(201).send({ data: result })
  })

  /**
   * POST /v1/placement/skip
   * Records a skipped test; does NOT update the student's cefr_level.
   * Students only.
   */
  fastify.post('/skip', { preHandler: [authenticate] }, async (request, reply) => {
    if (request.user.role !== 'student') {
      return reply.status(403).send({
        error: {
          code: 'FORBIDDEN',
          message: 'Only students can skip the placement test',
        },
      })
    }

    const result = await placementService.skip(request.user.userId, request.user.tenantId)
    return reply.status(201).send({ data: result })
  })

  /**
   * GET /v1/placement/history
   * Returns all placement test records for the authenticated student,
   * newest first. Each item includes a `skipped` flag.
   * Students only.
   */
  fastify.get('/history', { preHandler: [authenticate] }, async (request, reply) => {
    if (request.user.role !== 'student') {
      return reply.status(403).send({
        error: {
          code: 'FORBIDDEN',
          message: 'Only students can view placement test history',
        },
      })
    }

    const history = await placementService.getHistory(request.user.userId)
    return reply.send({ data: history })
  })
}
