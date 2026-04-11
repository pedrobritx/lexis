/**
 * Placement service unit tests — scoring logic only.
 * No DB calls; scoreAnswers() is a pure function.
 */
import { describe, it, expect } from 'vitest'
import { scoreAnswers } from './placement.service.js'

// ─── Helpers ──────────────────────────────────────────────

/** Correct answers for every question in the bank. */
const ALL_CORRECT: Record<string, string> = {
  a1_mcq1: 'am',
  a1_mcq2: 'small',
  a1_cloze: 'two',
  a2_mcq1: 'goes',
  a2_mcq2: 'been',
  a2_cloze: 'ran',
  b1_mcq1: 'had',
  b1_mcq2: 'written',
  b1_cloze: 'I would visit my family.',
  b2_mcq1: 'being',
  b2_mcq2: 'appears',
  b2_cloze: 'Remote work saves commute time.',
  c1_mcq1: 'was it',
  c1_mcq2: 'having been studied',
  c1_cloze: 'Technology both relieves and creates stress.',
}

/** Build an answers map with only the given levels answered correctly. */
function answersUpToLevel(maxLevel: 'a1' | 'a2' | 'b1' | 'b2' | 'c1') {
  const order = ['a1', 'a2', 'b1', 'b2', 'c1']
  const cutoff = order.indexOf(maxLevel)
  return Object.fromEntries(
    Object.entries(ALL_CORRECT).filter(([id]) => {
      const qLevel = id.split('_')[0]
      return order.indexOf(qLevel) <= cutoff
    }),
  )
}

// ─── Tests ────────────────────────────────────────────────

describe('scoreAnswers', () => {
  it('returns c1 / score 5 when all questions answered correctly', () => {
    const { resultLevel, score } = scoreAnswers(ALL_CORRECT)
    expect(resultLevel).toBe('c1')
    expect(score).toBe(5)
  })

  it('returns a1 / score 1 when only A1 answered correctly', () => {
    const { resultLevel, score } = scoreAnswers(answersUpToLevel('a1'))
    expect(resultLevel).toBe('a1')
    expect(score).toBe(1)
  })

  it('returns b1 / score 3 when A1–B1 answered correctly and B2 left blank', () => {
    const { resultLevel, score } = scoreAnswers(answersUpToLevel('b1'))
    expect(resultLevel).toBe('b1')
    expect(score).toBe(3)
  })

  it('returns b2 / score 4 when A1–B2 answered correctly', () => {
    const { resultLevel, score } = scoreAnswers(answersUpToLevel('b2'))
    expect(resultLevel).toBe('b2')
    expect(score).toBe(4)
  })

  it('returns a1 / score 0 when answers map is empty', () => {
    const { resultLevel, score } = scoreAnswers({})
    expect(resultLevel).toBe('a1')
    expect(score).toBe(0)
  })

  it('returns a1 / score 0 when all MCQ answers are wrong', () => {
    const wrong = Object.fromEntries(
      Object.entries(ALL_CORRECT).map(([id, _]) => [id, 'WRONG']),
    )
    const { resultLevel, score } = scoreAnswers(wrong)
    expect(resultLevel).toBe('a1')
    expect(score).toBe(0)
  })

  it('does not pass a level when only one MCQ is correct', () => {
    // Only a1_mcq1 correct; a1_mcq2 wrong; cloze filled
    const { resultLevel, score } = scoreAnswers({
      a1_mcq1: 'am',
      a1_mcq2: 'WRONG',
      a1_cloze: 'two',
    })
    expect(resultLevel).toBe('a1')
    expect(score).toBe(0)
  })

  it('does not pass a level when cloze is empty', () => {
    const { resultLevel, score } = scoreAnswers({
      a1_mcq1: 'am',
      a1_mcq2: 'small',
      a1_cloze: '',        // empty → fails
      a2_mcq1: 'goes',
      a2_mcq2: 'been',
      a2_cloze: 'ran',
    })
    // A1 fails (empty cloze); A2 passes; A2 requires A1 to have passed first?
    // No — scoring is per-level independently; the spec says "highest level
    // where both MCQs correct + cloze non-empty". A1 fails, A2 passes.
    expect(resultLevel).toBe('a2')
    expect(score).toBe(2)
  })

  it('does not pass a level when cloze is whitespace-only', () => {
    const { resultLevel, score } = scoreAnswers({
      a1_mcq1: 'am',
      a1_mcq2: 'small',
      a1_cloze: '   ',    // whitespace-only → treated as empty
    })
    expect(resultLevel).toBe('a1')
    expect(score).toBe(0)
  })

  it('skips intermediate failing levels and returns the highest passing one', () => {
    // A1 passes, A2 fails (wrong MCQ), B1 passes → result should be B1
    const answers: Record<string, string> = {
      ...answersUpToLevel('a1'),
      // A2 MCQ wrong
      a2_mcq1: 'WRONG',
      a2_mcq2: 'been',
      a2_cloze: 'ran',
      // B1 correct
      b1_mcq1: 'had',
      b1_mcq2: 'written',
      b1_cloze: 'I would rest.',
    }
    const { resultLevel, score } = scoreAnswers(answers)
    expect(resultLevel).toBe('b1')
    expect(score).toBe(3)
  })
})
