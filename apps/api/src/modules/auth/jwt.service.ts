import jwt from 'jsonwebtoken'
import { nanoid } from 'nanoid'
import { redis } from '@lexis/cache'
import { logger } from '@lexis/logger'

const log = logger('jwt-service')

// 30 days in seconds
const REFRESH_TTL = 60 * 60 * 24 * 30

export type Role = 'teacher' | 'student' | 'system'

export interface AccessTokenPayload {
  userId: string
  tenantId: string
  role: Role
}

interface RawAccessToken {
  sub: string
  tenantId: string
  role: Role
  exp: number
}

interface RawRefreshToken {
  sub: string
  jti: string
  exp: number
}

function accessSecret(): string {
  const secret = process.env.JWT_SECRET
  if (!secret) throw new Error('JWT_SECRET env var is required')
  return secret
}

function refreshSecret(): string {
  const secret = process.env.JWT_REFRESH_SECRET
  if (!secret) throw new Error('JWT_REFRESH_SECRET env var is required')
  return secret
}

export function signAccessToken(payload: AccessTokenPayload): string {
  return jwt.sign(
    { tenantId: payload.tenantId, role: payload.role },
    accessSecret(),
    { subject: payload.userId, expiresIn: '15m' },
  )
}

export async function signRefreshToken(userId: string): Promise<string> {
  const jti = nanoid()
  const token = jwt.sign({ jti }, refreshSecret(), {
    subject: userId,
    expiresIn: '30d',
  })

  await Promise.all([
    redis.set(`refresh:${jti}`, userId, 'EX', REFRESH_TTL),
    redis.sadd(`refresh:user:${userId}`, jti),
    redis.expire(`refresh:user:${userId}`, REFRESH_TTL),
  ])

  return token
}

export function verifyAccessToken(token: string): AccessTokenPayload {
  const decoded = jwt.verify(token, accessSecret()) as RawAccessToken
  return {
    userId: decoded.sub,
    tenantId: decoded.tenantId,
    role: decoded.role,
  }
}

/**
 * Consumes a refresh token and returns the userId.
 * Throws 401 on invalid, expired, or reused token.
 * The caller (auth.service) is responsible for re-issuing the full token pair.
 */
export async function consumeRefreshToken(refreshToken: string): Promise<string> {
  let decoded: RawRefreshToken
  try {
    decoded = jwt.verify(refreshToken, refreshSecret()) as RawRefreshToken
  } catch {
    throw Object.assign(new Error('Invalid refresh token'), { statusCode: 401 })
  }

  const { sub: userId, jti } = decoded

  // Consume the token — returns 0 if it was already deleted (reuse detection)
  const deleted = await redis.del(`refresh:${jti}`)
  await redis.srem(`refresh:user:${userId}`, jti)

  if (deleted === 0) {
    // Token was already consumed — possible theft: invalidate ALL tokens for this user
    log.warn({ userId }, 'Refresh token reuse detected — invalidating all tokens')
    await invalidateAllTokensForUser(userId)
    throw Object.assign(new Error('Refresh token reuse detected'), { statusCode: 401 })
  }

  return userId
}

export async function invalidateAllTokensForUser(userId: string): Promise<void> {
  const jtis = await redis.smembers(`refresh:user:${userId}`)
  const pipeline = redis.pipeline()
  for (const jti of jtis) {
    pipeline.del(`refresh:${jti}`)
  }
  pipeline.del(`refresh:user:${userId}`)
  await pipeline.exec()
}

export async function logout(refreshToken: string): Promise<void> {
  let decoded: RawRefreshToken
  try {
    decoded = jwt.verify(refreshToken, refreshSecret()) as RawRefreshToken
  } catch {
    // Already invalid — nothing to do
    return
  }

  const { sub: userId, jti } = decoded
  await Promise.all([
    redis.del(`refresh:${jti}`),
    redis.srem(`refresh:user:${userId}`, jti),
  ])
}
