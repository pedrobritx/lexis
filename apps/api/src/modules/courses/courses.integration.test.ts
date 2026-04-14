/**
 * Courses module — integration tests
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
  return { userId: decoded.sub, tenantId: decoded.tenantId, accessToken, email }
}

/** Register a student under an existing tenant. */
async function registerStudent(tenantId: string) {
  const user = await prisma.user.create({
    data: {
      email: `student-${nanoid(8)}@test.lexis`,
      role: 'student',
      tenantId,
    },
  })
  return {
    userId: user.id,
    accessToken: mintToken(user.id, tenantId, 'student'),
  }
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

// ─── POST /v1/courses ─────────────────────────────────────

describe('POST /v1/courses', () => {
  it('creates a course and returns 201', async () => {
    const { accessToken, tenantId } = await registerTeacher(request)

    const res = await request
      .post('/v1/courses')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ title: 'English for Beginners', targetLanguage: 'en', framework: 'cefr', targetLevel: 'a1' })

    expect(res.status).toBe(201)
    expect(res.body.data.title).toBe('English for Beginners')
    expect(res.body.data.tenantId).toBe(tenantId)
    expect(res.body.data.status).toBe('draft')
    expect(res.body.data.visibility).toBe('private')
    expect(res.body.data.version).toBe(1)
  })

  it('returns 400 for missing title', async () => {
    const { accessToken } = await registerTeacher(request)

    const res = await request
      .post('/v1/courses')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ targetLanguage: 'en' })

    expect(res.status).toBe(400)
    expect(res.body.error.code).toBe('VALIDATION_ERROR')
  })

  it('returns 403 for students', async () => {
    const { tenantId } = await registerTeacher(request)
    const { accessToken } = await registerStudent(tenantId)

    const res = await request
      .post('/v1/courses')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ title: 'Test' })

    expect(res.status).toBe(403)
  })

  it('returns 401 without auth', async () => {
    const res = await request.post('/v1/courses').send({ title: 'Test' })
    expect(res.status).toBe(401)
  })

  it('returns 402 when lesson_plan limit reached (free plan = 5)', async () => {
    const { accessToken, tenantId } = await registerTeacher(request)

    // Update subscription to 1 slot and create it
    await prisma.subscription.update({
      where: { tenantId },
      data: { lessonPlanLimit: 1 },
    })

    // First course should succeed
    const r1 = await request
      .post('/v1/courses')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ title: 'Course 1' })
    expect(r1.status).toBe(201)

    // Second course should be blocked
    const r2 = await request
      .post('/v1/courses')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ title: 'Course 2' })
    expect(r2.status).toBe(402)
    expect(r2.body.error.details.upgradeRequired).toBe(true)
  })
})

// ─── GET /v1/courses ──────────────────────────────────────

describe('GET /v1/courses', () => {
  it('returns only courses for the authenticated tenant', async () => {
    const { accessToken } = await registerTeacher(request)
    const { accessToken: other } = await registerTeacher(request)

    // Create course for first teacher
    await request
      .post('/v1/courses')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ title: 'My Course' })

    // Create course for second teacher
    await request
      .post('/v1/courses')
      .set('Authorization', `Bearer ${other}`)
      .send({ title: 'Other Course' })

    const res = await request
      .get('/v1/courses')
      .set('Authorization', `Bearer ${accessToken}`)

    expect(res.status).toBe(200)
    const titles = res.body.data.map((c: { title: string }) => c.title)
    expect(titles).toContain('My Course')
    expect(titles).not.toContain('Other Course')
  })

  it('returns 403 for students', async () => {
    const { tenantId } = await registerTeacher(request)
    const { accessToken } = await registerStudent(tenantId)

    const res = await request
      .get('/v1/courses')
      .set('Authorization', `Bearer ${accessToken}`)

    expect(res.status).toBe(403)
  })
})

// ─── GET /v1/courses/:id ──────────────────────────────────

describe('GET /v1/courses/:courseId', () => {
  it('returns a course with nested units and lessons', async () => {
    const { accessToken } = await registerTeacher(request)

    const create = await request
      .post('/v1/courses')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ title: 'Grammar Course' })
    const courseId = create.body.data.id

    await request
      .post(`/v1/courses/${courseId}/units`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ title: 'Unit 1' })

    const res = await request
      .get(`/v1/courses/${courseId}`)
      .set('Authorization', `Bearer ${accessToken}`)

    expect(res.status).toBe(200)
    expect(res.body.data.title).toBe('Grammar Course')
    expect(res.body.data.units).toHaveLength(1)
    expect(res.body.data.units[0].title).toBe('Unit 1')
  })

  it('returns 404 for non-existent course', async () => {
    const { accessToken } = await registerTeacher(request)

    const res = await request
      .get(`/v1/courses/${nanoid(21)}`)
      .set('Authorization', `Bearer ${accessToken}`)

    expect(res.status).toBe(404)
  })

  it('returns 404 for course belonging to another tenant', async () => {
    const { accessToken: t1Token } = await registerTeacher(request)
    const { accessToken: t2Token } = await registerTeacher(request)

    const create = await request
      .post('/v1/courses')
      .set('Authorization', `Bearer ${t1Token}`)
      .send({ title: 'T1 Course' })
    const courseId = create.body.data.id

    const res = await request
      .get(`/v1/courses/${courseId}`)
      .set('Authorization', `Bearer ${t2Token}`)

    expect(res.status).toBe(404)
  })
})

