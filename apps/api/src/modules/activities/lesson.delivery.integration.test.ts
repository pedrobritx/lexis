/**
 * Day 11 — Lesson delivery API integration tests
 *
 * Covers:
 *   GET  /v1/lessons/:id/activities  — ordered list, answer key stripping
 *   POST /v1/progress/activities/:id/attempt — attempt logging + validation result
 *   GET  /v1/progress/lessons/:id    — per-lesson progress summary
 *
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
  return lesson.body.data.id as string
}

async function createActivity(
  request: ReturnType<typeof supertest>,
  token: string,
  lessonId: string,
  payload: object,
) {
  const res = await request
    .post(`/v1/lessons/${lessonId}/activities`)
    .set('Authorization', `Bearer ${token}`)
    .send(payload)
  return res.body.data
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

// ─── GET /v1/lessons/:id/activities — student delivery ────

describe('GET /v1/lessons/:id/activities — lesson delivery', () => {
  it('returns activities ordered by position (ascending)', async () => {
    const { accessToken: teacherToken, tenantId } = await registerTeacher(request)
    const lessonId = await seedLesson(request, teacherToken)

    // Create 3 activities; they should be auto-assigned positions 0, 1, 2
    await createActivity(request, teacherToken, lessonId, {
      type: 'mcq', title: 'First', content: { question: 'Q1', options: ['A', 'B'], correctIndex: 0 },
    })
    await createActivity(request, teacherToken, lessonId, {
      type: 'cloze', title: 'Second', content: { text: '___', blanks: [{ index: 0, correctAnswers: ['x'] }] },
    })
    await createActivity(request, teacherToken, lessonId, {
      type: 'ordering', title: 'Third', content: { items: ['B', 'A'], correctOrder: [1, 0] },
    })

    // Use a student in the same tenant so the lesson is accessible
    const { accessToken: studentToken } = await registerStudent(tenantId)

    const res = await request
      .get(`/v1/lessons/${lessonId}/activities`)
      .set('Authorization', `Bearer ${studentToken}`)

    expect(res.status).toBe(200)
    expect(res.body.data).toHaveLength(3)
    const titles = res.body.data.map((a: { title: string }) => a.title)
    expect(titles).toEqual(['First', 'Second', 'Third'])

    // Positions should be 0, 1, 2
    const positions = res.body.data.map((a: { position: number }) => a.position)
    expect(positions).toEqual([0, 1, 2])
  })

  it('strips MCQ correctIndex for students', async () => {
    const { accessToken: teacherToken, tenantId } = await registerTeacher(request)
    const lessonId = await seedLesson(request, teacherToken)

    await createActivity(request, teacherToken, lessonId, {
      type: 'mcq',
      title: 'MCQ',
      content: { question: 'Pick one', options: ['Wrong', 'Correct'], correctIndex: 1 },
    })

    const { accessToken: studentToken } = await registerStudent(tenantId)
    const res = await request
      .get(`/v1/lessons/${lessonId}/activities`)
      .set('Authorization', `Bearer ${studentToken}`)

    expect(res.status).toBe(200)
    const content = res.body.data[0].content as Record<string, unknown>
    expect(content).toHaveProperty('question')
    expect(content).toHaveProperty('options')
    expect(content).not.toHaveProperty('correctIndex')
    // scoringRules omitted for students
    expect(res.body.data[0].scoringRules).toBeUndefined()
  })

  it('strips cloze correctAnswers for students', async () => {
    const { accessToken: teacherToken, tenantId } = await registerTeacher(request)
    const lessonId = await seedLesson(request, teacherToken)

    await createActivity(request, teacherToken, lessonId, {
      type: 'cloze',
      title: 'Fill',
      content: { text: 'She _____ home.', blanks: [{ index: 0, correctAnswers: ['went'] }] },
    })

    const { accessToken: studentToken } = await registerStudent(tenantId)
    const res = await request
      .get(`/v1/lessons/${lessonId}/activities`)
      .set('Authorization', `Bearer ${studentToken}`)

    expect(res.status).toBe(200)
    const content = res.body.data[0].content as { text: string; blanks: Array<Record<string, unknown>> }
    expect(content).toHaveProperty('text')
    expect(content.blanks[0]).toHaveProperty('index')
    expect(content.blanks[0]).not.toHaveProperty('correctAnswers')
  })

  it('strips ordering correctOrder for students', async () => {
    const { accessToken: teacherToken, tenantId } = await registerTeacher(request)
    const lessonId = await seedLesson(request, teacherToken)

    await createActivity(request, teacherToken, lessonId, {
      type: 'ordering',
      title: 'Order',
      content: { items: ['B', 'A', 'C'], correctOrder: [1, 0, 2] },
    })

    const { accessToken: studentToken } = await registerStudent(tenantId)
    const res = await request
      .get(`/v1/lessons/${lessonId}/activities`)
      .set('Authorization', `Bearer ${studentToken}`)

    expect(res.status).toBe(200)
    const content = res.body.data[0].content as Record<string, unknown>
    expect(content).toHaveProperty('items')
    expect(content).not.toHaveProperty('correctOrder')
  })

  it('strips matching pairs — returns leftItems/rightItems for students', async () => {
    const { accessToken: teacherToken, tenantId } = await registerTeacher(request)
    const lessonId = await seedLesson(request, teacherToken)

    await createActivity(request, teacherToken, lessonId, {
      type: 'matching',
      title: 'Match',
      content: { pairs: [{ left: 'dog', right: 'animal' }, { left: 'oak', right: 'tree' }] },
    })

    const { accessToken: studentToken } = await registerStudent(tenantId)
    const res = await request
      .get(`/v1/lessons/${lessonId}/activities`)
      .set('Authorization', `Bearer ${studentToken}`)

    expect(res.status).toBe(200)
    const content = res.body.data[0].content as Record<string, unknown>
    expect(content).toHaveProperty('leftItems')
    expect(content).toHaveProperty('rightItems')
    expect(content).not.toHaveProperty('pairs')
  })

  it('strips listening correctAnswers for students', async () => {
    const { accessToken: teacherToken, tenantId } = await registerTeacher(request)
    const lessonId = await seedLesson(request, teacherToken)

    await createActivity(request, teacherToken, lessonId, {
      type: 'listening',
      title: 'Listen',
      content: {
        audioUrl: 'https://example.com/audio.mp3',
        question: 'What did you hear?',
        correctAnswers: ['hello'],
      },
    })

    const { accessToken: studentToken } = await registerStudent(tenantId)
    const res = await request
      .get(`/v1/lessons/${lessonId}/activities`)
      .set('Authorization', `Bearer ${studentToken}`)

    expect(res.status).toBe(200)
    const content = res.body.data[0].content as Record<string, unknown>
    expect(content).toHaveProperty('audioUrl')
    expect(content).toHaveProperty('question')
    expect(content).not.toHaveProperty('correctAnswers')
  })

  it('returns full content (including answer keys) for teachers', async () => {
    const { accessToken: teacherToken } = await registerTeacher(request)
    const lessonId = await seedLesson(request, teacherToken)

    await createActivity(request, teacherToken, lessonId, {
      type: 'mcq',
      title: 'MCQ',
      content: { question: 'Q?', options: ['A', 'B'], correctIndex: 1 },
      scoringRules: { accept_near_match: false },
    })

    const res = await request
      .get(`/v1/lessons/${lessonId}/activities`)
      .set('Authorization', `Bearer ${teacherToken}`)

    expect(res.status).toBe(200)
    const content = res.body.data[0].content as Record<string, unknown>
    expect(content).toHaveProperty('correctIndex', 1)
    expect(res.body.data[0].scoringRules).toBeDefined()
  })

  it('returns 404 when lesson belongs to a different tenant', async () => {
    const { accessToken: t1Token } = await registerTeacher(request)
    const { accessToken: t2Token } = await registerTeacher(request)
    const lessonId = await seedLesson(request, t1Token)

    const res = await request
      .get(`/v1/lessons/${lessonId}/activities`)
      .set('Authorization', `Bearer ${t2Token}`)

    expect(res.status).toBe(404)
  })

  it('returns 401 without auth', async () => {
    const res = await request.get('/v1/lessons/anything/activities')
    expect(res.status).toBe(401)
  })
})

// ─── Full lesson delivery flow ────────────────────────────

describe('Full lesson delivery flow', () => {
  it('student fetches activities (stripped), submits attempts, lesson auto-completes', async () => {
    const { accessToken: teacherToken, tenantId } = await registerTeacher(request)
    const lessonId = await seedLesson(request, teacherToken)

    // Teacher creates 2 activities
    const act1 = await createActivity(request, teacherToken, lessonId, {
      type: 'mcq',
      title: 'Q1',
      content: { question: 'Pick correct', options: ['Wrong', 'Right'], correctIndex: 1 },
    })
    const act2 = await createActivity(request, teacherToken, lessonId, {
      type: 'cloze',
      title: 'Q2',
      content: { text: 'She _____ home.', blanks: [{ index: 0, correctAnswers: ['went'] }] },
      scoringRules: { accept_near_match: false },
    })

    const { userId: studentId, accessToken: studentToken } = await registerStudent(tenantId)

    // Step 1: student fetches activities — answer keys stripped
    const deliveryRes = await request
      .get(`/v1/lessons/${lessonId}/activities`)
      .set('Authorization', `Bearer ${studentToken}`)

    expect(deliveryRes.status).toBe(200)
    expect(deliveryRes.body.data).toHaveLength(2)
    expect(deliveryRes.body.data[0].position).toBe(0)
    expect(deliveryRes.body.data[1].position).toBe(1)
    // No answer keys
    expect(deliveryRes.body.data[0].content).not.toHaveProperty('correctIndex')
    expect(deliveryRes.body.data[1].content).not.toHaveProperty('correctAnswers')

    // Step 2: student submits attempt on act1 (correct)
    const attempt1 = await request
      .post(`/v1/progress/activities/${act1.id}/attempt`)
      .set('Authorization', `Bearer ${studentToken}`)
      .send({ response: { selectedIndex: 1 } })

    expect(attempt1.status).toBe(201)
    expect(attempt1.body.data.correct).toBe(true)
    expect(attempt1.body.data.xpAwarded).toBe(10)
    expect(attempt1.body.data.lessonCompleted).toBe(false)

    // Step 3: student submits attempt on act2 (correct) → lesson completes
    const attempt2 = await request
      .post(`/v1/progress/activities/${act2.id}/attempt`)
      .set('Authorization', `Bearer ${studentToken}`)
      .send({ response: { answers: ['went'] } })

    expect(attempt2.status).toBe(201)
    expect(attempt2.body.data.correct).toBe(true)
    expect(attempt2.body.data.lessonCompleted).toBe(true)
    // 10 (correct) + 50 (lesson complete) = 60
    expect(attempt2.body.data.xpAwarded).toBe(60)

    // Step 4: progress summary reflects completion
    const progressRes = await request
      .get(`/v1/progress/lessons/${lessonId}`)
      .set('Authorization', `Bearer ${studentToken}`)

    expect(progressRes.status).toBe(200)
    expect(progressRes.body.data.status).toBe('completed')
    expect(progressRes.body.data.scorePct).toBe(1)
    expect(progressRes.body.data.attemptedCount).toBe(2)

    // XP total: 10 + 10 + 50 = 70
    const profile = await prisma.studentProfile.findFirst({
      where: { userId: studentId, tenantId },
    })
    expect(profile?.xpTotal).toBe(70)
  })

  it('validates against full answer key even though student received stripped content', async () => {
    // This verifies that stripping is presentation-only — the backend still
    // has the correct answers and evaluates submissions against them.
    const { accessToken: teacherToken, tenantId } = await registerTeacher(request)
    const lessonId = await seedLesson(request, teacherToken)

    const act = await createActivity(request, teacherToken, lessonId, {
      type: 'mcq',
      title: 'Secret',
      content: { question: 'Q?', options: ['Wrong', 'Also wrong', 'Correct'], correctIndex: 2 },
    })

    const { accessToken: studentToken } = await registerStudent(tenantId)

    // Student receives stripped content (no correctIndex)
    const deliveryRes = await request
      .get(`/v1/lessons/${lessonId}/activities`)
      .set('Authorization', `Bearer ${studentToken}`)
    expect(deliveryRes.body.data[0].content).not.toHaveProperty('correctIndex')

    // Correct submission still evaluated correctly by the backend
    const correct = await request
      .post(`/v1/progress/activities/${act.id}/attempt`)
      .set('Authorization', `Bearer ${studentToken}`)
      .send({ response: { selectedIndex: 2 } })
    expect(correct.body.data.correct).toBe(true)

    // Wrong submission still evaluated correctly
    const wrong = await request
      .post(`/v1/progress/activities/${act.id}/attempt`)
      .set('Authorization', `Bearer ${studentToken}`)
      .send({ response: { selectedIndex: 0 } })
    expect(wrong.body.data.correct).toBe(false)
  })
})
