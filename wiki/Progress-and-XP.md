# Progress and XP

---

## Lesson progress

### Progress states

```
not_started → in_progress → completed
```

A `lesson_progress` row is created with `status = 'not_started'` when a student is enrolled in a course. It transitions to `in_progress` on the first activity attempt, and to `completed` when all activities are done.

### Auto-complete logic

```typescript
// Called after every activity attempt
async function checkLessonCompletion(lessonId: string, studentId: string, tenantId: string) {
  const totalActivities = await prisma.activity.count({
    where: { lesson_id: lessonId, deleted_at: null }
  })
  const attempted = await prisma.activityAttempt.count({
    where: { activity: { lesson_id: lessonId }, student_id: studentId, tenant_id: tenantId }
  })
  if (attempted >= totalActivities) {
    await prisma.lessonProgress.update({
      where: { lesson_id_student_id: { lesson_id: lessonId, student_id: studentId } },
      data: { status: 'completed', completed_at: new Date() }
    })
    events.emit('lesson.completed', { lessonId, studentId, tenantId })
  }
}
```

### `lesson.completed` event consumers

| Consumer | Action |
|---|---|
| `progress` module | Computes `score_pct` |
| `gamification` module | Evaluates badge triggers |
| `srs` module | Queues activity SRS items |
| `ai-generator` module | Potentially triggers next-lesson suggestion |

---

## Activity attempts

### Endpoint

```
POST /v1/progress/activities/:id/attempt
  Body: {response: <student answer>}
  Response: {correct, score, feedback, srs_queued}
```

### What happens on attempt

1. Log `activity_attempts` row
2. Run validation (see [[Courses-and-Content]] activity validation)
3. Update `lesson_progress` if needed
4. If correct → check if SRS item should be created/updated
5. Return validation result

### Score calculation

- `correct: true/false` — pass/fail
- `score: 0.0–1.0` — for partial scoring (ordering) or rubric-graded activities
- For `cloze` and `mcq`: `score` is `1.0` if correct, `0.0` if not

---

## XP system

XP is awarded when a `lesson.completed` event fires.

### XP formula

```typescript
// Base XP per lesson
const baseXP = 100

// Accuracy bonus: up to 50 additional XP
const accuracy = score_pct / 100
const accuracyBonus = Math.floor(accuracy * 50)

// Streak multiplier: 1.0x – 1.5x
const streakMultiplier = Math.min(1 + (streak_days * 0.01), 1.5)

const xpEarned = Math.floor((baseXP + accuracyBonus) * streakMultiplier)

// Atomic increment
await prisma.studentProfile.update({
  where: { user_id: studentId },
  data: { xp_total: { increment: xpEarned } }
})
```

XP is never decremented. It is only added.

---

## Progress summary endpoint

```
GET /v1/students/:id/progress
  Response:
  {
    "xp_total": 1250,
    "streak_days": 7,
    "cefr_level": "b1",
    "lessons_completed": 24,
    "lessons_total": 40,
    "completion_pct": 60,
    "recent_activity": [...]
  }
```

---

## Lesson delivery

```
GET /v1/lessons/:id/activities
  → Returns ordered activity list for the lesson

POST /v1/progress/activities/:id/attempt
  → Log attempt, validate answer, return feedback
  → Auto-complete lesson if all activities attempted
```

Progress bar on the student lesson view is computed as:
```
progress = attempted_activities / total_activities
```