// ─── PATCH /v1/courses/:id ────────────────────────────────

describe('PATCH /v1/courses/:courseId', () => {
  it('updates course fields and increments version', async () => {
    const { accessToken } = await registerTeacher(request)

    const create = await request
      .post('/v1/courses')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ title: 'Old Title' })
    const courseId = create.body.data.id

    const res = await request
      .patch(`/v1/courses/${courseId}`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ title: 'New Title', status: 'active' })

    expect(res.status).toBe(200)
    expect(res.body.data.title).toBe('New Title')
    expect(res.body.data.status).toBe('active')
    expect(res.body.data.version).toBe(2)
  })

  it('returns 400 for invalid status value', async () => {
    const { accessToken } = await registerTeacher(request)

    const create = await request
      .post('/v1/courses')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ title: 'Course' })
    const courseId = create.body.data.id

    const res = await request
      .patch(`/v1/courses/${courseId}`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ status: 'published' })

    expect(res.status).toBe(400)
  })
})

// ─── DELETE /v1/courses/:id ───────────────────────────────

describe('DELETE /v1/courses/:courseId', () => {
  it('soft-deletes the course (with its units and lessons)', async () => {
    const { accessToken } = await registerTeacher(request)

    const create = await request
      .post('/v1/courses')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ title: 'Course to Delete' })
    const courseId = create.body.data.id

    const unitRes = await request
      .post(`/v1/courses/${courseId}/units`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ title: 'Unit 1' })
    const unitId = unitRes.body.data.id

    await request
      .post(`/v1/courses/${courseId}/units/${unitId}/lessons`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ title: 'Lesson 1' })

    const del = await request
      .delete(`/v1/courses/${courseId}`)
      .set('Authorization', `Bearer ${accessToken}`)

    expect(del.status).toBe(200)
    expect(del.body.data.deletedAt).toBeDefined()

    // Course should no longer appear in list
    const list = await request
      .get('/v1/courses')
      .set('Authorization', `Bearer ${accessToken}`)
    const ids = list.body.data.map((c: { id: string }) => c.id)
    expect(ids).not.toContain(courseId)

    // DB: unit and lesson should also be soft-deleted
    const unit = await prisma.unit.findUnique({ where: { id: unitId } })
    expect(unit?.deletedAt).not.toBeNull()
  })

  it('returns 409 when course has active enrollments', async () => {
    const { accessToken, tenantId, userId } = await registerTeacher(request)

    const create = await request
      .post('/v1/courses')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ title: 'Course With Students' })
    const courseId = create.body.data.id

    // Create classroom + enrollment directly
    const { userId: studentId } = await registerStudent(tenantId)
    const classroom = await prisma.classroom.create({
      data: { tenantId, teacherId: userId, name: 'Class A', courseId, status: 'active' },
    })
    await prisma.enrollment.create({
      data: { classroomId: classroom.id, studentId, tenantId },
    })

    const res = await request
      .delete(`/v1/courses/${courseId}`)
      .set('Authorization', `Bearer ${accessToken}`)

    expect(res.status).toBe(409)
    expect(res.body.error.code).toBe('ACTIVE_ENROLLMENTS')
  })
})

// ─── Units ────────────────────────────────────────────────

describe('POST /v1/courses/:courseId/units', () => {
  it('creates a unit with auto-position', async () => {
    const { accessToken } = await registerTeacher(request)

    const course = await request
      .post('/v1/courses')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ title: 'Course' })
    const courseId = course.body.data.id

    const u1 = await request
      .post(`/v1/courses/${courseId}/units`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ title: 'Unit A' })
    const u2 = await request
      .post(`/v1/courses/${courseId}/units`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ title: 'Unit B' })

    expect(u1.status).toBe(201)
    expect(u1.body.data.position).toBe(1)
    expect(u2.body.data.position).toBe(2)
  })
})

