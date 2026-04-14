/**
 * Activities module — integration tests
 * Runs against real Postgres (5433) + Redis (6380) via docker-compose.test.yml
 */
import { describe, it, expect, beforeAll, afterEach, vi } from 'vitest'
import supertest from 'supertest'
import jwt from 'jsonwebtoken'
import { prisma } from '@lexis/db'
import { nanoid } from 'nanoid'
import { buildApp } from '../../app.js'
import { validateAnswer } from './activities.service.js'

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
  return { userId: decoded.sub, tenantId: decoded.tenantId, accessToken, email }
}

async function registerStudent(tenantId: string) {
  const user = await prisma.user.create({
    data: { email: `student-${nanoid(8)}@test.lexis`, role: 'student', tenantId },
  })
  return { userId: user.id, accessToken: mintToken(user.id, tenantId, 'student') }
}

/** Creates course → unit → lesson and returns lessonId. */
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

// ─── POST /v1/lessons/:lessonId/activities ────────────────

describe('POST /v1/lessons/:lessonId/activities', () => {
  it('creates an MCQ activity and returns 201', async () => {
    const { accessToken } = await registerTeacher(request)
    const lessonId = await seedLesson(request, accessToken)

    const res = await request
      .post(`/v1/lessons/${lessonId}/activities`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        type: 'mcq',
        title: 'Which sentence is correct?',
        content: {
          question: 'Which sentence is correct?',
          options: ['She go school', 'She goes to school', 'She going school'],
          correctIndex: 1,
        },
        skillTags: ['present_simple'],
      })

    expect(res.status).toBe(201)
    expect(res.body.data.type).toBe('mcq')
    expect(res.body.data.title).toBe('Which sentence is correct?')
    expect(res.body.data.skillTags).toContain('present_simple')
    expect(res.body.data.version).toBe(1)
    expect(res.body.data.visibility).toBe('private')
  })

  it('creates a cloze activity with scoring rules', async () => {
    const { accessToken } = await registerTeacher(request)
    const lessonId = await seedLesson(request, accessToken)

    const res = await request
      .post(`/v1/lessons/${lessonId}/activities`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        type: 'cloze',
        title: 'Fill in the blank',
        content: {
          text: 'She _____ to school every day.',
          blanks: [{ index: 0, correctAnswers: ['goes'] }],
        },
        scoringRules: { accept_near_match: true },
      })

    expect(res.status).toBe(201)
    expect(res.body.data.type).toBe('cloze')
    expect(res.body.data.scoringRules).toMatchObject({ accept_near_match: true })
  })

  it('returns 400 for missing required fields', async () => {
    const { accessToken } = await registerTeacher(request)
    const lessonId = await seedLesson(request, accessToken)

    const res = await request
      .post(`/v1/lessons/${lessonId}/activities`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ type: 'mcq' }) // missing title and content

    expect(res.status).toBe(400)
    expect(res.body.error.code).toBe('VALIDATION_ERROR')
  })

  it('returns 400 for invalid activity type', async () => {
    const { accessToken } = await registerTeacher(request)
    const lessonId = await seedLesson(request, accessToken)

    const res = await request
      .post(`/v1/lessons/${lessonId}/activities`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ type: 'essay', title: 'Test', content: {} })

    expect(res.status).toBe(400)
  })

  it('returns 403 for students', async () => {
    const { tenantId } = await registerTeacher(request)
    const { accessToken: studentToken } = await registerStudent(tenantId)
    const { accessToken } = await registerTeacher(request)
    const lessonId = await seedLesson(request, accessToken)

    const res = await request
      .post(`/v1/lessons/${lessonId}/activities`)
      .set('Authorization', `Bearer ${studentToken}`)
      .send({ type: 'mcq', title: 'Q', content: {} })

    expect(res.status).toBe(403)
  })

  it('returns 404 for non-existent lesson', async () => {
    const { accessToken } = await registerTeacher(request)

    const res = await request
      .post(`/v1/lessons/${nanoid(21)}/activities`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        type: 'mcq',
        title: 'Test',
        content: { question: 'Q', options: ['A'], correctIndex: 0 },
      })

    expect(res.status).toBe(404)
  })

  it('returns 401 without auth', async () => {
    const res = await request
      .post(`/v1/lessons/${nanoid(21)}/activities`)
      .send({ type: 'mcq', title: 'Q', content: {} })

    expect(res.status).toBe(401)
  })
})

