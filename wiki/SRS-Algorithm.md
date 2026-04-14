# SRS Algorithm

Lexis uses the SM-2 algorithm for spaced repetition. The implementation lives in `packages/srs`.

---

## SM-2 algorithm

### Parameters

| Parameter | Default | Range | Notes |
|---|---|---|---|
| `ease_factor` | 2.5 | 1.3 – 2.5 | How quickly the interval grows |
| `interval_days` | 1 | 1 – ∞ | Days until next review |
| `repetitions` | 0 | 0 – ∞ | Successful review count |
| `next_review` | today | date | Scheduled next review date |

### Quality ratings

Students provide a quality rating after each review (0–5):

| Rating | Meaning |
|---|---|
| 5 | Perfect response |
| 4 | Correct with slight hesitation |
| 3 | Correct with difficulty |
| 2 | Incorrect — easy to remember |
| 1 | Incorrect — hard |
| 0 | Complete blackout |

### Interval calculation

```typescript
function updateSrsItem(item: SrsItem, quality: number): SrsItem {
  if (quality < 3) {
    // Failed — reset repetitions and interval
    return {
      ...item,
      repetitions: 0,
      interval_days: 1,
      ease_factor: Math.max(1.3, item.ease_factor - 0.2),
      next_review: addDays(today(), 1)
    }
  }

  // Passed
  let newInterval: number
  if (item.repetitions === 0) {
    newInterval = 1
  } else if (item.repetitions === 1) {
    newInterval = 6
  } else {
    newInterval = Math.round(item.interval_days * item.ease_factor)
  }

  const newEaseFactor = Math.min(
    2.5,
    Math.max(1.3, item.ease_factor + (0.1 - (5 - quality) * (0.08 + (5 - quality) * 0.02)))
  )

  return {
    ...item,
    repetitions: item.repetitions + 1,
    interval_days: newInterval,
    ease_factor: newEaseFactor,
    next_review: addDays(today(), newInterval)
  }
}
```

### Ease factor bounds

- **Minimum:** 1.3 (never go lower — prevents intervals from stagnating)
- **Maximum:** 2.5 (never go higher — set at creation)

---

## SRS queue

```
GET /v1/srs/queue
  → Returns activities due today (next_review <= today)
  → Ordered by priority: overdue first, then by ease_factor ascending
  → Limited to 20 items per session by default

POST /v1/srs/review
  Body: {srsItemId, quality: 0–5}
  → Updates srs_items via SM-2 calculation
  → Updates streak (see Streak logic below)
  Response: {next_review, interval_days, ease_factor}
```

---

## SRS item creation

SRS items are created when a lesson is completed:

```typescript
// On lesson.completed event:
// For each activity in the lesson:
await prisma.srsItem.upsert({
  where: { student_id_activity_id: { student_id, activity_id } },
  create: {
    student_id,
    activity_id,
    tenant_id,
    srs_mode: activity.srs_mode ?? 'flashcard',
    ease_factor: 2.5,
    interval_days: 1,
    next_review: addDays(today(), 1),
    activity_version: activity.version,  // Snapshot current version
    repetitions: 0
  },
  update: {} // Don't reset if item already exists
})
```

---

## Stale content detection

If an activity is edited after a student's SRS item was created:

```typescript
// In /v1/srs/queue:
const item = await prisma.srsItem.findFirst({ where: { id } })
const activity = await prisma.activity.findUnique({ where: { id: item.activity_id } })

if (item.activity_version < activity.version) {
  // Content has changed — reset this item
  await prisma.srsItem.update({
    where: { id: item.id },
    data: {
      interval_days: 1,
      repetitions: 0,
      ease_factor: 2.5,
      next_review: today(),
      activity_version: activity.version
    }
  })
  return { ...item, content_changed: true }
}
```

`content_changed: true` is returned in the queue response so the UI can display a "This content was updated" notice.

---

## SRS delivery modes

| Mode | UI | When used |
|---|---|---|
| `flashcard` | Front/back card, flip to reveal | Vocabulary, translations, isolated facts |
| `mini_lesson` | Full activity player (same as lesson view) | Grammar exercises, contextual practice |

The mode is set per activity in `activities.srs_mode`. If null, defaults to `flashcard`.

---

## Streak logic

A streak is incremented when a student completes at least 1 SRS review on a given calendar day.

```typescript
// After a successful review:
const lastReview = await getLastReviewDate(studentId)
const today = getTodayInStudentTimezone(student.timezone)

if (lastReview === yesterday(today)) {
  // Consecutive day — increment
  await prisma.studentProfile.update({
    where: { user_id: studentId },
    data: { streak_days: { increment: 1 } }
  })
} else if (lastReview !== today) {
  // Missed day — reset (Phase 4 adds grace period)
  await prisma.studentProfile.update({
    where: { user_id: studentId },
    data: { streak_days: 1 }
  })
}
// If lastReview === today: already reviewed today — no change
```

The grace period mechanic (Phase 4) allows one missed day per 7-day window without breaking the streak. See [[Streaks]].

---

## Test requirements

The SRS module requires **90% coverage**. The critical test sequence:

```typescript
// Feed quality ratings [4, 4, 5, 3, 4, 5, 5, 2, 4, 5]
// Assert interval and ease_factor after each step
// Verify ease_factor never goes below 1.3 or above 2.5
// Verify stale version detection resets interval to 1
```
