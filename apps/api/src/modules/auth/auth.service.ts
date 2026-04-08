import { nanoid } from 'nanoid'
import { prisma } from '@lexis/db'
import { logger } from '@lexis/logger'
import type { RegistrationResponseJSON, AuthenticationResponseJSON } from '@simplewebauthn/types'
import * as jwtService from './jwt.service.js'
import * as otpService from './otp.service.js'
import * as passkeyService from './passkey.service.js'

const log = logger('auth-service')

export type TokenPair = { accessToken: string; refreshToken: string }

// ─── Tenant auto-creation ─────────────────────────────────

async function ensureTeacherSetup(userId: string) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: { tenant: true },
  })

  if (!user) throw Object.assign(new Error('User not found'), { statusCode: 404 })
  if (user.tenantId) return user // Tenant already set up

  // First registration: create tenant + free subscription
  const emailPrefix = user.email.split('@')[0] ?? 'teacher'
  const slug = nanoid(12)

  const tenant = await prisma.tenant.create({
    data: { name: emailPrefix, slug },
  })

  await prisma.subscription.create({
    data: {
      tenantId: tenant.id,
      planSlug: 'free',
      studentLimit: 3,
      lessonPlanLimit: 5,
      aiCreditsRemaining: 0,
    },
  })

  const updated = await prisma.user.update({
    where: { id: userId },
    data: { tenantId: tenant.id },
  })

  log.info({ userId, tenantId: tenant.id }, 'Tenant auto-created for teacher')
  return updated
}

async function issueTokenPair(userId: string): Promise<TokenPair> {
  const user = await prisma.user.findUnique({ where: { id: userId } })
  if (!user) throw Object.assign(new Error('User not found'), { statusCode: 404 })
  if (!user.tenantId) throw Object.assign(new Error('User has no tenant'), { statusCode: 500 })

  const [refreshToken] = await Promise.all([jwtService.signRefreshToken(userId)])
  const accessToken = jwtService.signAccessToken({
    userId,
    tenantId: user.tenantId,
    role: user.role as jwtService.Role,
  })

  return { accessToken, refreshToken }
}

// ─── OTP / Magic link ─────────────────────────────────────

export async function requestMagicLink(email: string): Promise<void> {
  // Upsert user: create as teacher if first time, otherwise use existing
  let user = await prisma.user.findUnique({ where: { email } })
  if (!user) {
    user = await prisma.user.create({ data: { email, role: 'teacher' } })
    log.info({ email }, 'New teacher user created via OTP request')
  }

  await otpService.requestOtp(email)
}

export async function verifyMagicLink(
  email: string,
  code: string,
): Promise<TokenPair> {
  const valid = await otpService.verifyOtp(email, code)
  if (!valid) {
    throw Object.assign(new Error('Invalid or expired login code'), { statusCode: 401 })
  }

  let user = await prisma.user.findUnique({ where: { email } })
  if (!user) {
    user = await prisma.user.create({ data: { email, role: 'teacher' } })
  }

  if (user.role === 'teacher') {
    user = await ensureTeacherSetup(user.id)
  }

  return issueTokenPair(user.id)
}

// ─── Passkeys ────────────────────────────────────────────

export async function passkeyRegisterBegin(email: string) {
  // Upsert user so we have a userId for the challenge
  let user = await prisma.user.findUnique({ where: { email } })
  if (!user) {
    user = await prisma.user.create({ data: { email, role: 'teacher' } })
  }

  const options = await passkeyService.beginRegistration(user.id, email)
  return { userId: user.id, options }
}

export async function passkeyRegisterComplete(
  userId: string,
  response: RegistrationResponseJSON,
  deviceLabel?: string,
): Promise<TokenPair> {
  await passkeyService.completeRegistration(userId, response, deviceLabel)

  const user = await prisma.user.findUnique({ where: { id: userId } })
  if (!user) throw Object.assign(new Error('User not found'), { statusCode: 404 })

  if (user.role === 'teacher') {
    await ensureTeacherSetup(userId)
  }

  return issueTokenPair(userId)
}

export async function passkeyLoginBegin(email: string) {
  return passkeyService.beginAuthentication(email)
}

export async function passkeyLoginComplete(
  email: string,
  response: AuthenticationResponseJSON,
): Promise<TokenPair> {
  const user = await passkeyService.completeAuthentication(email, response)
  return issueTokenPair(user.id)
}

// ─── Token management ────────────────────────────────────

export async function refreshTokens(refreshToken: string): Promise<TokenPair> {
  const userId = await jwtService.consumeRefreshToken(refreshToken)
  return issueTokenPair(userId)
}

export async function logout(refreshToken: string): Promise<void> {
  await jwtService.logout(refreshToken)
}

// ─── Passkey management ──────────────────────────────────

export async function listPasskeys(userId: string) {
  return passkeyService.listPasskeys(userId)
}

export async function deletePasskey(
  userId: string,
  credentialId: string,
): Promise<void> {
  await passkeyService.deletePasskey(userId, credentialId)
}
