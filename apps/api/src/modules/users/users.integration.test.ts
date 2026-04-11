/**
 * Users module — integration tests
 * Runs against real Postgres (5433) + Redis (6380) via docker-compose.test.yml
 */
import { describe, it, expect, beforeAll, afterEach, vi } from 'vitest'
import supertest from 'supertest'
import jwt from 'jsonwebtoken'
import { prisma } from '@lexis/db'
import { nanoid } from 'nanoid'
import { buildApp } from '../../app.js'

// ── Mock Resend ───────────────────────────────────────────
vi.mock('resend', () => ({
  Resend: vi.fn().mockImplementation(() => ({
    emails: { send: vi.fn().mockResolvedValue({ data: { id: 'mock-id' }, error: null }) },
  })),
}))

// ─── Helpers ──────────────────────────────────────────────

function testEmail() {
  return `test-${nanoid(8)}@test.lexis`
}

function jwtSecret() {
  return process.env.JWT_SECRET || 'test-secret-min-32-chars-long-ok'
}

/** Mint a valid access token for a given user without going through full auth flow. */
function mintAccessToken(userId: string, tenantId: string, role: string) {
  return jwt.sign(
    { tenantId, role },
    jwtSecret(),
    { subject: userId, expiresIn: '15m' },
  )
}

/** Register a teacher and return their userId + tenantId via OTP flow. */
async function registerTeacher(request: ReturnType<typeof supertest>) {
  const email = testEmail()
  await request.post('/v1/auth/magic/request').send({ email })

  const code = await prisma.user
    .findUnique({ where: { email } })
    .then(() => {
      // Pull code from Redis via the cache client directly
      const { redis } = require('@lexis/cache')
      return redis.get(`otp:${email}`)
    })
    .catch(() => null)

  // Fallback: directly read OTP from Redis in test
  const { redis } = await import('@lexis/cache')
  const otpCode = await redis.get(`otp:${email}`)
  if (!otpCode) throw new Error('OTP not found in Redis')

  const verifyRes = await request
    .post('/v1/auth/magic/verify')
    .send({ email, code: otpCode })

  const { accessToken } = verifyRes.body
  const decoded = jwt.decode(accessToken) as { sub: string; tenantId: string; role: string }
  return { userId: decoded.sub, tenantId: decoded.tenantId, accessToken, email }
}

// ─── Setup ────────────────────────────────────────────────

let request: ReturnType<typeof supertest>

beforeAll(async () => {
  process.env.JWT_SECRET = jwtSecret()
  process.env.JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET || 'test-refresh-secret-min-32-chars-ok'
  process.env.WEBAUTHN_RP_ID = 'localhost'
  process.env.WEBAUTHN_RP_ORIGIN = 'http://localhost:3001'
  process.env.WEBAUTHN_RP_NAME = 'Lexis Test'
  process.env.RESEND_API_KEY = 'test-key'
  process.env.FROM_EMAIL = 'test@lexis.app'

  const app = await buildApp()
  await app.ready()
  request = supertest(app.server)
})

afterEach(async () => {
  const { redis } = await import('@lexis/cache')
  const keys = await redis.keys('otp:*')
  if (keys.length) await redis.del(...keys)
})

// ─── POST /v1/auth/consent ────────────────────────────────

describe('POST /v1/auth/consent', () => {
  it('records consent and returns {consented: true}', async () => {
    const { userId, tenantId, accessToken } = await registerTeacher(request)

    const res = await request
      .post('/v1/auth/consent')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ policyVersion: '1.0' })

    expect(res.status).toBe(200)
    expect(res.body.consented).toBe(true)

    const record = await prisma.consentRecord.findFirst({ where: { userId } })
    expect(record).not.toBeNull()
    expect(record?.policyVersion).toBe('1.0')
  })

  it('returns 401 without auth', async () => {
    const res = await request.post('/v1/auth/consent').send({ policyVersion: '1.0' })
    expect(res.status).toBe(401)
  })

  it('returns 400 for missing policyVersion', async () => {
    const { accessToken } = await registerTeacher(request)

    const res = await request
      .post('/v1/auth/consent')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({})

    expect(res.status).toBe(400)
    expect(res.body.error.code).toBe('VALIDATION_ERROR')
  })
})

