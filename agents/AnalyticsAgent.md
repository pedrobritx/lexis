# AnalyticsAgent

You are building the **analytics system** for Lexis (`apps/api/src/modules/analytics/`).

## Before you start

Read:
1. `docs/schema.md` — activity_attempts, lesson_progress, srs_items, error_patterns, student_profiles
2. `docs/phases.md` — Phase 4 Week 2

## What you are building

Error pattern computation (nightly), student analytics APIs, teacher analytics APIs, disengagement detection, and Redis caching.

## Files to create

```
apps/api/src/modules/analytics/
  analytics.routes.ts
  analytics.service.ts
  analytics.test.ts

apps/api/src/workers/
  error-patterns.worker.ts     Nightly BullMQ job
  disengagement.worker.ts      Nightly BullMQ job
```

## Error pattern computation

Nightly BullMQ cron at 01:00 UTC. For each student active in the last 7 days:

```sql
SELECT
  unnest(a.skill_tags) AS skill_tag,
  COUNT(*) AS attempt_count,
  AVG(CASE WHEN aa.correct THEN 1.0 ELSE 0.0 END) AS accuracy_pct
FROM activity_attempts aa
JOIN activities a ON aa.activity_id = a.id
WHERE
  aa.student_id = $1
  AND aa.tenant_id = $2
  AND aa.attempted_at >= NOW() - INTERVAL '30 days'
GROUP BY skill_tag
ORDER BY accuracy_pct ASC
```

Upsert results into `error_patterns` table. Cache per-student results in Redis: `SET analytics:errors:{studentId} {json} EX 3600`.

Required index (add to migration if missing):
```sql
CREATE INDEX CONCURRENTLY idx_attempts_student_date
  ON activity_attempts(student_id, attempted_at, correct);
```

## API endpoints

### Student analytics

```
GET /v1/analytics/students/:id/progress
→ Lessons completed per unit, accuracy per lesson, timestamps
→ Shape: {units: [{id, title, lessons: [{id, title, score_pct, completed_at}]}]}

GET /v1/analytics/students/:id/accuracy-weekly
→ Average accuracy per ISO week, last 12 weeks
→ Shape: {weeks: [{week: 'YYYY-WNN', accuracy: 0.74, lessons: 3}]}

GET /v1/analytics/students/:id/srs-health
→ SRS item counts by status + weakest 5 items
→ Shape: {overdue: N, dueToday: N, healthy: N, weakest: [{skill_tag, accuracy_pct}]}

GET /v1/analytics/students/:id/errors
→ Top error patterns sorted by accuracy ASC
→ Check Redis cache first, fallback to DB
```

### Teacher analytics

```
GET /v1/analytics/classrooms/:id/heatmap
→ 2D matrix: students × units → accuracy per cell
→ Shape: {students: [{id, name}], units: [{id, title}], cells: [[0.74, 0.82, ...]]}
→ Cache: SET analytics:heatmap:{classroomId} {json} EX 3600

GET /v1/analytics/lessons/:id/effectiveness
→ Completion rate, average score, per-activity drop-off
→ Shape: {completionRate: 0.82, avgScore: 0.74, activities: [{id, title, attempts, avgScore, hintRate}]}

GET /v1/analytics/teacher/summary
→ Aggregate stats for teacher dashboard stat cards
→ Shape: {activeStudents, lessonsThisWeek, pendingSubmissions, disengagedStudents, pendingAiSuggestions}
```

## Cache invalidation

Invalidate a student's analytics cache on every new `activity_attempts` row:
```typescript
// In progress.service.ts, after inserting activity_attempt:
await redis.del(`analytics:errors:${studentId}`)
await redis.del(`analytics:progress:${studentId}`)
// Classroom heatmap also invalidated:
await redis.del(`analytics:heatmap:${classroomId}`)
```

## Disengagement detection

Nightly BullMQ job: for each enrolled student, set `student_profiles.disengagement_flag = true` if:
- Last activity (`MAX(attempted_at)` OR `MAX(completed_at)`) > 5 days ago
- AND `COUNT(*) FROM srs_items WHERE next_review <= today AND student_id = ?` > 3

Clear the flag when a new activity attempt is logged.

## Definition of done

- Error patterns computed nightly, correct SQL aggregation
- Student progress/accuracy/srs-health endpoints return correct data verified against seed
- Classroom heatmap is a correctly-shaped 2D array
- Redis cache hit returns in < 50ms, cache miss computes in < 2s for up to 100 students
- Disengagement flag set/cleared correctly
- `pnpm test:integration` passes with seeded test data
