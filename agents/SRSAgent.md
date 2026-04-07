# SRSAgent

You are building the **spaced repetition system** for Lexis (`packages/srs/` and `apps/api/src/modules/srs/`).

## Before you start

Read in this order:
1. `docs/schema.md` — srs_items table
2. `docs/phases.md` — Phase 1 Day 12

## What you are building

The SM-2 spaced repetition algorithm, SRS queue management, two delivery modes (flashcard + mini-lesson), and streak tracking.

## Files to create

```
packages/srs/
  src/sm2.ts              Pure SM-2 algorithm implementation
  src/sm2.test.ts         Unit tests (90% coverage target)
  src/index.ts

apps/api/src/modules/srs/
  srs.routes.ts
  srs.service.ts          Queue, review logging, streak
  srs.test.ts
```

## SM-2 Algorithm

```typescript
interface SM2Input {
  easeFactor: number      // default 2.5
  intervalDays: number    // default 1
  repetitions: number     // default 0
  quality: 0 | 1 | 2 | 3 | 4 | 5
  activityVersion: number
  currentActivityVersion: number
}

interface SM2Result {
  easeFactor: number
  intervalDays: number
  repetitions: number
  nextReview: Date
  contentChanged: boolean  // true if activity was updated since item created
}
```

### Algorithm rules
- Quality 0–2 (fail): reset interval to 1, ease_factor -= 0.2 (min 1.3)
- Quality 3+ (pass): interval = prev * ease_factor (round up)
- Quality 5: ease_factor += 0.1 (max 2.5)
- Quality 3: ease_factor unchanged
- Quality 4: ease_factor += 0.05
- First review (repetitions=0): quality≥4 → interval=6, quality=3 → interval=1

### Content staleness check
If `activityVersion < currentActivityVersion`:
- Set intervalDays = 1 (reset — student reviews updated content fresh)
- Set contentChanged = true in result
- Do NOT modify easeFactor

## SRS queue endpoint

```
GET /v1/srs/queue
→ Returns up to 20 items where next_review <= today, ordered by next_review ASC
→ Includes activity content for each item
→ Marks contentChanged: true where activity_version stale
→ Falls back to PostgreSQL query if Redis cache miss (graceful degradation)
```

## Delivery modes

Each `srs_item` has `srs_mode: 'flashcard' | 'mini_lesson'`.

**Flashcard:** API returns `{front, back}` pair. Student self-rates quality 0–5. Call `POST /v1/srs/review/:id` with `{quality}`.

**Mini-lesson:** API groups 3–5 items with same `srs_mode = 'mini_lesson'` into one exercise. Auto-graded. Quality derived from score: 100%=5, ≥80%=4, ≥60%=3, <60%=1. Call `POST /v1/srs/review/batch` with `[{id, quality}]`.

## Streak logic

After every review session:
1. Check if student has a `lesson_progress.completed_at` or `srs_items` review today (in their timezone)
2. If yes and last streak date was yesterday: increment `streak_days`
3. If yes and last streak date was today: no change (already counted)
4. If no and last streak date was > 1 day ago: streak break (handled by nightly cron in Phase 4)

## Unit test requirements

The SM-2 test must pin the exact output for a 10-review sequence: feed quality scores `[4,4,5,3,4,5,5,2,4,5]` and assert each resulting `intervalDays` and `easeFactor`. This is the regression anchor for the algorithm.

Also test: ease_factor floor (1.3), ceiling (2.5), stale content version reset.

## Definition of done

- SM-2 unit tests pass including 10-review sequence pin
- ease_factor floor and ceiling enforced
- Content staleness detection works
- SRS queue returns correct items for today
- Flashcard + mini-lesson review endpoints update SM-2 state
- 90%+ coverage on `packages/srs/src/sm2.ts`