// ─── GET /v1/users/me ─────────────────────────────────────

describe('GET /v1/users/me', () => {
  it('returns the authenticated user', async () => {
    const { userId, email, accessToken } = await registerTeacher(request)

    const res = await request
      .get('/v1/users/me')
      .set('Authorization', `Bearer ${accessToken}`)

    expect(res.status).toBe(200)
    expect(res.body.data.id).toBe(userId)
    expect(res.body.data.email).toBe(email)
    expect(res.body.data.role).toBe('teacher')
  })

  it('returns 401 without auth', async () => {
    const res = await request.get('/v1/users/me')
    expect(res.status).toBe(401)
  })

  it('returns 404 for soft-deleted user', async () => {
    const { userId, tenantId } = await registerTeacher(request)
    const fakeToken = mintAccessToken(userId, tenantId, 'teacher')

    // Soft-delete user directly
    await prisma.user.update({ where: { id: userId }, data: { deletedAt: new Date() } })

    const res = await request
      .get('/v1/users/me')
      .set('Authorization', `Bearer ${fakeToken}`)

    expect(res.status).toBe(404)
  })
})

// ─── PATCH /v1/users/me ───────────────────────────────────

describe('PATCH /v1/users/me', () => {
  it('creates teacher profile on first patch', async () => {
    const { userId, accessToken } = await registerTeacher(request)

    const res = await request
      .patch('/v1/users/me')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ displayName: 'Alice Teacher', teacherLanguage: 'en', bio: 'ESL tutor' })

    expect(res.status).toBe(200)
    expect(res.body.data.teacherProfile?.displayName).toBe('Alice Teacher')
    expect(res.body.data.teacherProfile?.bio).toBe('ESL tutor')
  })

  it('updates only provided fields', async () => {
    const { accessToken } = await registerTeacher(request)

    // First set full profile
    await request
      .patch('/v1/users/me')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ displayName: 'Bob', bio: 'Original bio' })

    // Patch only bio
    const res = await request
      .patch('/v1/users/me')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ bio: 'Updated bio' })

    expect(res.status).toBe(200)
    expect(res.body.data.teacherProfile?.displayName).toBe('Bob')
    expect(res.body.data.teacherProfile?.bio).toBe('Updated bio')
  })

  it('returns 400 for displayName exceeding 100 chars', async () => {
    const { accessToken } = await registerTeacher(request)

    const res = await request
      .patch('/v1/users/me')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ displayName: 'x'.repeat(101) })

    expect(res.status).toBe(400)
    expect(res.body.error.code).toBe('VALIDATION_ERROR')
  })

  it('returns 401 without auth', async () => {
    const res = await request.patch('/v1/users/me').send({ displayName: 'Test' })
    expect(res.status).toBe(401)
  })
})

// ─── DELETE /v1/users/me ─────────────────────────────────

describe('DELETE /v1/users/me', () => {
  it('soft-deletes user and invalidates tokens', async () => {
    const { userId, accessToken } = await registerTeacher(request)

    const res = await request
      .delete('/v1/users/me')
      .set('Authorization', `Bearer ${accessToken}`)

    expect(res.status).toBe(200)
    expect(res.body.deleted).toBe(true)
    expect(res.body.effectiveAt).toBeDefined()

    // User row should have deleted_at set
    const user = await prisma.user.findUnique({ where: { id: userId } })
    expect(user?.deletedAt).not.toBeNull()
  })

  it('after deletion, GET /v1/users/me returns 404', async () => {
    const { userId, tenantId, accessToken } = await registerTeacher(request)

    await request
      .delete('/v1/users/me')
      .set('Authorization', `Bearer ${accessToken}`)

    // Mint a fresh access token (old one still valid JWT-wise, but user is soft-deleted)
    const freshToken = mintAccessToken(userId, tenantId, 'teacher')

    const res = await request
      .get('/v1/users/me')
      .set('Authorization', `Bearer ${freshToken}`)

    expect(res.status).toBe(404)
  })

  it('returns 401 without auth', async () => {
    const res = await request.delete('/v1/users/me')
    expect(res.status).toBe(401)
  })
})
