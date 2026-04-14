import type { FastifyInstance } from 'fastify'
import { authenticate } from '../../plugins/authenticate.js'
import { logAttempt, getLessonProgress } from './progress.service.js'

export async function progressRoutes(app: FastifyInstance): Promise<void> {
  // POST /v1/progress/activities/:id/attempt
  app.post<{
    Params: { id: string }
    Body: { correct: boolean; score?: number; response?: unknown }
  }>(
    '/activities/:id/attempt',
    { preHandler: authenticate },
    async (req, reply) => {
      const result = await logAttempt(
        req.params.id,
        req.user.userId,
        req.user.tenantId,
        req.body,
      )
      return reply.code(201).send(result)
    },
  )

  // GET /v1/progress/lessons/:id
  app.get<{ Params: { id: string } }>(
    '/lessons/:id',
    { preHandler: authenticate },
    async (req, reply) => {
      const progress = await getLessonProgress(req.params.id, req.user.userId)
      if (!progress) return reply.code(404).send({ error: 'No progress record found' })
      return progress
    },
  )
}
