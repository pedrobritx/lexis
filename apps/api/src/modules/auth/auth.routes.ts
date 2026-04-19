import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { prisma } from '@lexis/db'
import { authenticate } from '../../plugins/authenticate.js'
import * as authService from './auth.service.js'
import type { ApiError } from '@lexis/types'

// ─── Request schemas ──────────────────────────────────────

const EmailSchema = z.object({ email: z.string().email() })
const OtpVerifySchema = z.object({ email: z.string().email(), code: z.string().length(6) })
const RefreshSchema = z.object({ refreshToken: z.string().min(1) })
const LogoutSchema = z.object({ refreshToken: z.string().min(1) })
const PasskeyRegisterBeginSchema = z.object({ email: z.string().email() })
const PasskeyRegisterCompleteSchema = z.object({
  userId: z.string().uuid(),
  response: z.object({}).passthrough(), // RegistrationResponseJSON
  deviceLabel: z.string().optional(),
})
const PasskeyLoginBeginSchema = z.object({ email: z.string().email() })
const PasskeyLoginCompleteSchema = z.object({
  email: z.string().email(),
  response: z.object({}).passthrough(), // AuthenticationResponseJSON
})
const ConsentSchema = z.object({
  policyVersion: z.string().min(1),
})

// ─── Validation helper ────────────────────────────────────

function validate<T>(schema: z.ZodType<T>, data: unknown, reply: { status: (code: number) => { send: (body: ApiError) => void } }): T | null {
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

export async function authRoutes(fastify: FastifyInstance) {
  // ── OTP / Magic link ──────────────────────────────────

  fastify.post('/magic/request', async (request, reply) => {
    const body = validate(EmailSchema, request.body, reply)
    if (!body) return
    await authService.requestMagicLink(body.email)
    return reply.send({ message: 'Code sent' })
  })

  fastify.post('/magic/verify', async (request, reply) => {
    const body = validate(OtpVerifySchema, request.body, reply)
    if (!body) return
    const tokens = await authService.verifyMagicLink(body.email, body.code)
    return reply.send(tokens)
  })

  // ── Passkey registration ──────────────────────────────

  fastify.post('/passkey/register/begin', async (request, reply) => {
    const body = validate(PasskeyRegisterBeginSchema, request.body, reply)
    if (!body) return
    const result = await authService.passkeyRegisterBegin(body.email)
    return reply.send(result)
  })

  fastify.post('/passkey/register/complete', async (request, reply) => {
    const body = validate(PasskeyRegisterCompleteSchema, request.body, reply)
    if (!body) return
    const tokens = await authService.passkeyRegisterComplete(
      body.userId,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      body.response as any,
      body.deviceLabel,
    )
    return reply.send(tokens)
  })

  // ── Passkey authentication ────────────────────────────

  fastify.post('/passkey/login/begin', async (request, reply) => {
    const body = validate(PasskeyLoginBeginSchema, request.body, reply)
    if (!body) return
    const result = await authService.passkeyLoginBegin(body.email)
    return reply.send(result)
  })

  fastify.post('/passkey/login/complete', async (request, reply) => {
    const body = validate(PasskeyLoginCompleteSchema, request.body, reply)
    if (!body) return
    const tokens = await authService.passkeyLoginComplete(
      body.email,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      body.response as any,
    )
    return reply.send(tokens)
  })

  // ── Token management ──────────────────────────────────

  fastify.post('/refresh', async (request, reply) => {
    const body = validate(RefreshSchema, request.body, reply)
    if (!body) return
    const tokens = await authService.refreshTokens(body.refreshToken)
    return reply.send(tokens)
  })

  fastify.post('/logout', async (request, reply) => {
    const body = validate(LogoutSchema, request.body, reply)
    if (!body) return
    await authService.logout(body.refreshToken)
    return reply.send({ message: 'Logged out' })
  })

  // ── Consent ───────────────────────────────────────────

  /**
   * POST /v1/auth/consent
   * Record that the authenticated user has accepted the current policy version.
   * Called once after first registration. Idempotent per policy version.
   */
  fastify.post('/consent', { preHandler: [authenticate] }, async (request, reply) => {
    const body = validate(ConsentSchema, request.body, reply)
    if (!body) return

    // Only record consent once per user + policy version
    const existing = await prisma.consentRecord.findFirst({
      where: { userId: request.user.userId, policyVersion: body.policyVersion },
    })

    if (!existing) {
      await prisma.consentRecord.create({
        data: {
          userId: request.user.userId,
          policyVersion: body.policyVersion,
          acceptedAt: new Date(),
          ipAddress: request.ip ?? 'unknown',
        },
      })
    }

    return reply.send({ consented: true })
  })

  // ── Passkey management (authenticated) ────────────────

  fastify.get(
    '/passkeys',
    { preHandler: [authenticate] },
    async (request, reply) => {
      const passkeys = await authService.listPasskeys(request.user.userId)
      return reply.send({ data: passkeys })
    },
  )

  fastify.delete(
    '/passkeys/:id',
    { preHandler: [authenticate] },
    async (request, reply) => {
      const { id } = request.params as { id: string }
      await authService.deletePasskey(request.user.userId, id)
      return reply.status(204).send()
    },
  )
}
