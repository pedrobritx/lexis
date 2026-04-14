/**
 * Enrollments module — integration tests
 * Covers: classrooms CRUD, enroll/unenroll, sessions CRUD, participant auto-population
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

function jwtSecret() {
  return process.env.JWT_SECRET || 'test-secret-min-32-chars-long-ok'
}

function mintToken(userId: string, tenantId: string, role: string) {
  return jwt.sign({ tenantId, role }, jwtSecret(), {
    subject: userId,
    expiresIn: '15m',
  })
}

/** Register a teacher via OTP and return tokens. */
async function registerTeacher(request: ReturnType<typeof supertest>) {
  const email = `teacher-${nanoid(8)}@test.lexis`
  await request.post('/v1/auth/magic/request').send({ email })

  const { redis } = await import('@lexis/cache')
  const otpCode = await redis.get(`otp:${email}`)
  if (!otpCode) throw new Error('OTP not found in Redis')

  const verifyRes = await request
    .post('/v1/auth/magic/verify')
    .send({ email, code: otpCode })

  const { accessToken } = verifyRes.body
  const decoded = jwt.decode(accessToken) as { sub: string; tenantId: string; role: string }
  return { userId: decoded.sub, tenantId: decoded.tenantId, accessToken }
}

/** Create a student user directly under a tenant. */
async function createStudent(tenantId: string) {
  const user = await prisma.user.create({
    data: {
      email: `student-${nanoid(8)}@test.lexis`,
      role: 'student',
      tenantId,
    },
  })
  return { userId: user.id, accessToken: mintToken(user.id, tenantId, 'student') }
}

// ─── Setup ────────────────────────────────────────────────

let request: ReturnType<typeof supertest>

beforeAll(async () => {
  process.env.JWT_SECRET = jwtSecret()
  process.env.JWT_REFRESH_SECRET =
    process.env.JWT_REFRESH_SECRET || 'test-refresh-secret-min-32-chars-ok'
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

// ─── Classrooms CRUD ──────────────────────────────────────

describe('POST /v1/classrooms', () => {
  it('creates a classroom and returns 201', async () => {
    const { accessToken } = await registerTeacher(request)

    const res = await request
      .post('/v1/classrooms')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ name: 'Morning B1 Group' })

    expect(res.status).toBe(201)
    expect(res.body.data.name).toBe('Morning B1 Group')
    expect(res.body.data.status).toBe('active')
  })

  it('returns 403 for students', async () => {
    const { userId: teacherId, tenantId, accessToken: teacherToken } = await registerTeacher(request)

    // Need teacher token to look up teacher, but student token for the test
    const { userId: studentId } = await createStudent(tenantId)
    const studentToken = mintToken(studentId, tenantId, 'student')

    const res = await request
      .post('/v1/classrooms')
      .set('Authorization', `Bearer ${studentToken}`)
      .send({ name: 'Hacked classroom' })

    expect(res.status).toBe(403)
    void teacherId // suppress unused warning
    void teacherToken
  })

  it('returns 400 for missing name', async () => {
    const { accessToken } = await registerTeacher(request)

    const res = await request
      .post('/v1/classrooms')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({})

    expect(res.status).toBe(400)
    expect(res.body.error.code).toBe('VALIDATION_ERROR')
  })

  it('returns 401 without auth', async () => {
    const res = await request.post('/v1/classrooms').send({ name: 'Test' })
    expect(res.status).toBe(401)
  })
})

describe('GET /v1/classrooms', () => {
  it("returns only the teacher's classrooms", async () => {
    const { userId, tenantId, accessToken } = await registerTeacher(request)

    // Create two classrooms
    await prisma.classroom.createMany({
      data: [
        { tenantId, teacherId: userId, name: 'Class A' },
        { tenantId, teacherId: userId, name: 'Class B' },
      ],
    })

    const res = await request
      .get('/v1/classrooms')
      .set('Authorization', `Bearer ${accessToken}`)

    expect(res.status).toBe(200)
    const names = res.body.data.map((c: { name: string }) => c.name)
    expect(names).toContain('Class A')
    expect(names).toContain('Class B')
  })

  it('does not return archived classrooms', async () => {
    const { userId, tenantId, accessToken } = await registerTeacher(request)

    await prisma.classroom.create({
      data: { tenantId, teacherId: userId, name: 'OldClass', status: 'archived' },
    })

    const res = await request
      .get('/v1/classrooms')
      .set('Authorization', `Bearer ${accessToken}`)

    expect(res.status).toBe(200)
    const names = res.body.data.map((c: { name: string }) => c.name)
    expect(names).not.toContain('OldClass')
  })
})

