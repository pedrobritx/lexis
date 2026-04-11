import { describe, it, expect } from 'vitest'
import {
  applyReview,
  applyReviewWithStalenessCheck,
  nextReviewDate,
  updateStreakDays,
} from './index.js'

// ─── SM-2: applyReview ────────────────────────────────────

describe('applyReview', () => {
  const base = { easeFactor: 2.5, intervalDays: 1, repetitions: 0 }

  // ── 10-review sequence [4,4,5,3,4,5,5,2,4,5] ──────────
  // Computed step-by-step against the SM-2 spec.
  // Interval uses OLD easeFactor; EF is updated after interval.
  it('produces the correct 10-review sequence', () => {
    const qualities = [4, 4, 5, 3, 4, 5, 5, 2, 4, 5]

    const expected = [
      // [easeFactor, intervalDays, repetitions]
      [2.5, 1, 1],     // q=4: reps 0→1, ef=2.5+0=2.5,  i=1
      [2.5, 6, 2],     // q=4: reps 1→2, ef=2.5,         i=6
      [2.5, 15, 3],    // q=5: reps 2→3, ef=2.5+0.1→cap, i=round(6*2.5)=15
      [2.36, 38, 4],   // q=3: reps 3→4, ef=2.5-0.14,    i=round(15*2.5)=38 (37.5→38)
      [2.36, 90, 5],   // q=4: reps 4→5, ef=2.36,         i=round(38*2.36)=90 (89.68)
      [2.46, 212, 6],  // q=5: reps 5→6, ef=2.36+0.1,    i=round(90*2.36)=212 (212.4)
      [2.5, 522, 7],   // q=5: reps 6→7, ef=2.46+0.1→cap,i=round(212*2.46)=522 (521.52)
      [2.18, 1, 0],    // q=2: incorrect→reset,           ef=2.5-0.32=2.18
      [2.18, 1, 1],    // q=4: reps 0→1, ef=2.18,         i=1
      [2.28, 6, 2],    // q=5: reps 1→2, ef=2.18+0.1,    i=6
    ]

    let state = { easeFactor: 2.5, intervalDays: 1, repetitions: 0 }

    for (let i = 0; i < qualities.length; i++) {
      const q = qualities[i] as number
      const exp = expected[i] as [number, number, number]
      const result = applyReview(state, q)

      expect(result.easeFactor, `step ${i + 1} (q=${q}) easeFactor`).toBeCloseTo(exp[0], 8)
      expect(result.intervalDays, `step ${i + 1} (q=${q}) intervalDays`).toBe(exp[1])
      expect(result.repetitions, `step ${i + 1} (q=${q}) repetitions`).toBe(exp[2])

      state = { easeFactor: result.easeFactor, intervalDays: result.intervalDays, repetitions: result.repetitions }
    }
  })

  // ── EF floor ──────────────────────────────────────────
  it('clamps ease_factor to minimum 1.3', () => {
    // q=0 produces the largest negative delta
    // EF delta for q=0: 0.1 - 5*(0.08 + 5*0.02) = 0.1 - 5*0.18 = 0.1 - 0.90 = -0.80
    // Starting from EF_MIN (1.3) should stay at 1.3
    const result = applyReview({ easeFactor: 1.3, intervalDays: 1, repetitions: 0 }, 0)
    expect(result.easeFactor).toBe(1.3)
  })

  it('drives ease_factor toward floor with repeated low quality', () => {
    let ef = 2.5
    for (let i = 0; i < 20; i++) {
      const r = applyReview({ easeFactor: ef, intervalDays: 1, repetitions: 0 }, 0)
      ef = r.easeFactor
    }
    expect(ef).toBe(1.3)
  })

  // ── EF ceiling ────────────────────────────────────────
  it('clamps ease_factor to maximum 2.5', () => {
    // q=5 gives +0.1; starting at 2.5 should stay at 2.5
    const result = applyReview({ easeFactor: 2.5, intervalDays: 1, repetitions: 0 }, 5)
    expect(result.easeFactor).toBe(2.5)
  })

  it('caps ease_factor below 2.5 only when it would exceed it', () => {
    // Start below ceiling, one q=5 pushes it up (but not past 2.5)
    const result = applyReview({ easeFactor: 2.4, intervalDays: 1, repetitions: 0 }, 5)
    expect(result.easeFactor).toBeCloseTo(2.5, 8)
  })

  // ── Interval progression ──────────────────────────────
  it('first correct response always gives interval 1', () => {
    for (const q of [3, 4, 5]) {
      const result = applyReview({ easeFactor: 2.5, intervalDays: 1, repetitions: 0 }, q)
      expect(result.intervalDays).toBe(1)
    }
  })

  it('second correct response always gives interval 6', () => {
    for (const q of [3, 4, 5]) {
      const result = applyReview({ easeFactor: 2.5, intervalDays: 1, repetitions: 1 }, q)
      expect(result.intervalDays).toBe(6)
    }
  })

  it('third+ correct response multiplies interval by OLD ease_factor', () => {
    const result = applyReview({ easeFactor: 2.5, intervalDays: 10, repetitions: 3 }, 4)
    // interval = round(10 * 2.5) = 25 (using OLD EF before update)
    expect(result.intervalDays).toBe(25)
  })

  // ── Incorrect responses ───────────────────────────────
  it('quality < 3 resets repetitions to 0 and interval to 1', () => {
    for (const q of [0, 1, 2]) {
      const result = applyReview({ easeFactor: 2.5, intervalDays: 50, repetitions: 5 }, q)
      expect(result.repetitions).toBe(0)
      expect(result.intervalDays).toBe(1)
    }
  })

  it('quality < 3 still updates ease_factor', () => {
    // q=2: delta = 0.1 - 3*(0.08 + 3*0.02) = 0.1 - 0.42 = -0.32
    const result = applyReview({ easeFactor: 2.5, intervalDays: 1, repetitions: 0 }, 2)
    expect(result.easeFactor).toBeCloseTo(2.18, 8)
  })

  // ── Input validation ──────────────────────────────────
  it('throws RangeError for quality below 0', () => {
    expect(() => applyReview(base, -1)).toThrow(RangeError)
  })

  it('throws RangeError for quality above 5', () => {
    expect(() => applyReview(base, 6)).toThrow(RangeError)
  })

  it('throws RangeError for non-integer quality', () => {
    expect(() => applyReview(base, 3.5)).toThrow(RangeError)
  })
})

