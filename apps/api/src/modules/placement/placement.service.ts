import { prisma } from '@lexis/db'
import { logger } from '@lexis/logger'
import {
  QUESTION_BANK,
  LEVELS_ORDERED,
  getPublicQuestions,
  type CefrLevel,
} from './placement.questions.js'

const log = logger('placement-service')

// ─── GET /v1/placement/test ───────────────────────────────

export function getTest() {
  return { questions: getPublicQuestions() }
}

// ─── Scoring (pure — exported for unit tests) ─────────────

export function scoreAnswers(answers: Record<string, string>): {
  resultLevel: CefrLevel
  score: number
} {
  let highestPassedLevel: CefrLevel | null = null

  for (const level of LEVELS_ORDERED) {
    const levelQs = QUESTION_BANK.filter((q) => q.level === level)
    const mcqs = levelQs.filter((q) => q.type === 'mcq')
    const cloze = levelQs.find((q) => q.type === 'cloze')!

    const bothMcqsCorrect = mcqs.every((q) => answers[q.id] === q.correctAnswer)
    const clozeNonEmpty = (answers[cloze.id] ?? '').trim().length > 0

    if (bothMcqsCorrect && clozeNonEmpty) {
      highestPassedLevel = level
    }
  }

  const resultLevel = highestPassedLevel ?? 'a1'
  // score = number of levels fully passed (0 if none)
  const score =
    highestPassedLevel !== null ? LEVELS_ORDERED.indexOf(highestPassedLevel) + 1 : 0

  return { resultLevel, score }
}

// ─── POST /v1/placement/submit ────────────────────────────

export interface SubmitInput {
  answers: Record<string, string>
}

export async function submit(studentId: string, tenantId: string, input: SubmitInput) {
  const { resultLevel, score } = scoreAnswers(input.answers)

  // Snapshot question IDs + versions so we can detect bank changes later
  const questionVersions = Object.fromEntries(QUESTION_BANK.map((q) => [q.id, q.version]))

  const test = await prisma.placementTest.create({
    data: {
      studentId,
      tenantId,
      score,
      resultLevel,
      questionVersions,
    },
  })

  // Update (or create) the student profile's CEFR level
  await prisma.studentProfile.upsert({
    where: { userId: studentId },
    create: {
      userId: studentId,
      tenantId,
      displayName: '',
      cefrLevel: resultLevel,
    },
    update: { cefrLevel: resultLevel },
  })

  log.info({ studentId, resultLevel, score }, 'Placement test submitted')

  return {
    id: test.id,
    resultLevel: test.resultLevel,
    score: test.score,
    takenAt: test.takenAt,
  }
}

// ─── POST /v1/placement/skip ──────────────────────────────

export async function skip(studentId: string, tenantId: string) {
  // Persist the skip so history is complete; questionVersions flags it as skipped.
  const test = await prisma.placementTest.create({
    data: {
      studentId,
      tenantId,
      score: 0,
      resultLevel: 'a1',
      questionVersions: { skipped: true },
    },
  })

  log.info({ studentId }, 'Placement test skipped')

  return { id: test.id, skipped: true }
}

// ─── GET /v1/placement/history ────────────────────────────

export async function getHistory(studentId: string) {
  const tests = await prisma.placementTest.findMany({
    where: { studentId },
    orderBy: { takenAt: 'desc' },
    select: {
      id: true,
      resultLevel: true,
      score: true,
      takenAt: true,
      questionVersions: true,
    },
  })

  return tests.map((t) => ({
    id: t.id,
    resultLevel: t.resultLevel,
    score: t.score,
    takenAt: t.takenAt,
    skipped: (t.questionVersions as Record<string, unknown>)?.skipped === true,
  }))
}