// ─── GET /v1/lessons/:lessonId/activities ─────────────────

describe('GET /v1/lessons/:lessonId/activities', () => {
  it('lists activities for a lesson', async () => {
    const { accessToken } = await registerTeacher(request)
    const lessonId = await seedLesson(request, accessToken)

    await request
      .post(`/v1/lessons/${lessonId}/activities`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ type: 'mcq', title: 'Q1', content: { question: 'Q', options: ['A'], correctIndex: 0 } })

    await request
      .post(`/v1/lessons/${lessonId}/activities`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ type: 'cloze', title: 'Fill', content: { text: '_____', blanks: [] } })

    const res = await request
      .get(`/v1/lessons/${lessonId}/activities`)
      .set('Authorization', `Bearer ${accessToken}`)

    expect(res.status).toBe(200)
    expect(res.body.data).toHaveLength(2)
    const titles = res.body.data.map((a: { title: string }) => a.title)
    expect(titles).toContain('Q1')
    expect(titles).toContain('Fill')
  })

  it('does not return activities from another tenant', async () => {
    const { accessToken: t1 } = await registerTeacher(request)
    const { accessToken: t2 } = await registerTeacher(request)

    const lessonId = await seedLesson(request, t1)
    await request
      .post(`/v1/lessons/${lessonId}/activities`)
      .set('Authorization', `Bearer ${t1}`)
      .send({ type: 'mcq', title: 'T1 Activity', content: { question: 'Q', options: ['A'], correctIndex: 0 } })

    // t2 should get 404 since lesson belongs to t1
    const res = await request
      .get(`/v1/lessons/${lessonId}/activities`)
      .set('Authorization', `Bearer ${t2}`)

    expect(res.status).toBe(404)
  })
})

// ─── GET /v1/activities/:id ───────────────────────────────

describe('GET /v1/activities/:id', () => {
  it('returns a single activity', async () => {
    const { accessToken } = await registerTeacher(request)
    const lessonId = await seedLesson(request, accessToken)

    const create = await request
      .post(`/v1/lessons/${lessonId}/activities`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ type: 'ordering', title: 'Order these', content: { items: ['C', 'A', 'B'], correctOrder: [1, 2, 0] } })
    const activityId = create.body.data.id

    const res = await request
      .get(`/v1/activities/${activityId}`)
      .set('Authorization', `Bearer ${accessToken}`)

    expect(res.status).toBe(200)
    expect(res.body.data.id).toBe(activityId)
    expect(res.body.data.type).toBe('ordering')
  })

  it('returns 404 for another tenant\'s activity', async () => {
    const { accessToken: t1 } = await registerTeacher(request)
    const { accessToken: t2 } = await registerTeacher(request)

    const lessonId = await seedLesson(request, t1)
    const create = await request
      .post(`/v1/lessons/${lessonId}/activities`)
      .set('Authorization', `Bearer ${t1}`)
      .send({ type: 'mcq', title: 'Q', content: { question: 'Q', options: ['A'], correctIndex: 0 } })
    const activityId = create.body.data.id

    const res = await request
      .get(`/v1/activities/${activityId}`)
      .set('Authorization', `Bearer ${t2}`)

    expect(res.status).toBe(404)
  })
})

// ─── PATCH /v1/activities/:id ─────────────────────────────