describe('GET /v1/classrooms/:id', () => {
  it('returns classroom with enrollments', async () => {
    const { userId, tenantId, accessToken } = await registerTeacher(request)

    const classroom = await prisma.classroom.create({
      data: { tenantId, teacherId: userId, name: 'Detail Class' },
    })
    const { userId: studentId } = await createStudent(tenantId)
    await prisma.enrollment.create({
      data: { classroomId: classroom.id, studentId, tenantId },
    })

    const res = await request
      .get(`/v1/classrooms/${classroom.id}`)
      .set('Authorization', `Bearer ${accessToken}`)

    expect(res.status).toBe(200)
    expect(res.body.data.name).toBe('Detail Class')
    expect(res.body.data.enrollments).toHaveLength(1)
    expect(res.body.data.enrollments[0].studentId).toBe(studentId)
  })

  it('returns 404 for unknown classroom', async () => {
    const { accessToken } = await registerTeacher(request)

    const res = await request
      .get('/v1/classrooms/00000000-0000-0000-0000-000000000000')
      .set('Authorization', `Bearer ${accessToken}`)

    expect(res.status).toBe(404)
  })
})

describe('PATCH /v1/classrooms/:id', () => {
  it('updates classroom name', async () => {
    const { userId, tenantId, accessToken } = await registerTeacher(request)

    const classroom = await prisma.classroom.create({
      data: { tenantId, teacherId: userId, name: 'Old Name' },
    })

    const res = await request
      .patch(`/v1/classrooms/${classroom.id}`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ name: 'New Name' })

    expect(res.status).toBe(200)
    expect(res.body.data.name).toBe('New Name')
  })

  it('can pause a classroom', async () => {
    const { userId, tenantId, accessToken } = await registerTeacher(request)

    const classroom = await prisma.classroom.create({
      data: { tenantId, teacherId: userId, name: 'Pausable' },
    })

    const res = await request
      .patch(`/v1/classrooms/${classroom.id}`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ status: 'paused' })

    expect(res.status).toBe(200)
    expect(res.body.data.status).toBe('paused')
  })
})

describe('DELETE /v1/classrooms/:id', () => {
  it('archives the classroom (status = archived)', async () => {
    const { userId, tenantId, accessToken } = await registerTeacher(request)

    const classroom = await prisma.classroom.create({
      data: { tenantId, teacherId: userId, name: 'Archive Me' },
    })

    const res = await request
      .delete(`/v1/classrooms/${classroom.id}`)
      .set('Authorization', `Bearer ${accessToken}`)

    expect(res.status).toBe(200)
    expect(res.body.data.status).toBe('archived')

    const row = await prisma.classroom.findUnique({ where: { id: classroom.id } })
    expect(row?.status).toBe('archived')
  })
})

// ─── Enroll / Unenroll ───────────────────────────────────