// ─── SM-2 + staleness: applyReviewWithStalenessCheck ─────

describe('applyReviewWithStalenessCheck', () => {
  const params = {
    easeFactor: 2.5,
    intervalDays: 30,
    repetitions: 5,
    activityVersion: 1,
  }

  it('returns contentChanged: false when versions match', () => {
    const result = applyReviewWithStalenessCheck(params, 4, 1)
    expect(result.contentChanged).toBe(false)
  })

  it('delegates to applyReview when versions match', () => {
    const result = applyReviewWithStalenessCheck(params, 4, 1)
    const direct = applyReview(params, 4)
    expect(result.easeFactor).toBeCloseTo(direct.easeFactor, 8)
    expect(result.intervalDays).toBe(direct.intervalDays)
    expect(result.repetitions).toBe(direct.repetitions)
  })

  it('resets interval to 1 when content is stale', () => {
    const result = applyReviewWithStalenessCheck(params, 4, 2) // version 2 > stored 1
    expect(result.intervalDays).toBe(1)
  })

  it('resets repetitions to 0 when content is stale', () => {
    const result = applyReviewWithStalenessCheck(params, 4, 2)
    expect(result.repetitions).toBe(0)
  })

  it('preserves ease_factor when content is stale', () => {
    const result = applyReviewWithStalenessCheck(params, 4, 2)
    expect(result.easeFactor).toBe(params.easeFactor)
  })

  it('returns contentChanged: true when content is stale', () => {
    const result = applyReviewWithStalenessCheck(params, 4, 2)
    expect(result.contentChanged).toBe(true)
  })

  it('treats equal version as current (not stale)', () => {
    const result = applyReviewWithStalenessCheck(params, 4, 1)
    expect(result.contentChanged).toBe(false)
  })
})