describe('PATCH /v1/activities/:id', () => {
  it('updates fields and increments version', async () => {
    const { accessToken } = await registerTeacher(request)
    const lessonId = await seedLesson(request, accessToken)

    const create = await request
      .post(`/v1/lessons/${lessonId}/activities`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ type: 'mcq', title: 'Old Title', content: { question: 'Q', options: ['A'], correctIndex: 0 } })
    const activityId = create.body.data.id

    const res = await request
      .patch(`/v1/activities/${activityId}`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ title: 'New Title', skillTags: ['grammar'] })

    expect(res.status).toBe(200)
    expect(res.body.data.title).toBe('New Title')
    expect(res.body.data.skillTags).toContain('grammar')
    expect(res.body.data.version).toBe(2)
  })

  it('returns 400 for invalid visibility value', async () => {
    const { accessToken } = await registerTeacher(request)
    const lessonId = await seedLesson(request, accessToken)

    const create = await request
      .post(`/v1/lessons/${lessonId}/activities`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ type: 'mcq', title: 'Q', content: {} })
    const activityId = create.body.data.id

    const res = await request
      .patch(`/v1/activities/${activityId}`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ visibility: 'public' })

    expect(res.status).toBe(400)
  })
})

// ─── DELETE /v1/activities/:id ────────────────────────────

describe('DELETE /v1/activities/:id', () => {
  it('soft-deletes an activity', async () => {
    const { accessToken } = await registerTeacher(request)
    const lessonId = await seedLesson(request, accessToken)

    const create = await request
      .post(`/v1/lessons/${lessonId}/activities`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ type: 'mcq', title: 'To Delete', content: { question: 'Q', options: ['A'], correctIndex: 0 } })
    const activityId = create.body.data.id

    const del = await request
      .delete(`/v1/activities/${activityId}`)
      .set('Authorization', `Bearer ${accessToken}`)

    expect(del.status).toBe(200)
    expect(del.body.data.deletedAt).toBeDefined()

    // Should not appear in list
    const list = await request
      .get(`/v1/lessons/${lessonId}/activities`)
      .set('Authorization', `Bearer ${accessToken}`)
    const ids = list.body.data.map((a: { id: string }) => a.id)
    expect(ids).not.toContain(activityId)

    // DB record should have deletedAt
    const dbRecord = await prisma.activity.findUnique({ where: { id: activityId } })
    expect(dbRecord?.deletedAt).not.toBeNull()
  })
})

// ─── POST /v1/activities/:id/validate ────────────────────

