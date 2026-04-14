# Analytics

Analytics is a Phase 4 feature. This page documents the data model and APIs.

---

## Error pattern computation

### What it is

Error patterns track a student's accuracy per `skill_tag` over a rolling 30-day window. They are used by the AI to generate personalised review activities.

### Data model

```
error_patterns
  student_id   → which student
  skill_tag    → e.g. "second_conditional", "present_perfect", "irregular_verbs"
  attempt_count → total attempts on activities with this tag in the window
  accuracy_pct  → correct / total * 100
  window_days   → 30 (default)
  last_computed → when this row was last updated
```

### Nightly computation job

A BullMQ job runs at 03:00 UTC daily:

```typescript
// For each student with activity_attempts in the last 30 days:
// For each skill_tag that appears in their attempted activities:

const attempts = await prisma.activityAttempt.findMany({
  where: {
    student_id: studentId,
    attempted_at: { gte: subDays(new Date(), 30) },
    activity: { skill_tags: { has: tag } }
  }
})

const accuracy = attempts.filter(a => a.correct).length / attempts.length * 100

await prisma.errorPattern.upsert({
  where: { student_id_skill_tag: { student_id: studentId, skill_tag: tag } },
  create: { student_id, skill_tag, attempt_count, accuracy_pct, last_computed: now() },
  update: { attempt_count, accuracy_pct, last_computed: now() }
})
```

---

## Student analytics APIs

### Progress summary

```
GET /v1/analytics/students/:id/progress
Response:
{
  "xp_total": 1250,
  "streak_days": 12,
  "lessons_completed": 24,
  "lessons_total": 40,
  "completion_pct": 60.0,
  "cefr_level": "b1"
}
```

### Weekly accuracy

```
GET /v1/analytics/students/:id/accuracy-weekly
Response:
{
  "weeks": [
    { "week": "2024-W12", "accuracy_pct": 78.5, "attempts": 42 },
    { "week": "2024-W13", "accuracy_pct": 82.1, "attempts": 38 }
  ]
}
```

### SRS health

```
GET /v1/analytics/students/:id/srs-health
Response:
{
  "due_today": 5,
  "overdue": 2,
  "avg_ease_factor": 2.2,
  "avg_interval_days": 8.3,
  "reviews_last_7_days": 34
}
```

### Error patterns

```
GET /v1/analytics/students/:id/error-patterns
Response:
{
  "patterns": [
    {
      "skill_tag": "second_conditional",
      "accuracy_pct": 42.0,
      "attempt_count": 24,
      "last_computed": "2024-03-15T03:00:00Z"
    }
  ]
}
```

---

## Teacher analytics APIs

### Class heatmap

```
GET /v1/analytics/classrooms/:id/heatmap
Response:
{
  "students": [
    {
      "student_id": "...",
      "display_name": "Ana",
      "lessons": [
        {"lesson_id": "...", "title": "Unit 2 Lesson 1", "status": "completed", "score_pct": 90}
      ]
    }
  ]
}
```

### Lesson effectiveness

```
GET /v1/analytics/lessons/:id/effectiveness
Response:
{
  "avg_score_pct": 73.4,
  "avg_completion_time_mins": 18,
  "completion_rate": 0.85,
  "hardest_activity": {
    "id": "...",
    "title": "Conditional gap-fill",
    "accuracy_pct": 48.0
  }
}
```

### Teacher summary

```
GET /v1/analytics/summary
Response:
{
  "active_students": 12,
  "lessons_completed_this_week": 47,
  "avg_class_accuracy": 74.2,
  "disengaged_students": 2,
  "top_error_tags": ["second_conditional", "irregular_verbs"]
}
```

---

## Analytics caching

Analytics responses are expensive to compute. All analytics endpoints use Redis cache:

```typescript
const cacheKey = `analytics:${type}:${id}`
const cached = await redis.get(cacheKey)
if (cached) return JSON.parse(cached)

const data = await computeAnalytics(type, id)
await redis.setex(cacheKey, 3600, JSON.stringify(data))  // 1hr TTL
return data
```

- **Cold cache:** p99 target < 2s
- **Warm cache:** p99 target < 50ms

---

## Disengagement flag

Students with `disengagement_flag = true` appear with a warning indicator in the teacher's student roster. The flag is set by the nightly job described in [[Streaks]] and cleared automatically when the student next completes a review.

Teachers can access a list of disengaged students:

```
GET /v1/analytics/students/disengaged
Response: {students: [{id, display_name, days_inactive, last_review_at}]}
```
