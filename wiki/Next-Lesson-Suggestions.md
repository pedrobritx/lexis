# Next Lesson Suggestions

AI-powered suggestions for what a student should study next, based on their progress and error patterns.

---

## Two trigger modes

### Auto-trigger

A BullMQ job fires after every `lesson.completed` event. It checks conditions and generates a suggestion if met.

**Conditions to trigger auto-generation:**
1. Student has completed ≥ 3 lessons in the current unit
2. No suggestion generated for this student in the last 7 days
3. Last lesson accuracy ≥ 70%

```typescript
events.on('lesson.completed', async ({ studentId, lessonId, tenantId }) => {
  const shouldSuggest = await checkAutoTriggerConditions(studentId, lessonId, tenantId)
  if (shouldSuggest) {
    await suggestNextLessonQueue.add('auto-suggest', { studentId, tenantId, trigger: 'auto' })
  }
})
```

The result is stored in `ai_suggestions` with `trigger = 'auto'` and `status = 'ready'`. The teacher sees an amber badge on the student card in their dashboard.

### On-demand

```
POST /v1/ai/suggest-next/:studentId
  → Immediate — not queued
  → Credit waiver: if an auto-suggestion was generated for this student in the last 24h,
    no credit is charged
  Response: {suggestion_id, suggestions: [{title, rationale, unit_id, lesson_id}]}
```

---

## Generation input

The `suggest_next` capability uses:

```typescript
{
  capability: 'suggest_next',
  studentId,
  lessonHistory: lastNLessons,        // Last 10 completed lessons
  accuracyTrends: weeklyAccuracy,      // 4-week accuracy trend
  currentLevel: student.cefr_level,
  remainingUnits: unitsNotYetStarted,  // Units in enrolled course
  topErrorPatterns: errorPatterns      // Top 3 skill tags by low accuracy
}
```

The AI returns 3 ranked suggestions with rationale:

```json
{
  "suggestions": [
    {
      "rank": 1,
      "lesson_title": "Second conditional in context",
      "rationale": "Student struggles with second conditional (42% accuracy). This lesson reinforces the pattern.",
      "suggested_unit": "Unit 3",
      "difficulty": "b1"
    }
  ]
}
```

---

## Accept flow

```
POST /v1/ai/suggestions/:id/accept
  Body: {acceptedIndex: 0 | 1 | 2}
  → Sets ai_suggestions.status = 'accepted'
  → Sets ai_suggestions.accepted_index
  → The accepted suggestion object becomes the brief for a full_lesson generation
  → Queues POST /v1/ai/generate with capability = 'full_lesson'
  Response: {draft_id}
```

The teacher is then directed to the draft review UI to review and approve the generated lesson before it is added to the course.

---

## Dismiss

```
POST /v1/ai/suggestions/:id/dismiss
  → Sets ai_suggestions.status = 'dismissed'
  → No credit consumed
```

---

## Data model

### `ai_suggestions`

| Field | Type | Notes |
|---|---|---|
| id | uuid PK | |
| tenant_id | uuid FK | |
| student_id | uuid FK | |
| suggestions | jsonb | Array of 3 ranked suggestion objects |
| trigger | enum | `auto` · `manual` |
| status | enum | `ready` · `accepted` · `dismissed` |
| accepted_index | int? | 0, 1, or 2 |
| created_at | timestamp | |

---

## Credit waiver logic

```typescript
async function shouldChargeCredit(studentId: string, tenantId: string): Promise<boolean> {
  const recentAutoSuggestion = await prisma.aiSuggestion.findFirst({
    where: {
      student_id: studentId,
      tenant_id: tenantId,
      trigger: 'auto',
      created_at: { gte: subHours(new Date(), 24) }
    }
  })
  // If auto-suggestion exists within 24h, waive credit for on-demand
  return recentAutoSuggestion === null
}
```