describe('POST /v1/activities/:id/validate', () => {
  it('validates a correct MCQ answer', async () => {
    const { accessToken } = await registerTeacher(request)
    const lessonId = await seedLesson(request, accessToken)

    const create = await request
      .post(`/v1/lessons/${lessonId}/activities`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        type: 'mcq',
        title: 'MCQ',
        content: { question: 'Q?', options: ['Wrong', 'Right', 'Also wrong'], correctIndex: 1 },
      })
    const activityId = create.body.data.id

    const res = await request
      .post(`/v1/activities/${activityId}/validate`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ response: { selectedIndex: 1 } })

    expect(res.status).toBe(200)
    expect(res.body.data.correct).toBe(true)
    expect(res.body.data.score).toBe(1)
  })

  it('validates an incorrect MCQ answer', async () => {
    const { accessToken } = await registerTeacher(request)
    const lessonId = await seedLesson(request, accessToken)

    const create = await request
      .post(`/v1/lessons/${lessonId}/activities`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        type: 'mcq',
        title: 'MCQ',
        content: { question: 'Q?', options: ['A', 'B'], correctIndex: 0 },
      })
    const activityId = create.body.data.id

    const res = await request
      .post(`/v1/activities/${activityId}/validate`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ response: { selectedIndex: 1 } })

    expect(res.status).toBe(200)
    expect(res.body.data.correct).toBe(false)
    expect(res.body.data.score).toBe(0)
  })

  it('validates cloze with exact match', async () => {
    const { accessToken } = await registerTeacher(request)
    const lessonId = await seedLesson(request, accessToken)

    const create = await request
      .post(`/v1/lessons/${lessonId}/activities`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        type: 'cloze',
        title: 'Cloze',
        content: {
          text: 'She _____ to school.',
          blanks: [{ index: 0, correctAnswers: ['goes'] }],
        },
        scoringRules: { accept_near_match: false },
      })
    const activityId = create.body.data.id

    const correct = await request
      .post(`/v1/activities/${activityId}/validate`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ response: { answers: ['goes'] } })
    expect(correct.body.data.correct).toBe(true)

    const wrong = await request
      .post(`/v1/activities/${activityId}/validate`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ response: { answers: ['go'] } })
    expect(wrong.body.data.correct).toBe(false)
  })

  it('validates cloze with near-match (Levenshtein ≤2)', async () => {
    const { accessToken } = await registerTeacher(request)
    const lessonId = await seedLesson(request, accessToken)

    const create = await request
      .post(`/v1/lessons/${lessonId}/activities`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        type: 'cloze',
        title: 'Near-match cloze',
        content: {
          text: 'The capital of France is _____.',
          blanks: [{ index: 0, correctAnswers: ['Paris'] }],
        },
        scoringRules: { accept_near_match: true },
      })
    const activityId = create.body.data.id

    // "Pari" is distance 1 from "paris" (lowercase comparison)
    const res = await request
      .post(`/v1/activities/${activityId}/validate`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ response: { answers: ['Pari'] } })

    expect(res.status).toBe(200)
    expect(res.body.data.correct).toBe(true)
  })

  it('rejects cloze answers beyond near-match threshold', async () => {
    const { accessToken } = await registerTeacher(request)
    const lessonId = await seedLesson(request, accessToken)

    const create = await request
      .post(`/v1/lessons/${lessonId}/activities`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        type: 'cloze',
        title: 'Cloze strict',
        content: {
          text: '_____ is a country.',
          blanks: [{ index: 0, correctAnswers: ['France'] }],
        },
        scoringRules: { accept_near_match: true },
      })
    const activityId = create.body.data.id

    // "Gronce" → distance 2 from "France" (f→g, a→o) — accepted (≤2)
    // "Gronzy" → distance 4 from "France" (f→g, a→o, c→z, e→y) — rejected (>2)
    const accepted = await request
      .post(`/v1/activities/${activityId}/validate`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ response: { answers: ['Gronce'] } })
    expect(accepted.body.data.correct).toBe(true)

    const rejected = await request
      .post(`/v1/activities/${activityId}/validate`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ response: { answers: ['Gronzy'] } })
    expect(rejected.body.data.correct).toBe(false)
  })

  it('validates matching activity', async () => {
    const { accessToken } = await registerTeacher(request)
    const lessonId = await seedLesson(request, accessToken)

    const create = await request
      .post(`/v1/lessons/${lessonId}/activities`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        type: 'matching',
        title: 'Match words',
        content: {
          pairs: [
            { left: 'happy', right: 'joyful' },
            { left: 'sad', right: 'unhappy' },
          ],
        },
      })
    const activityId = create.body.data.id

    const correct = await request
      .post(`/v1/activities/${activityId}/validate`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ response: { matches: [{ leftIndex: 0, rightIndex: 0 }, { leftIndex: 1, rightIndex: 1 }] } })
    expect(correct.body.data.correct).toBe(true)
    expect(correct.body.data.score).toBe(1)

    const partial = await request
      .post(`/v1/activities/${activityId}/validate`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ response: { matches: [{ leftIndex: 0, rightIndex: 0 }, { leftIndex: 1, rightIndex: 0 }] } })
    expect(partial.body.data.correct).toBe(false)
    expect(partial.body.data.score).toBe(0.5)
  })

  it('validates ordering with partial scoring', async () => {
    const { accessToken } = await registerTeacher(request)
    const lessonId = await seedLesson(request, accessToken)

    const create = await request
      .post(`/v1/lessons/${lessonId}/activities`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        type: 'ordering',
        title: 'Order steps',
        content: {
          items: ['Step C', 'Step A', 'Step B', 'Step D'],
          correctOrder: [1, 2, 0, 3],
        },
      })
    const activityId = create.body.data.id

    // Perfect answer
    const perfect = await request
      .post(`/v1/activities/${activityId}/validate`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ response: { order: [1, 2, 0, 3] } })
    expect(perfect.body.data.correct).toBe(true)
    expect(perfect.body.data.score).toBe(1)

    // Half correct (2 out of 4)
    const half = await request
      .post(`/v1/activities/${activityId}/validate`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ response: { order: [1, 2, 3, 0] } })
    expect(half.body.data.correct).toBe(false)
    expect(half.body.data.score).toBe(0.5)
  })

  it('returns requiresManualGrading for open_writing', async () => {
    const { accessToken } = await registerTeacher(request)
    const lessonId = await seedLesson(request, accessToken)

    const create = await request
      .post(`/v1/lessons/${lessonId}/activities`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        type: 'open_writing',
        title: 'Essay',
        content: { prompt: 'Write about your hobby.' },
      })
    const activityId = create.body.data.id

    const res = await request
      .post(`/v1/activities/${activityId}/validate`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ response: { text: 'I like reading books.' } })

    expect(res.status).toBe(200)
    expect(res.body.data.requiresManualGrading).toBe(true)
    expect(res.body.data.correct).toBe(false)
    expect(res.body.data.score).toBeNull()
  })

  it('validates listening activity', async () => {
    const { accessToken } = await registerTeacher(request)
    const lessonId = await seedLesson(request, accessToken)

    const create = await request
      .post(`/v1/lessons/${lessonId}/activities`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        type: 'listening',
        title: 'Listen and answer',
        content: {
          audioUrl: 'https://example.com/audio.mp3',
          question: 'What did the speaker say?',
          correctAnswers: ['hello world'],
        },
      })
    const activityId = create.body.data.id

    const res = await request
      .post(`/v1/activities/${activityId}/validate`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ response: { answer: 'hello world' } })

    expect(res.status).toBe(200)
    expect(res.body.data.correct).toBe(true)
  })

  it('students can also validate activities', async () => {
    const { accessToken: teacherToken, tenantId } = await registerTeacher(request)
    const { accessToken: studentToken } = await registerStudent(tenantId)
    const lessonId = await seedLesson(request, teacherToken)

    const create = await request
      .post(`/v1/lessons/${lessonId}/activities`)
      .set('Authorization', `Bearer ${teacherToken}`)
      .send({
        type: 'mcq',
        title: 'Student MCQ',
        content: { question: 'Q?', options: ['A', 'B'], correctIndex: 0 },
      })

    const activityId = create.body.data.id

    const res = await request
      .post(`/v1/activities/${activityId}/validate`)
      .set('Authorization', `Bearer ${studentToken}`)
      .send({ response: { selectedIndex: 0 } })

    expect(res.status).toBe(200)
    expect(res.body.data.correct).toBe(true)
  })

  it('returns 400 for missing response', async () => {
    const { accessToken } = await registerTeacher(request)
    const lessonId = await seedLesson(request, accessToken)

    const create = await request
      .post(`/v1/lessons/${lessonId}/activities`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ type: 'mcq', title: 'Q', content: { question: 'Q', options: ['A'], correctIndex: 0 } })
    const activityId = create.body.data.id

    const res = await request
      .post(`/v1/activities/${activityId}/validate`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({}) // missing response

    expect(res.status).toBe(400)
  })
})

