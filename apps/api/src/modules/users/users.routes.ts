import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { authenticate } from '../../plugins/authenticate.js'
import * as usersService from './users.service.js'
import type { ApiError } from '@lexis/types'

// ─── Request schemas ──────────────────────────────────────

const PatchTeacherSchema = z.object({
  displayName: z.string().min(1).max(100).optional(),
  teacherLanguage: z.string().min(2).max(10).optional(),
  bio: z.string().max(500).optional(),
})

const PatchStudentSchema = z.object({
  displayName: z.string().min(1).max(100).optional(),
  timezone: z.string().min(1).max(100).optional(),
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

export async function usersRoutes(fastify: FastifyInstance) {
  fastify.get(
    '/me',
    { preHandler: [authenticate] },
    async (request, reply) => {
      const user = await usersService.getMe(request.user.userId)
      return reply.send({ data: user })
    },
  )

  fastify.patch(
    '/me',
    { preHandler: [authenticate] },
    async (request, reply) => {
      const { role } = request.user

      const schema = role === 'teacher' ? PatchTeacherSchema : PatchStudentSchema
      const body = validate(schema, request.body, reply)
      if (!body) return

      const user = await usersService.patchMe(
        request.user.userId,
        request.user.tenantId,
        role,
        body,
      )
      return reply.send({ data: user })
    },
  )

  fastify.delete(
    '/me',
    { preHandler: [authenticate] },
    async (request, reply) => {
      const effectiveAt = await usersService.deleteMe(request.user.userId)
      return reply.send({ deleted: true, effectiveAt: effectiveAt.toISOString() })
    },
  )
}
