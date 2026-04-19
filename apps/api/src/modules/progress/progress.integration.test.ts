/**
 * Progress module — integration tests
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

// ── Mock badge service so gamification XP doesn't bleed into progress assertions ──
vi.mock('../gamification/badge.service.js', () => ({
  checkAndAwardBadges: vi.fn().mockResolvedValue([]),
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

async function registerStudent(tenantId: string) {
  const user = await prisma.user.create({
    data: { email: `student-${nanoid(8)}@test.lexis`, role: 'student', tenantId },
  })
  await prisma.studentProfile.create({
    data: { userId: user.id, tenantId, displayName: 'Test Student', xpTotal: 0 },
  })
  return { userId: user.id, accessToken: mintToken(user.id, tenantId, 'student') }
}

/** Creates course → unit → lesson and returns ids. */
async function seedLesson(request: ReturnType<typeof supertest>, token: string) {
  const course = await request
    .post('/v1/courses')
    .set('Authorization', `Bearer ${token}`)
    .send({ title: 'Test Course' })
  const courseId = course.body.data.id

  const unit = await request
    .post(`/v1/courses/${courseId}/units`)
    .set('Authorization', `Bearer ${token}`)
    .send({ title: 'Unit 1' })
  const unitId = unit.body.data.id

  const lesson = await request
    .post(`/v1/courses/${courseId}/units/${unitId}/lessons`)
    .set('Authorization', `Bearer ${token}`)
    .send({ title: 'Lesson 1' })
  return { lessonId: lesson.body.data.id as string }
}