// ─── Unit tests: validateAnswer ───────────────────────────

describe('validateAnswer — unit tests', () => {
  describe('cloze', () => {
    const content = {
      text: 'She _____ to school.',
      blanks: [{ index: 0, correctAnswers: ['goes', 'walked'] }],
    }

    it('accepts exact match (case-insensitive)', () => {
      const r = validateAnswer('cloze', content, {}, { answers: ['GOES'] })
      expect(r.correct).toBe(true)
      expect(r.score).toBe(1)
    })

    it('rejects wrong answer without near-match', () => {
      const r = validateAnswer('cloze', content, { accept_near_match: false }, { answers: ['go'] })
      expect(r.correct).toBe(false)
    })

    it('accepts near-match within Levenshtein 2', () => {
      // "goos" → distance 1 from "goes"
      const r = validateAnswer('cloze', content, { accept_near_match: true }, { answers: ['goos'] })
      expect(r.correct).toBe(true)
    })

    it('rejects near-match beyond Levenshtein 2', () => {
      // "abc" → distance > 2 from both "goes" and "walked"
      const r = validateAnswer('cloze', content, { accept_near_match: true }, { answers: ['abc'] })
      expect(r.correct).toBe(false)
    })

    it('supports multiple blanks with partial score', () => {
      const multi = {
        text: '_____ is _____ city.',
        blanks: [
          { index: 0, correctAnswers: ['Paris'] },
          { index: 1, correctAnswers: ['a', 'the'] },
        ],
      }
      const r = validateAnswer('cloze', multi, {}, { answers: ['Paris', 'wrong'] })
      expect(r.correct).toBe(false)
      expect(r.score).toBe(0.5)
    })
  })

  describe('mcq', () => {
    const content = { question: 'Q?', options: ['A', 'B', 'C'], correctIndex: 2 }

    it('correct index → correct: true, score: 1', () => {
      const r = validateAnswer('mcq', content, {}, { selectedIndex: 2 })
      expect(r.correct).toBe(true)
      expect(r.score).toBe(1)
    })

    it('wrong index → correct: false, score: 0', () => {
      const r = validateAnswer('mcq', content, {}, { selectedIndex: 0 })
      expect(r.correct).toBe(false)
      expect(r.score).toBe(0)
    })
  })

  describe('matching', () => {
    const content = {
      pairs: [{ left: 'dog', right: 'animal' }, { left: 'oak', right: 'tree' }],
    }

    it('all correct → score 1', () => {
      const r = validateAnswer('matching', content, {}, {
        matches: [{ leftIndex: 0, rightIndex: 0 }, { leftIndex: 1, rightIndex: 1 }],
      })
      expect(r.correct).toBe(true)
      expect(r.score).toBe(1)
    })

    it('partial correct → fractional score', () => {
      const r = validateAnswer('matching', content, {}, {
        matches: [{ leftIndex: 0, rightIndex: 1 }, { leftIndex: 1, rightIndex: 1 }],
      })
      expect(r.correct).toBe(false)
      expect(r.score).toBe(0.5)
    })
  })

  describe('ordering', () => {
    const content = { items: ['B', 'A', 'C'], correctOrder: [1, 0, 2] }

    it('perfect order → score 1', () => {
      const r = validateAnswer('ordering', content, {}, { order: [1, 0, 2] })
      expect(r.correct).toBe(true)
      expect(r.score).toBe(1)
    })

    it('partial order → fractional score', () => {
      const r = validateAnswer('ordering', content, {}, { order: [1, 2, 0] })
      expect(r.correct).toBe(false)
      expect(r.score).toBeCloseTo(1 / 3)
    })
  })

  describe('open_writing', () => {
    it('always returns requiresManualGrading: true', () => {
      const r = validateAnswer('open_writing', { prompt: 'Write.' }, {}, { text: 'Hello.' })
      expect(r.requiresManualGrading).toBe(true)
      expect(r.correct).toBe(false)
      expect(r.score).toBeNull()
    })
  })

  describe('listening', () => {
    const content = {
      audioUrl: 'https://example.com/a.mp3',
      question: 'What did you hear?',
      correctAnswers: ['apple'],
    }

    it('exact match → correct', () => {
      const r = validateAnswer('listening', content, {}, { answer: 'apple' })
      expect(r.correct).toBe(true)
    })

    it('wrong answer → incorrect', () => {
      const r = validateAnswer('listening', content, {}, { answer: 'orange' })
      expect(r.correct).toBe(false)
    })
  })
})