describe('POST /v1/classrooms/:id/enroll', () => {
  it('enrolls a student and returns 201', async () => {
    const { userId, tenantId, accessToken } = await registerTeacher(request)

    const classroom = await prisma.classroom.create({
      data: { tenantId, teacherId: userId, name: 'Enroll Test' },
    })
    const { userId: studentId } = await createStudent(tenantId)

    const res = await request
      .post(`/v1/classrooms/${classroom.id}/enroll`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ studentId })

    expect(res.status).toBe(201)
    expect(res.body.data.studentId).toBe(studentId)
    expect(res.body.data.classroomId).toBe(classroom.id)
  })

  it('returns 409 if student already enrolled', async () => {
    const { userId, tenantId, accessToken } = await registerTeacher(request)

    const classroom = await prisma.classroom.create({
      data: { tenantId, teacherId: userId, name: 'Duplicate Enroll' },
    })
    const { userId: studentId } = await createStudent(tenantId)

    await prisma.enrollment.create({ data: { classroomId: classroom.id, studentId, tenantId } })

    const res = await request
      .post(`/v1/classrooms/${classroom.id}/enroll`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ studentId })

    expect(res.status).toBe(409)
    expect(res.body.error.code).toBe('ALREADY_ENROLLED')
  })

  it('returns 402 when student billing limit is exceeded', async () => {
    const { userId, tenantId, accessToken } = await registerTeacher(request)

    // Force the subscription student_limit to 0 so the next enroll hits the cap
    await prisma.subscription.update({
      where: { tenantId },
      data: { studentLimit: 0 },
    })

    const classroom = await prisma.classroom.create({
      data: { tenantId, teacherId: userId, name: 'Limit Test' },
    })
    const { userId: studentId } = await createStudent(tenantId)

    const res = await request
      .post(`/v1/classrooms/${classroom.id}/enroll`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ studentId })

    expect(res.status).toBe(402)
    expect(res.body.error.code).toBe('billing/limit_reached')
  })

  it('returns 404 for unknown student', async () => {
    const { userId, tenantId, accessToken } = await registerTeacher(request)

    const classroom = await prisma.classroom.create({
      data: { tenantId, teacherId: userId, name: 'Ghost Student' },
    })

    const res = await request
      .post(`/v1/classrooms/${classroom.id}/enroll`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ studentId: '00000000-0000-0000-0000-000000000000' })

    expect(res.status).toBe(404)
  })
})

describe('DELETE /v1/classrooms/:id/enrollments/:enrollmentId', () => {
  it('removes the enrollment', async () => {
    const { userId, tenantId, accessToken } = await registerTeacher(request)

    const classroom = await prisma.classroom.create({
      data: { tenantId, teacherId: userId, name: 'Unenroll Test' },
    })
    const { userId: studentId } = await createStudent(tenantId)
    const enrollment = await prisma.enrollment.create({
      data: { classroomId: classroom.id, studentId, tenantId },
    })

    const res = await request
      .delete(`/v1/classrooms/${classroom.id}/enrollments/${enrollment.id}`)
      .set('Authorization', `Bearer ${accessToken}`)

    expect(res.status).toBe(200)
    expect(res.body.data.deletedAt).toBeDefined()

    const row = await prisma.enrollment.findUnique({ where: { id: enrollment.id } })
    expect(row).toBeNull()
  })

  it('returns 404 for unknown enrollment', async () => {
    const { userId, tenantId, accessToken } = await registerTeacher(request)

    const classroom = await prisma.classroom.create({
      data: { tenantId, teacherId: userId, name: 'Ghost Enroll' },
    })

    const res = await request
      .delete(`/v1/classrooms/${classroom.id}/enrollments/00000000-0000-0000-0000-000000000000`)
      .set('Authorization', `Bearer ${accessToken}`)

    expect(res.status).toBe(404)
  })
})

// ─── Sessions ─────────────────────────────────────────────

describe('POST /v1/sessions', () => {
  it('creates a 1-on-1 session with studentId', async () => {
    const { userId, tenantId, accessToken } = await registerTeacher(request)
    const { userId: studentId } = await createStudent(tenantId)

    const res = await request
      .post('/v1/sessions')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ studentId })

    expect(res.status).toBe(201)
    expect(res.body.data.studentId).toBe(studentId)
    expect(res.body.data.classroomId).toBeNull()
    expect(res.body.data.teacherId).toBe(userId)
  })

  it('creates a group session with classroomId and auto-populates participants', async () => {
    const { userId, tenantId, accessToken } = await registerTeacher(request)

    const classroom = await prisma.classroom.create({
      data: { tenantId, teacherId: userId, name: 'Group Session Class' },
    })
    const { userId: s1 } = await createStudent(tenantId)
    const { userId: s2 } = await createStudent(tenantId)
    await prisma.enrollment.createMany({
      data: [
        { classroomId: classroom.id, studentId: s1, tenantId },
        { classroomId: classroom.id, studentId: s2, tenantId },
      ],
    })

    const res = await request
      .post('/v1/sessions')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ classroomId: classroom.id })

    expect(res.status).toBe(201)
    expect(res.body.data.classroomId).toBe(classroom.id)
    expect(res.body.data.studentId).toBeNull()

    // Verify participants were auto-populated
    const participants = await prisma.sessionParticipant.findMany({
      where: { sessionId: res.body.data.id },
    })
    expect(participants).toHaveLength(2)
    const pIds = participants.map((p) => p.studentId)
    expect(pIds).toContain(s1)
    expect(pIds).toContain(s2)
    expect(participants.every((p) => p.status === 'invited')).toBe(true)
  })

  it('returns 400 when neither studentId nor classroomId is provided', async () => {
    const { accessToken } = await registerTeacher(request)

    const res = await request
      .post('/v1/sessions')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({})

    expect(res.status).toBe(400)
  })

  it('returns 400 when both studentId and classroomId are provided', async () => {
    const { userId, tenantId, accessToken } = await registerTeacher(request)
    const { userId: studentId } = await createStudent(tenantId)
    const classroom = await prisma.classroom.create({
      data: { tenantId, teacherId: userId, name: 'Both Test' },
    })

    const res = await request
      .post('/v1/sessions')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ studentId, classroomId: classroom.id })

    expect(res.status).toBe(400)
  })

  it('returns 403 for students trying to create sessions', async () => {
    const { userId: teacherId, tenantId } = await registerTeacher(request)
    const { userId: studentId } = await createStudent(tenantId)
    const studentToken = mintToken(studentId, tenantId, 'student')

    const res = await request
      .post('/v1/sessions')
      .set('Authorization', `Bearer ${studentToken}`)
      .send({ studentId })

    expect(res.status).toBe(403)
    void teacherId
  })
})

