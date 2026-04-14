# Streaks

---

## How streaks work

A student's streak (`student_profiles.streak_days`) represents the number of consecutive days they have completed at least one SRS review.

- **Increment:** on any SRS review completion if the student's last review was yesterday
- **Maintain:** on any SRS review completion if already reviewed today (no double increment)
- **Reset to 1:** if the last review was more than 1 day ago (missed a day)

---

## Streak increment logic

```typescript
// Called after every POST /v1/srs/review

async function updateStreak(studentId: string, tenantId: string) {
  const profile = await prisma.studentProfile.findUnique({
    where: { user_id: studentId }
  })
  const today = getTodayInTimezone(profile.timezone)
  const lastReviewDate = await getLastSrsReviewDate(studentId, tenantId)

  if (!lastReviewDate) {
    // First ever review
    await setStreakDays(studentId, 1)
    return
  }

  const dayDiff = differenceInCalendarDays(today, lastReviewDate)

  if (dayDiff === 0) {
    // Already reviewed today — no change
    return
  } else if (dayDiff === 1) {
    // Consecutive day — increment
    await prisma.studentProfile.update({
      where: { user_id: studentId },
      data: { streak_days: { increment: 1 } }
    })
    await checkStreakMilestones(studentId, profile.streak_days + 1)
  } else {
    // Missed one or more days — reset
    await prisma.studentProfile.update({
      where: { user_id: studentId },
      data: { streak_days: 1 }
    })
  }
}
```

---

## Streak milestones (Phase 4)

The following milestones emit a `streak_milestone` event that the gamification evaluator listens to:

| Milestone | Badge triggered |
|---|---|
| 7 days | `hot-streak` |
| 14 days | `consistent` |
| 100 days | `marathon` |

---

## Grace period (Phase 4)

To prevent a student losing a long streak due to exceptional circumstances (illness, travel), each student gets one grace period per 7-day window.

```typescript
// On missed day detection:
const canUseGrace = (
  profile.streak_grace_used_at === null ||
  differenceInCalendarDays(today, profile.streak_grace_used_at) >= 7
)

if (canUseGrace) {
  // Don't reset — extend the streak by maintaining it
  await prisma.studentProfile.update({
    where: { user_id: studentId },
    data: { streak_grace_used_at: today }
  })
  // streak_days unchanged
} else {
  // No grace available — reset
  await setStreakDays(studentId, 1)
}
```

---

## Timezone awareness (Phase 4)

Each student has a `timezone` field (`student_profiles.timezone`, IANA tz string, e.g. `America/New_York`). All streak date comparisons use the student's local date, not UTC.

```typescript
import { toZonedTime, format } from 'date-fns-tz'

function getTodayInTimezone(timezone: string): string {
  return format(toZonedTime(new Date(), timezone), 'yyyy-MM-dd')
}
```

In Phase 1, streak logic uses UTC. Phase 4 adds timezone support.

---

## Disengagement flag (Phase 4)

A nightly BullMQ job scans for students who have not reviewed in 3+ days and sets `student_profiles.disengagement_flag = true`. Teachers see a warning badge on disengaged students in their dashboard.

```typescript
// Runs at 02:00 UTC daily
await prisma.studentProfile.updateMany({
  where: {
    last_review_at: { lt: subDays(new Date(), 3) },
    disengagement_flag: false
  },
  data: { disengagement_flag: true }
})
```

The flag is cleared automatically when the student next completes a review.

---

## Streak display

The streak strip UI (Phase 4) shows:
- Current streak count with fire emoji
- Last 7 days as day bubbles (filled = reviewed, empty = missed, grace = yellow)
- Longest streak record