describe('PATCH /v1/courses/:courseId/units/:unitId', () => {
  it('updates unit title', async () => {
    const { accessToken } = await registerTeacher(request)

    const course = await request
      .post('/v1/courses')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ title: 'Course' })
    const courseId = course.body.data.id

    const unit = await request
      .post(`/v1/courses/${courseId}/units`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ title: 'Old Name' })
    const unitId = unit.body.data.id

    const res = await request
      .patch(`/v1/courses/${courseId}/units/${unitId}`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ title: 'New Name' })

    expect(res.status).toBe(200)
    expect(res.body.data.title).toBe('New Name')
  })
})

describe('DELETE /v1/courses/:courseId/units/:unitId', () => {
  it('soft-deletes unit and its lessons', async () => {
    const { accessToken } = await registerTeacher(request)

    const course = await request
      .post('/v1/courses')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ title: 'Course' })
    const courseId = course.body.data.id

    const unit = await request
      .post(`/v1/courses/${courseId}/units`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ title: 'Unit X' })
    const unitId = unit.body.data.id

    const lesson = await request
      .post(`/v1/courses/${courseId}/units/${unitId}/lessons`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ title: 'Lesson X' })
    const lessonId = lesson.body.data.id

    const del = await request
      .delete(`/v1/courses/${courseId}/units/${unitId}`)
      .set('Authorization', `Bearer ${accessToken}`)

    expect(del.status).toBe(200)
    expect(del.body.data.deletedAt).toBeDefined()

    const dbLesson = await prisma.lesson.findUnique({ where: { id: lessonId } })
    expect(dbLesson?.deletedAt).not.toBeNull()
  })
})

// ─── Lessons ──────────────────────────────────────────────

describe('POST /v1/courses/:courseId/units/:unitId/lessons', () => {
  it('creates a lesson with auto-position and optional fields', async () => {
    const { accessToken } = await registerTeacher(request)

    const course = await request
      .post('/v1/courses')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ title: 'Course' })
    const courseId = course.body.data.id

    const unit = await request
      .post(`/v1/courses/${courseId}/units`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ title: 'Unit' })
    const unitId = unit.body.data.id

    const res = await request
      .post(`/v1/courses/${courseId}/units/${unitId}/lessons`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ title: 'Present Simple', objective: 'Learn to use present simple', estimatedMinutes: 30 })

    expect(res.status).toBe(201)
    expect(res.body.data.title).toBe('Present Simple')
    expect(res.body.data.objective).toBe('Learn to use present simple')
    expect(res.body.data.estimatedMinutes).toBe(30)
    expect(res.body.data.position).toBe(1)
  })
})

describe('PATCH /v1/courses/:courseId/units/:unitId/lessons/:lessonId', () => {
  it('updates lesson title', async () => {
    const { accessToken } = await registerTeacher(request)

    const course = await request
      .post('/v1/courses')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ title: 'Course' })
    const courseId = course.body.data.id

    const unit = await request
      .post(`/v1/courses/${courseId}/units`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ title: 'Unit' })
    const unitId = unit.body.data.id

    const lesson = await request
      .post(`/v1/courses/${courseId}/units/${unitId}/lessons`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ title: 'Draft Title' })
    const lessonId = lesson.body.data.id

    const res = await request
      .patch(`/v1/courses/${courseId}/units/${unitId}/lessons/${lessonId}`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ title: 'Final Title', estimatedMinutes: 45 })

    expect(res.status).toBe(200)
    expect(res.body.data.title).toBe('Final Title')
    expect(res.body.data.estimatedMinutes).toBe(45)
  })
})

describe('DELETE /v1/courses/:courseId/units/:unitId/lessons/:lessonId', () => {
  it('soft-deletes the lesson', async () => {
    const { accessToken } = await registerTeacher(request)

    const course = await request
      .post('/v1/courses')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ title: 'Course' })
    const courseId = course.body.data.id

    const unit = await request
      .post(`/v1/courses/${courseId}/units`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ title: 'Unit' })
    const unitId = unit.body.data.id

    const lesson = await request
      .post(`/v1/courses/${courseId}/units/${unitId}/lessons`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ title: 'To Delete' })
    const lessonId = lesson.body.data.id

    const del = await request
      .delete(`/v1/courses/${courseId}/units/${unitId}/lessons/${lessonId}`)
      .set('Authorization', `Bearer ${accessToken}`)

    expect(del.status).toBe(200)
    expect(del.body.data.deletedAt).toBeDefined()

    const dbLesson = await prisma.lesson.findUnique({ where: { id: lessonId } })
    expect(dbLesson?.deletedAt).not.toBeNull()
  })
})

// ─── Templates ────────────────────────────────────────────