// ─── nextReviewDate ───────────────────────────────────────

describe('nextReviewDate', () => {
  it('adds intervalDays to the base date at UTC midnight', () => {
    const from = new Date('2026-04-10T14:30:00Z')
    const result = nextReviewDate(1, from)
    expect(result.toISOString().slice(0, 10)).toBe('2026-04-11')
  })

  it('handles 0-day interval (due same day)', () => {
    const from = new Date('2026-04-10T00:00:00Z')
    const result = nextReviewDate(0, from)
    expect(result.toISOString().slice(0, 10)).toBe('2026-04-10')
  })

  it('handles large intervals correctly', () => {
    const from = new Date('2026-04-10T00:00:00Z')
    const result = nextReviewDate(30, from)
    expect(result.toISOString().slice(0, 10)).toBe('2026-05-10')
  })

  it('normalises time component to UTC midnight', () => {
    const from = new Date('2026-04-10T23:59:59Z')
    const result = nextReviewDate(1, from)
    expect(result.getUTCHours()).toBe(0)
    expect(result.getUTCMinutes()).toBe(0)
    expect(result.getUTCSeconds()).toBe(0)
  })
})

// ─── updateStreakDays ─────────────────────────────────────

describe('updateStreakDays', () => {
  const now = new Date('2026-04-10T10:00:00Z') // "today" = 2026-04-10

  it('returns 1 on first ever review (lastReviewedAt = null)', () => {
    expect(updateStreakDays(0, null, now)).toBe(1)
  })

  it('does not change streak when already reviewed today', () => {
    const sameDay = new Date('2026-04-10T05:00:00Z')
    expect(updateStreakDays(7, sameDay, now)).toBe(7)
  })

  it('increments streak when last review was yesterday', () => {
    const yesterday = new Date('2026-04-09T20:00:00Z')
    expect(updateStreakDays(5, yesterday, now)).toBe(6)
  })

  it('resets streak to 1 when gap is 2+ days', () => {
    const twoDaysAgo = new Date('2026-04-08T20:00:00Z')
    expect(updateStreakDays(10, twoDaysAgo, now)).toBe(1)
  })

  it('resets streak to 1 when gap is 7 days', () => {
    const weekAgo = new Date('2026-04-03T20:00:00Z')
    expect(updateStreakDays(30, weekAgo, now)).toBe(1)
  })

  it('streak increment works across month boundary', () => {
    const nowMay = new Date('2026-05-01T10:00:00Z')
    const yesterdayApril = new Date('2026-04-30T22:00:00Z')
    expect(updateStreakDays(14, yesterdayApril, nowMay)).toBe(15)
  })

  it('streak reset works across month boundary', () => {
    const nowMay = new Date('2026-05-01T10:00:00Z')
    const twoDaysAgoApril = new Date('2026-04-29T22:00:00Z')
    expect(updateStreakDays(14, twoDaysAgoApril, nowMay)).toBe(1)
  })

  it('same-day review is idempotent regardless of streak value', () => {
    const sameDay = new Date('2026-04-10T00:01:00Z')
    expect(updateStreakDays(0, sameDay, now)).toBe(0)
    expect(updateStreakDays(42, sameDay, now)).toBe(42)
  })

  it('first review of the day after a break gives streak 1', () => {
    const longAgo = new Date('2020-01-01T00:00:00Z')
    expect(updateStreakDays(100, longAgo, now)).toBe(1)
  })
})
