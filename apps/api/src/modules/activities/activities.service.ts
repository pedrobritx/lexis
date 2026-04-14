import { prisma } from '@lexis/db'
import { logger } from '@lexis/logger'

const log = logger('activities-service')

// ─── Types ────────────────────────────────────────────────

export type ActivityType = 'cloze' | 'mcq' | 'matching' | 'ordering' | 'open_writing' | 'listening'
export type ActivityVisibility = 'private' | 'public_template'
export type SrsMode = 'flashcard' | 'mini_lesson'

export interface CreateActivityInput {
  type: ActivityType
  title: string
  content: unknown
  scoringRules?: unknown
  skillTags?: string[]
  srsMode?: SrsMode
  imageUrl?: string
  visibility?: ActivityVisibility
}

export interface UpdateActivityInput {
  title?: string
  content?: unknown
  scoringRules?: unknown
  skillTags?: string[]
  srsMode?: SrsMode
  imageUrl?: string
  visibility?: ActivityVisibility
}

// ─── Content + response shapes (per type) ─────────────────

interface ClozeContent {
  text: string
  blanks: Array<{ index: number; correctAnswers: string[] }>
}

interface McqContent {
  question: string
  options: string[]
  correctIndex: number
}

interface MatchingContent {
  pairs: Array<{ left: string; right: string }>
}

interface OrderingContent {
  items: string[]
  correctOrder: number[]
}

interface ListeningContent {
  audioUrl: string
  question: string
  correctAnswers: string[]
}

interface ScoringRules {
  accept_near_match?: boolean
}

// ─── Levenshtein distance ──────────────────────────────────

function levenshtein(a: string, b: string): number {
  const m = a.length
  const n = b.length
  // dp[i][j] = edit distance between a[0..i-1] and b[0..j-1]
  const dp: number[][] = []
  for (let i = 0; i <= m; i++) {
    dp[i] = []
    for (let j = 0; j <= n; j++) {
      if (i === 0) dp[i]![j] = j
      else if (j === 0) dp[i]![j] = i
      else dp[i]![j] = 0
    }
  }
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (a[i - 1] === b[j - 1]) {
        dp[i]![j] = dp[i - 1]![j - 1]!
      } else {
        dp[i]![j] = 1 + Math.min(dp[i - 1]![j]!, dp[i]![j - 1]!, dp[i - 1]![j - 1]!)
      }
    }
  }
  return dp[m]![n]!
}

function matchesAnswer(
  student: string,
  correct: string,
  acceptNearMatch: boolean,
): boolean {
  const s = student.trim().toLowerCase()
  const c = correct.trim().toLowerCase()
  if (s === c) return true
  if (acceptNearMatch && levenshtein(s, c) <= 2) return true
  return false
}

// ─── Answer key stripping (for student delivery) ──────────
//
// Returns a version of `content` with all answer-key fields removed.
// Students see the question/prompt but never the correct answers.

export function stripAnswerKey(type: ActivityType, content: unknown): unknown {
  const c = content as Record<string, unknown>
  switch (type) {
    case 'cloze': {
      const blanks = (c.blanks as Array<{ index: number }>).map(({ index }) => ({ index }))
      return { text: c.text, blanks }
    }
    case 'mcq': {
      return { question: c.question, options: c.options }
    }
    case 'matching': {
      // Return left and right items as separate arrays so the client can
      // shuffle the right column — the pairing itself is the answer.
      const pairs = c.pairs as Array<{ left: string; right: string }>
      return {
        leftItems: pairs.map((p) => p.left),
        rightItems: pairs.map((p) => p.right),
      }
    }
    case 'ordering': {
      return { items: c.items }
    }
    case 'listening': {
      return { audioUrl: c.audioUrl, question: c.question }
    }
    case 'open_writing':
    default:
      return content
  }
}

// ─── Validation ───────────────────────────────────────────

export interface ValidationResult {
  correct: boolean
  score: number | null
  requiresManualGrading: boolean
  details?: unknown
}