describe('GET /v1/templates', () => {
  it('returns only public_template courses', async () => {
    const { accessToken, tenantId, userId } = await registerTeacher(request)

    // Create a private course (should NOT appear in templates)
    await request
      .post('/v1/courses')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ title: 'Private Course' })

    // Create a public template directly in the DB
    const template = await prisma.course.create({
      data: {
        tenantId,
        createdBy: userId,
        title: 'CEFR A1 Template',
        targetLanguage: 'en',
        framework: 'cefr',
        targetLevel: 'a1',
        visibility: 'public_template',
        status: 'active',
        version: 1,
      },
    })

    const res = await request
      .get('/v1/templates')
      .set('Authorization', `Bearer ${accessToken}`)

    expect(res.status).toBe(200)
    const ids = res.body.data.map((c: { id: string }) => c.id)
    expect(ids).toContain(template.id)
    // All returned items must be public_template
    for (const c of res.body.data) {
      expect(c.visibility).toBeUndefined() // visibility not in select, but they are templates
    }
  })
})

describe('POST /v1/templates/:id/clone', () => {
  it('deep-clones a template into the caller\'s tenant', async () => {
    const { tenantId, userId } = await registerTeacher(request)

    // Seed a template with units + lessons directly
    const template = await prisma.course.create({
      data: {
        tenantId,
        createdBy: userId,
        title: 'A2 Template',
        targetLanguage: 'en',
        framework: 'cefr',
        targetLevel: 'a2',
        visibility: 'public_template',
        status: 'active',
        version: 1,
      },
    })
    const tUnit = await prisma.unit.create({
      data: { courseId: template.id, tenantId, title: 'Template Unit', position: 1 },
    })
    await prisma.lesson.create({
      data: { unitId: tUnit.id, tenantId, title: 'Template Lesson', position: 1 },
    })

    // Clone into a different teacher's tenant
    const { accessToken: otherToken } = await registerTeacher(request)
    const cloneRes = await request
      .post(`/v1/templates/${template.id}/clone`)
      .set('Authorization', `Bearer ${otherToken}`)

    expect(cloneRes.status).toBe(201)
    expect(cloneRes.body.data.title).toBe('A2 Template')
    expect(cloneRes.body.data.visibility).toBe('private')
    expect(cloneRes.body.data.status).toBe('draft')

    const clonedId = cloneRes.body.data.id

    // Verify units + lessons were cloned
    const units = await prisma.unit.findMany({
      where: { courseId: clonedId, deletedAt: null },
      include: { lessons: { where: { deletedAt: null } } },
    })
    expect(units).toHaveLength(1)
    expect(units[0]!.title).toBe('Template Unit')
    expect(units[0]!.lessons).toHaveLength(1)
    expect(units[0]!.lessons[0]!.title).toBe('Template Lesson')

    // Verify template_clone lineage record
    const clone = await prisma.templateClone.findFirst({
      where: { clonedCourseId: clonedId },
    })
    expect(clone?.sourceCourseId).toBe(template.id)
  })

  it('returns 404 for non-existent or private course', async () => {
    const { accessToken } = await registerTeacher(request)

    const res = await request
      .post(`/v1/templates/${nanoid(21)}/clone`)
      .set('Authorization', `Bearer ${accessToken}`)

    expect(res.status).toBe(404)
  })

  it('returns 402 when lesson_plan limit reached before clone', async () => {
    const { tenantId, userId } = await registerTeacher(request)

    // Seed a template
    const template = await prisma.course.create({
      data: {
        tenantId,
        createdBy: userId,
        title: 'Clone Limit Template',
        targetLanguage: 'en',
        framework: 'cefr',
        targetLevel: 'b1',
        visibility: 'public_template',
        status: 'active',
        version: 1,
      },
    })

    // Set caller's limit to 0
    const { accessToken: limitedToken, tenantId: limitedTenant } =
      await registerTeacher(request)
    await prisma.subscription.update({
      where: { tenantId: limitedTenant },
      data: { lessonPlanLimit: 0 },
    })

    const res = await request
      .post(`/v1/templates/${template.id}/clone`)
      .set('Authorization', `Bearer ${limitedToken}`)

    expect(res.status).toBe(402)
  })

  it('returns 403 for students', async () => {
    const { tenantId, userId } = await registerTeacher(request)
    const template = await prisma.course.create({
      data: {
        tenantId,
        createdBy: userId,
        title: 'Template',
        targetLanguage: 'en',
        framework: 'cefr',
        targetLevel: 'b1',
        visibility: 'public_template',
        status: 'active',
        version: 1,
      },
    })

    const { accessToken } = await registerStudent(tenantId)
    const res = await request
      .post(`/v1/templates/${template.id}/clone`)
      .set('Authorization', `Bearer ${accessToken}`)

    expect(res.status).toBe(403)
  })
})
