// ─── Types ────────────────────────────────────────────────

/**
 * Snapshot of an SRS item's scheduling state.
 * Matches the srs_items table columns used by SM-2.
 */
export interface SrsScheduleParams {
  easeFactor: number
  intervalDays: number
  repetitions: number
  activityVersion: number
}

export interface SrsReviewResult {
  easeFactor: number
  intervalDays: number
  repetitions: number
  contentChanged: boolean
}

// ─── Constants ────────────────────────────────────────────

const EF_MIN = 1.3
const EF_MAX = 2.5

// ─── SM-2 algorithm ───────────────────────────────────────

/**
 * Apply one SM-2 review cycle (pure function — no I/O).
 *
 * quality 0-5:
 *   0 = complete blackout
 *   1 = wrong answer but correct remembered
 *   2 = wrong answer; correct was easy to recall
 *   3 = correct with serious difficulty
 *   4 = correct with hesitation
 *   5 = perfect response
 *
 * Returns new scheduling state. The caller is responsible for
 * persisting the result and computing nextReviewDate.
 */
export function applyReview(
  params: Omit<SrsScheduleParams, 'activityVersion'>,
  quality: number,
): Omit<SrsReviewResult, 'contentChanged'> {
  if (!Number.isInteger(quality) || quality < 0 || quality > 5) {
    throw new RangeError('quality must be an integer 0–5')
  }

  const { easeFactor, intervalDays, repetitions } = params

  let newInterval: number
  let newRepetitions: number

  if (quality >= 3) {
    // Correct response — advance schedule
    if (repetitions === 0) {
      newInterval = 1
    } else if (repetitions === 1) {
      newInterval = 6
    } else {
      // Uses OLD easeFactor (before this review's EF update), per SM-2 spec
      newInterval = Math.round(intervalDays * easeFactor)
    }
    newRepetitions = repetitions + 1
  } else {
    // Incorrect response — restart from beginning
    newInterval = 1
    newRepetitions = 0
  }

  // EF update always happens, regardless of correct/incorrect
  const efDelta = 0.1 - (5 - quality) * (0.08 + (5 - quality) * 0.02)
  const newEaseFactor = Math.min(EF_MAX, Math.max(EF_MIN, easeFactor + efDelta))

  return {
    easeFactor: newEaseFactor,
    intervalDays: newInterval,
    repetitions: newRepetitions,
  }
}

/**
 * Apply SM-2 with an activity version staleness check.
 *
 * If `currentActivityVersion > params.activityVersion`, the content
 * has changed since the item was created. In that case:
 *   - interval resets to 1 (student re-learns updated content)
 *   - repetitions reset to 0
 *   - easeFactor is preserved
 *   - contentChanged: true is returned (caller must update activityVersion in DB)
 *
 * Otherwise delegates to applyReview() normally.
 */
export function applyReviewWithStalenessCheck(
  params: SrsScheduleParams,
  quality: number,
  currentActivityVersion: number,
): SrsReviewResult {
  if (currentActivityVersion > params.activityVersion) {
    return {
      easeFactor: params.easeFactor,
      intervalDays: 1,
      repetitions: 0,
      contentChanged: true,
    }
  }

  return {
    ...applyReview(params, quality),
    contentChanged: false,
  }
}

// ─── Scheduling helpers ───────────────────────────────────

/**
 * Compute the UTC date on which the next review should occur.
 *
 * @param intervalDays Days until next review (from SM-2 result)
 * @param from         Base date — defaults to today UTC. Start-of-day is used.
 */
export function nextReviewDate(intervalDays: number, from?: Date): Date {
  const base = from ? new Date(from) : new Date()
  base.setUTCHours(0, 0, 0, 0)
  base.setUTCDate(base.getUTCDate() + intervalDays)
  return base
}

// ─── Streak logic ─────────────────────────────────────────

/**
 * Compute the new streak_days value after a review session.
 *
 * Rules (all UTC calendar days):
 *   - First ever review (lastReviewedAt = null) → streak = 1
 *   - Already reviewed today                    → no change
 *   - Last review was yesterday                  → streak + 1
 *   - Gap of 2+ days                            → reset to 1
 *
 * @param currentStreak  Current student_profiles.streak_days
 * @param lastReviewedAt Timestamp of the most recent prior SRS review (null if none)
 * @param nowUTC         Current time (injectable for testing)
 */
export function updateStreakDays(
  currentStreak: number,
  lastReviewedAt: Date | null,
  nowUTC: Date,
): number {
  if (lastReviewedAt === null) {
    return 1
  }

  const today = utcDateString(nowUTC)
  const lastDay = utcDateString(lastReviewedAt)

  if (today === lastDay) {
    // Already counted today — idempotent
    return currentStreak
  }

  const yesterday = utcDateString(new Date(nowUTC.getTime() - 86_400_000))

  if (lastDay === yesterday) {
    return currentStreak + 1
  }

  // Missed one or more days
  return 1
}

function utcDateString(date: Date): string {
  return date.toISOString().slice(0, 10) // 'YYYY-MM-DD'
}