describe('GET /v1/sessions', () => {
  it('lists sessions for the authenticated teacher', async () => {
    const { userId, tenantId, accessToken } = await registerTeacher(request)
    const { userId: studentId } = await createStudent(tenantId)

    await prisma.session.create({
      data: { tenantId, teacherId: userId, studentId, status: 'scheduled' },
    })

    const res = await request
      .get('/v1/sessions')
      .set('Authorization', `Bearer ${accessToken}`)

    expect(res.status).toBe(200)
    expect(Array.isArray(res.body.data)).toBe(true)
    expect(res.body.data.length).toBeGreaterThanOrEqual(1)
  })
})

describe('GET /v1/sessions/:id', () => {
  it('returns session with participants', async () => {
    const { userId, tenantId, accessToken } = await registerTeacher(request)
    const { userId: studentId } = await createStudent(tenantId)

    const session = await prisma.session.create({
      data: { tenantId, teacherId: userId, studentId, status: 'scheduled' },
    })
    await prisma.sessionParticipant.create({
      data: { sessionId: session.id, studentId, tenantId, status: 'invited' },
    })

    const res = await request
      .get(`/v1/sessions/${session.id}`)
      .set('Authorization', `Bearer ${accessToken}`)

    expect(res.status).toBe(200)
    expect(res.body.data.id).toBe(session.id)
    expect(res.body.data.participants).toHaveLength(1)
    expect(res.body.data.participants[0].studentId).toBe(studentId)
  })

  it('returns 404 for unknown session', async () => {
    const { accessToken } = await registerTeacher(request)

    const res = await request
      .get('/v1/sessions/00000000-0000-0000-0000-000000000000')
      .set('Authorization', `Bearer ${accessToken}`)

    expect(res.status).toBe(404)
  })
})

describe('PATCH /v1/sessions/:id', () => {
  it('updates session status to active', async () => {
    const { userId, tenantId, accessToken } = await registerTeacher(request)
    const { userId: studentId } = await createStudent(tenantId)

    const session = await prisma.session.create({
      data: { tenantId, teacherId: userId, studentId, status: 'scheduled' },
    })

    const res = await request
      .patch(`/v1/sessions/${session.id}`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ status: 'active', startedAt: new Date().toISOString() })

    expect(res.status).toBe(200)
    expect(res.body.data.status).toBe('active')
    expect(res.body.data.startedAt).toBeDefined()
  })

  it('can mark session as completed with duration', async () => {
    const { userId, tenantId, accessToken } = await registerTeacher(request)
    const { userId: studentId } = await createStudent(tenantId)

    const session = await prisma.session.create({
      data: { tenantId, teacherId: userId, studentId, status: 'active' },
    })

    const res = await request
      .patch(`/v1/sessions/${session.id}`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ status: 'completed', endedAt: new Date().toISOString(), durationSecs: 3600 })

    expect(res.status).toBe(200)
    expect(res.body.data.status).toBe('completed')
    expect(res.body.data.durationSecs).toBe(3600)
  })
})