/** Creates an MCQ activity under a lesson. Returns activityId. */
async function seedMcqActivity(
  request: ReturnType<typeof supertest>,
  token: string,
  lessonId: string,
  correctIndex = 1,
) {
  const res = await request
    .post(`/v1/lessons/${lessonId}/activities`)
    .set('Authorization', `Bearer ${token}`)
    .send({
      type: 'mcq',
      title: 'MCQ Activity',
      content: {
        question: 'Pick the correct one',
        options: ['Wrong', 'Correct', 'Wrong'],
        correctIndex,
      },
    })
  return res.body.data.id as string
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

// ─── POST /v1/progress/activities/:id/attempt ─────────────

describe('POST /v1/progress/activities/:id/attempt', () => {
  it('logs a correct MCQ attempt and returns 201 with xpAwarded=10 (lesson not yet complete)', async () => {
    const { accessToken: teacherToken, tenantId } = await registerTeacher(request)
    const { lessonId } = await seedLesson(request, teacherToken)
    // Two activities so lesson doesn't auto-complete on the first attempt
    const activityId = await seedMcqActivity(request, teacherToken, lessonId, 1)
    await seedMcqActivity(request, teacherToken, lessonId, 0) // second activity, not yet attempted
    const { accessToken: studentToken } = await registerStudent(tenantId)

    const res = await request
      .post(`/v1/progress/activities/${activityId}/attempt`)
      .set('Authorization', `Bearer ${studentToken}`)
      .send({ response: { selectedIndex: 1 } })

    expect(res.status).toBe(201)
    expect(res.body.data.correct).toBe(true)
    expect(res.body.data.score).toBe(1)
    expect(res.body.data.xpAwarded).toBe(10) // correct answer XP only; lesson not yet complete
    expect(res.body.data.lessonCompleted).toBe(false)
    expect(res.body.data.requiresManualGrading).toBe(false)
    expect(res.body.data.attemptId).toBeTruthy()
  })

  it('logs an incorrect MCQ attempt and awards 0 XP (lesson not yet complete)', async () => {
    const { accessToken: teacherToken, tenantId } = await registerTeacher(request)
    const { lessonId } = await seedLesson(request, teacherToken)
    // Two activities so lesson doesn't auto-complete on the first attempt
    const activityId = await seedMcqActivity(request, teacherToken, lessonId, 1)
    await seedMcqActivity(request, teacherToken, lessonId, 0) // second activity, not yet attempted
    const { accessToken: studentToken } = await registerStudent(tenantId)

    const res = await request
      .post(`/v1/progress/activities/${activityId}/attempt`)
      .set('Authorization', `Bearer ${studentToken}`)
      .send({ response: { selectedIndex: 0 } }) // wrong answer

    expect(res.status).toBe(201)
    expect(res.body.data.correct).toBe(false)
    expect(res.body.data.xpAwarded).toBe(0)
    expect(res.body.data.lessonCompleted).toBe(false)
  })

  it('auto-completes lesson and awards 50 bonus XP when all activities are attempted', async () => {
    const { accessToken: teacherToken, tenantId } = await registerTeacher(request)
    const { lessonId } = await seedLesson(request, teacherToken)

    // Lesson has exactly 1 activity — completing it finishes the lesson
    const activityId = await seedMcqActivity(request, teacherToken, lessonId, 1)
    const { userId: studentId, accessToken: studentToken } = await registerStudent(tenantId)

    const res = await request
      .post(`/v1/progress/activities/${activityId}/attempt`)
      .set('Authorization', `Bearer ${studentToken}`)
      .send({ response: { selectedIndex: 1 } }) // correct

    expect(res.status).toBe(201)
    expect(res.body.data.lessonCompleted).toBe(true)
    // 10 (correct) + 50 (lesson done) = 60
    expect(res.body.data.xpAwarded).toBe(60)

    // Verify lesson_progress in DB
    const progress = await prisma.lessonProgress.findUnique({
      where: { studentId_lessonId: { studentId, lessonId } },
    })
    expect(progress?.status).toBe('completed')
    expect(progress?.completedAt).not.toBeNull()
    expect(progress?.scorePct).toBe(1)
  })

  it('does not double-award lesson XP on re-attempt after completion', async () => {
    const { accessToken: teacherToken, tenantId } = await registerTeacher(request)
    const { lessonId } = await seedLesson(request, teacherToken)
    const activityId = await seedMcqActivity(request, teacherToken, lessonId, 1)
    const { userId: studentId, accessToken: studentToken } = await registerStudent(tenantId)

    // First attempt — completes lesson
    await request
      .post(`/v1/progress/activities/${activityId}/attempt`)
      .set('Authorization', `Bearer ${studentToken}`)
      .send({ response: { selectedIndex: 1 } })

    // Second attempt — lesson already completed, no extra XP
    const res2 = await request
      .post(`/v1/progress/activities/${activityId}/attempt`)
      .set('Authorization', `Bearer ${studentToken}`)
      .send({ response: { selectedIndex: 1 } })

    expect(res2.body.data.lessonCompleted).toBe(false)
    // Only the correct-answer XP, no lesson bonus
    expect(res2.body.data.xpAwarded).toBe(10)

    // XP total in DB: 10 + 50 (first) + 10 (second) = 70
    const profile = await prisma.studentProfile.findFirst({
      where: { userId: studentId, tenantId },
    })
    expect(profile?.xpTotal).toBe(70)
  })

  it('marks lesson in_progress after partial completion (multi-activity lesson)', async () => {
    const { accessToken: teacherToken, tenantId } = await registerTeacher(request)
    const { lessonId } = await seedLesson(request, teacherToken)

    // Two activities in the lesson
    const activity1 = await seedMcqActivity(request, teacherToken, lessonId, 1)
    await seedMcqActivity(request, teacherToken, lessonId, 0)

    const { userId: studentId, accessToken: studentToken } = await registerStudent(tenantId)

    // Only attempt the first activity
    const res = await request
      .post(`/v1/progress/activities/${activity1}/attempt`)
      .set('Authorization', `Bearer ${studentToken}`)
      .send({ response: { selectedIndex: 1 } })

    expect(res.body.data.lessonCompleted).toBe(false)

    const progress = await prisma.lessonProgress.findUnique({
      where: { studentId_lessonId: { studentId, lessonId } },
    })
    expect(progress?.status).toBe('in_progress')
  })

  it('returns 403 when a teacher tries to submit an attempt', async () => {
    const { accessToken: teacherToken } = await registerTeacher(request)
    const { lessonId } = await seedLesson(request, teacherToken)
    const activityId = await seedMcqActivity(request, teacherToken, lessonId, 1)

    // Teacher tries to submit — should be rejected
    const res = await request
      .post(`/v1/progress/activities/${activityId}/attempt`)
      .set('Authorization', `Bearer ${teacherToken}`)
      .send({ response: { selectedIndex: 1 } })

    expect(res.status).toBe(403)
  })

  it('returns 404 for an activity that does not exist in the tenant', async () => {
    const { tenantId } = await registerTeacher(request)
    const { accessToken: studentToken } = await registerStudent(tenantId)

    const res = await request
      .post('/v1/progress/activities/00000000-0000-0000-0000-000000000000/attempt')
      .set('Authorization', `Bearer ${studentToken}`)
      .send({ response: { selectedIndex: 0 } })

    expect(res.status).toBe(404)
  })

  it('returns 401 without auth', async () => {
    const res = await request
      .post('/v1/progress/activities/anything/attempt')
      .send({ response: {} })

    expect(res.status).toBe(401)
  })
})

// ─── GET /v1/progress/lessons/:id ────────────────────────

describe('GET /v1/progress/lessons/:id', () => {
  it('student gets their own lesson progress (not_started with no attempts)', async () => {
    const { accessToken: teacherToken, tenantId } = await registerTeacher(request)
    const { lessonId } = await seedLesson(request, teacherToken)
    await seedMcqActivity(request, teacherToken, lessonId, 1)
    const { accessToken: studentToken } = await registerStudent(tenantId)

    const res = await request
      .get(`/v1/progress/lessons/${lessonId}`)
      .set('Authorization', `Bearer ${studentToken}`)

    expect(res.status).toBe(200)
    expect(res.body.data.status).toBe('not_started')
    expect(res.body.data.activityCount).toBe(1)
    expect(res.body.data.attemptedCount).toBe(0)
    expect(res.body.data.activities[0].attempted).toBe(false)
  })

  it('returns in_progress with partial attempts reflected', async () => {
    const { accessToken: teacherToken, tenantId } = await registerTeacher(request)
    const { lessonId } = await seedLesson(request, teacherToken)
    const activity1 = await seedMcqActivity(request, teacherToken, lessonId, 1)
    await seedMcqActivity(request, teacherToken, lessonId, 0)
    const { accessToken: studentToken } = await registerStudent(tenantId)

    await request
      .post(`/v1/progress/activities/${activity1}/attempt`)
      .set('Authorization', `Bearer ${studentToken}`)
      .send({ response: { selectedIndex: 1 } })

    const res = await request
      .get(`/v1/progress/lessons/${lessonId}`)
      .set('Authorization', `Bearer ${studentToken}`)

    expect(res.status).toBe(200)
    expect(res.body.data.status).toBe('in_progress')
    expect(res.body.data.attemptedCount).toBe(1)
    expect(res.body.data.activityCount).toBe(2)
  })

  it('returns completed with scorePct after lesson is finished', async () => {
    const { accessToken: teacherToken, tenantId } = await registerTeacher(request)
    const { lessonId } = await seedLesson(request, teacherToken)
    const activityId = await seedMcqActivity(request, teacherToken, lessonId, 1)
    const { accessToken: studentToken } = await registerStudent(tenantId)

    await request
      .post(`/v1/progress/activities/${activityId}/attempt`)
      .set('Authorization', `Bearer ${studentToken}`)
      .send({ response: { selectedIndex: 1 } })

    const res = await request
      .get(`/v1/progress/lessons/${lessonId}`)
      .set('Authorization', `Bearer ${studentToken}`)

    expect(res.status).toBe(200)
    expect(res.body.data.status).toBe('completed')
    expect(res.body.data.scorePct).toBe(1)
    expect(res.body.data.completedAt).not.toBeNull()
    expect(res.body.data.activities[0].attempted).toBe(true)
    expect(res.body.data.activities[0].correct).toBe(true)
  })

  it('teacher can query a student progress with ?studentId=', async () => {
    const { accessToken: teacherToken, tenantId } = await registerTeacher(request)
    const { lessonId } = await seedLesson(request, teacherToken)
    const activityId = await seedMcqActivity(request, teacherToken, lessonId, 1)
    const { userId: studentId, accessToken: studentToken } = await registerStudent(tenantId)

    await request
      .post(`/v1/progress/activities/${activityId}/attempt`)
      .set('Authorization', `Bearer ${studentToken}`)
      .send({ response: { selectedIndex: 1 } })

    const res = await request
      .get(`/v1/progress/lessons/${lessonId}?studentId=${studentId}`)
      .set('Authorization', `Bearer ${teacherToken}`)

    expect(res.status).toBe(200)
    expect(res.body.data.status).toBe('completed')
  })

  it('teacher gets 400 when studentId is missing', async () => {
    const { accessToken: teacherToken } = await registerTeacher(request)
    const { lessonId } = await seedLesson(request, teacherToken)

    const res = await request
      .get(`/v1/progress/lessons/${lessonId}`)
      .set('Authorization', `Bearer ${teacherToken}`)

    expect(res.status).toBe(400)
  })

  it('returns 404 for a lesson that does not exist', async () => {
    const { tenantId } = await registerTeacher(request)
    const { accessToken: studentToken } = await registerStudent(tenantId)

    const res = await request
      .get('/v1/progress/lessons/00000000-0000-0000-0000-000000000000')
      .set('Authorization', `Bearer ${studentToken}`)

    expect(res.status).toBe(404)
  })
})