export function validateAnswer(
  type: ActivityType,
  content: unknown,
  scoringRules: unknown,
  response: unknown,
): ValidationResult {
  const rules = (scoringRules ?? {}) as ScoringRules
  const acceptNearMatch = rules.accept_near_match ?? false

  switch (type) {
    case 'cloze': {
      const c = content as ClozeContent
      const r = response as { answers: string[] }
      if (!Array.isArray(r.answers)) {
        return { correct: false, score: 0, requiresManualGrading: false }
      }
      const results = c.blanks.map((blank, i) => {
        const studentAnswer = r.answers[i] ?? ''
        return blank.correctAnswers.some((ca) => matchesAnswer(studentAnswer, ca, acceptNearMatch))
      })
      const correct = results.every(Boolean)
      const score = results.filter(Boolean).length / results.length
      return { correct, score, requiresManualGrading: false, details: { blankResults: results } }
    }

    case 'mcq': {
      const c = content as McqContent
      const r = response as { selectedIndex: number }
      const correct = r.selectedIndex === c.correctIndex
      return { correct, score: correct ? 1 : 0, requiresManualGrading: false }
    }

    case 'matching': {
      const c = content as MatchingContent
      const r = response as { matches: Array<{ leftIndex: number; rightIndex: number }> }
      if (!Array.isArray(r.matches)) {
        return { correct: false, score: 0, requiresManualGrading: false }
      }
      // Build expected map: leftIndex → rightIndex (pairs are in order)
      const expectedMap: Record<number, number> = {}
      c.pairs.forEach((_, i) => { expectedMap[i] = i })

      const results = r.matches.map((m) => expectedMap[m.leftIndex] === m.rightIndex)
      const score = results.filter(Boolean).length / c.pairs.length
      const correct = score === 1
      return { correct, score, requiresManualGrading: false, details: { matchResults: results } }
    }

    case 'ordering': {
      const c = content as OrderingContent
      const r = response as { order: number[] }
      if (!Array.isArray(r.order)) {
        return { correct: false, score: 0, requiresManualGrading: false }
      }
      // r.order[i] is the item index placed at position i
      // correctOrder[i] is the item index that should be at position i
      const results = c.correctOrder.map((expected, i) => r.order[i] === expected)
      const score = results.filter(Boolean).length / c.correctOrder.length
      const correct = score === 1
      return { correct, score, requiresManualGrading: false, details: { positionResults: results } }
    }

    case 'open_writing': {
      return { correct: false, score: null, requiresManualGrading: true }
    }

    case 'listening': {
      const c = content as ListeningContent
      const r = response as { answer: string }
      const studentAnswer = r.answer ?? ''
      const correct = c.correctAnswers.some((ca) => matchesAnswer(studentAnswer, ca, acceptNearMatch))
      return { correct, score: correct ? 1 : 0, requiresManualGrading: false }
    }

    default:
      return { correct: false, score: null, requiresManualGrading: false }
  }
}

// ─── CRUD ─────────────────────────────────────────────────

async function assertLessonAccess(lessonId: string, tenantId: string) {
  const lesson = await prisma.lesson.findFirst({
    where: { id: lessonId, tenantId, deletedAt: null },
  })
  if (!lesson) throw Object.assign(new Error('Lesson not found'), { statusCode: 404 })
  return lesson
}

export async function listActivities(lessonId: string, tenantId: string) {
  await assertLessonAccess(lessonId, tenantId)

  return prisma.activity.findMany({
    where: { lessonId, tenantId, deletedAt: null },
    orderBy: [{ position: 'asc' }, { id: 'asc' }],
    select: {
      id: true,
      lessonId: true,
      type: true,
      title: true,
      position: true,
      content: true,
      scoringRules: true,
      skillTags: true,
      srsMode: true,
      imageUrl: true,
      visibility: true,
      version: true,
    },
  })
}

export async function getActivity(activityId: string, tenantId: string) {
  const activity = await prisma.activity.findFirst({
    where: { id: activityId, tenantId, deletedAt: null },
  })
  if (!activity) throw Object.assign(new Error('Activity not found'), { statusCode: 404 })
  return activity
}

export async function createActivity(
  lessonId: string,
  tenantId: string,
  input: CreateActivityInput,
) {
  await assertLessonAccess(lessonId, tenantId)

  // Auto-assign position: one past the current max in this lesson
  const agg = await prisma.activity.aggregate({
    where: { lessonId, tenantId, deletedAt: null },
    _max: { position: true },
  })
  const position = (agg._max.position ?? -1) + 1

  const activity = await prisma.activity.create({
    data: {
      lessonId,
      tenantId,
      type: input.type,
      title: input.title,
      position,
      content: input.content as object,
      scoringRules: input.scoringRules as object | undefined,
      skillTags: input.skillTags ?? [],
      srsMode: input.srsMode,
      imageUrl: input.imageUrl,
      visibility: input.visibility ?? 'private',
    },
  })

  log.info({ activityId: activity.id, lessonId, tenantId, position }, 'Activity created')
  return activity
}

export async function updateActivity(
  activityId: string,
  tenantId: string,
  input: UpdateActivityInput,
) {
  const activity = await prisma.activity.findFirst({
    where: { id: activityId, tenantId, deletedAt: null },
  })
  if (!activity) throw Object.assign(new Error('Activity not found'), { statusCode: 404 })

  const updated = await prisma.activity.update({
    where: { id: activityId },
    data: {
      ...(input.title !== undefined && { title: input.title }),
      ...(input.content !== undefined && { content: input.content as object }),
      ...(input.scoringRules !== undefined && { scoringRules: input.scoringRules as object }),
      ...(input.skillTags !== undefined && { skillTags: input.skillTags }),
      ...(input.srsMode !== undefined && { srsMode: input.srsMode }),
      ...(input.imageUrl !== undefined && { imageUrl: input.imageUrl }),
      ...(input.visibility !== undefined && { visibility: input.visibility }),
      version: { increment: 1 },
    },
  })

  log.info({ activityId, tenantId }, 'Activity updated')
  return updated
}

export async function deleteActivity(activityId: string, tenantId: string) {
  const activity = await prisma.activity.findFirst({
    where: { id: activityId, tenantId, deletedAt: null },
  })
  if (!activity) throw Object.assign(new Error('Activity not found'), { statusCode: 404 })

  const now = new Date()
  await prisma.activity.update({
    where: { id: activityId },
    data: { deletedAt: now },
  })

  log.info({ activityId, tenantId }, 'Activity soft-deleted')
  return { deletedAt: now }
}
