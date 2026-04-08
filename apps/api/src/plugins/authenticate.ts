import type { FastifyRequest, FastifyReply } from 'fastify'
import { tenantContext } from '@lexis/db'
import { verifyAccessToken, type Role } from '../modules/auth/jwt.service.js'

declare module 'fastify' {
  interface FastifyRequest {
    user: {
      userId: string
      tenantId: string
      role: Role
    }
  }
}

/**
 * Fastify preHandler hook — verifies the Bearer JWT and:
 * 1. Attaches `req.user` with { userId, tenantId, role }
 * 2. Enters the AsyncLocalStorage tenant context for Prisma middleware
 *
 * Apply to individual routes or prefix-level via `{ preHandler: [authenticate] }`.
 */
export async function authenticate(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const header = request.headers.authorization
  if (!header?.startsWith('Bearer ')) {
    return reply.status(401).send({ error: { code: 'UNAUTHORIZED', message: 'Missing or invalid authorization header' } })
  }

  const token = header.slice(7)

  let payload: ReturnType<typeof verifyAccessToken>
  try {
    payload = verifyAccessToken(token)
  } catch {
    return reply.status(401).send({ error: { code: 'UNAUTHORIZED', message: 'Invalid or expired access token' } })
  }

  request.user = payload

  // Set tenant context for Prisma middleware — stays active for this request's async chain
  tenantContext.enterWith({ tenantId: payload.tenantId })
}
