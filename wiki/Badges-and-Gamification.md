# Badges and Gamification

---

## Badge catalogue

12 badges seeded as system data. Tenants cannot create or modify badges. The catalogue is seeded in `pnpm db:seed`.

### Common badges (7)

| Slug | Name | Trigger | Criteria | XP |
|---|---|---|---|---|
| `first-step` | First Step | `lesson_completed` | 1 lesson completed | 50 |
| `hot-streak` | Hot Streak | `streak_milestone` | 7-day streak | 100 |
| `quick-learner` | Quick Learner | `lesson_completed` | 5 lessons completed | 150 |
| `grammar-ace` | Grammar Ace | `activity_correct` | 20 correct grammar activities | 100 |
| `vocab-builder` | Vocab Builder | `activity_correct` | 50 correct vocabulary activities | 100 |
| `srs-beginner` | SRS Beginner | `srs_reviewed` | 10 SRS reviews completed | 75 |
| `consistent` | Consistent | `streak_milestone` | 14-day streak | 200 |

### Rare badges (3)

| Slug | Name | Trigger | Criteria | XP |
|---|---|---|---|---|
| `century` | Century | `lesson_completed` | 100 lessons completed | 500 |
| `perfectionist` | Perfectionist | `lesson_completed` | 10 lessons with 100% score | 300 |
| `srs-master` | SRS Master | `srs_reviewed` | 500 SRS reviews completed | 400 |

### Legendary badges (2)

| Slug | Name | Trigger | Criteria | XP |
|---|---|---|---|---|
| `fluent` | Fluent | `cefr_level_reached` | Reach C1 | 1000 |
| `marathon` | Marathon | `streak_milestone` | 100-day streak | 1000 |

---

## Badge evaluator registry

Each badge has a corresponding evaluator function in `modules/gamification/evaluators/`:

```typescript
// evaluators/first-step.ts
export async function evaluate(event: LessonCompletedEvent, prisma: PrismaClient): Promise<boolean> {
  const count = await prisma.lessonProgress.count({
    where: {
      student_id: event.studentId,
      status: 'completed',
      tenant_id: event.tenantId
    }
  })
  return count >= 1
}
```

The registry maps `trigger_type` → evaluator function and runs on every matching event.

---

## Event bus listeners

The gamification module listens to the internal event bus:

```typescript
// gamification/index.ts
events.on('lesson.completed', async (event) => {
  await evaluateBadges('lesson_completed', event)
  await awardXP(event)
})

events.on('activity.correct', async (event) => {
  await evaluateBadges('activity_correct', event)
})

events.on('srs.reviewed', async (event) => {
  await evaluateBadges('srs_reviewed', event)
})
```

---

## Badge award flow

```typescript
async function evaluateBadges(triggerType: string, event: GamificationEvent) {
  // 1. Get all badges for this trigger type
  const badges = await prisma.badge.findMany({
    where: { trigger_type: triggerType }
  })

  for (const badge of badges) {
    // 2. Check if student already has this badge
    const existing = await prisma.studentBadge.findFirst({
      where: { student_id: event.studentId, badge_id: badge.id }
    })
    if (existing) continue

    // 3. Run the evaluator
    const evaluator = getEvaluator(badge.slug)
    const earned = await evaluator(event, prisma)

    // 4. Award if earned
    if (earned) {
      await prisma.studentBadge.create({
        data: {
          student_id: event.studentId,
          badge_id: badge.id,
          tenant_id: event.tenantId,
          earned_at: new Date()
        }
      })

      // 5. Award XP
      await prisma.studentProfile.update({
        where: { user_id: event.studentId },
        data: { xp_total: { increment: badge.xp_reward } }
      })

      // 6. Emit badge.earned event (for UI notification)
      events.emit('badge.earned', { studentId: event.studentId, badge })
    }
  }
}
```

---

## Badge showcase

Students see their earned badges on their profile page. Badges are displayed in rarity order (legendary → rare → common). Unearned badges are shown as locked silhouettes with the criteria visible.

On Phase 4, a celebration animation (confetti + badge pop-up) triggers immediately when a badge is earned during a session.

---

## Student badges endpoint

```
GET /v1/students/:id/badges
  Response:
  {
    "earned": [
      {
        "slug": "first-step",
        "name": "First Step",
        "rarity": "common",
        "earned_at": "2024-01-15T10:00:00Z",
        "xp_reward": 50
      }
    ],
    "total_xp_from_badges": 300
  }
```
