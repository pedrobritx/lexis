# GamificationAgent

You are building the **gamification system** for Lexis: badges, streaks, and progress certificates.

## Before you start

Read:
1. `docs/schema.md` — badges, student_badges, certificates, student_profiles (streak fields)
2. `docs/phases.md` — Phase 4 Week 3

## What you are building

Event-driven badge awards, timezone-aware streak tracking with grace period, and teacher-issued CEFR certificates with public SSR page + PDF download.

## Files to create

```
apps/api/src/modules/gamification/
  gamification.routes.ts
  badge.service.ts        Evaluator registry + award flow
  streak.service.ts       Streak evaluation logic
  certificate.service.ts  Issuance + PDF generation
  gamification.test.ts

apps/api/src/workers/
  streak.worker.ts        Midnight timezone-aware cron
  certificate-pdf.worker.ts  BullMQ job for Puppeteer PDF

apps/web/src/app/cert/
  [publicId]/page.tsx     SSR public certificate page (unauthenticated)
```

## Badge catalogue (seed in migration)

Seed these 12 badges with their trigger criteria:

| Slug | Trigger type | Criteria |
|---|---|---|
| `first-lesson` | `lesson_completed` | completedLessons >= 1 |
| `streak-7` | `streak_milestone` | streakDays === 7 |
| `streak-30` | `streak_milestone` | streakDays === 30 |
| `unit-complete` | `unit_completed` | true |
| `grammar-master` | `skill_accuracy` | accuracy >= 0.90 AND attempts >= 10 |
| `perfect-score` | `lesson_completed` | scorePct === 1.0 AND firstAttempt |
| `srs-champion` | `srs_reviewed` | totalQuality4Plus >= 100 |
| `consistent-learner` | `streak_milestone` | activeDays14 (not necessarily consecutive) |
| `fast-learner` | `lesson_completed` | lessonsThisWeek >= 5 |
| `comeback-kid` | `lesson_completed` | daysSinceLastActive >= 7 |
| `top-of-class` | `monthly_calculation` | highestAccuracyInClassroom |
| `level-up` | `cefr_promoted` | true |

## Badge evaluator pattern

```typescript
// packages/gamification/src/evaluators/
type BadgeEvaluator = (event: GameEvent, studentState: StudentState) => boolean

const evaluators: Record<string, BadgeEvaluator> = {
  'first-lesson': (event, state) => state.completedLessons >= 1,
  'grammar-master': (event, state) =>
    state.skillAccuracy[event.skillTag] >= 0.90 &&
    state.skillAttempts[event.skillTag] >= 10,
  // ...
}

// After each relevant event:
for (const badge of allBadges) {
  const alreadyEarned = await hasEarnedBadge(studentId, badge.id)
  if (!alreadyEarned && evaluators[badge.slug]?.(event, state)) {
    await awardBadge(studentId, badge.id)
    eventBus.emit('badge.earned', { studentId, badge })
  }
}
```

Event bus subscriptions: `lesson.completed`, `activity.correct`, `srs.reviewed`, `streak.milestone`, `cefr.promoted`.

## Streak system

### Midnight timezone cron

```typescript
// streak.worker.ts — BullMQ RepeatableJob
// Runs at midnight UTC. For each distinct timezone in student_profiles:
// Schedule evaluation for that timezone's local midnight.

// Evaluation for one student:
const today = getLocalDate(student.timezone)
const yesterday = subDays(today, 1)
const hadActivity = await checkActivityOnDate(studentId, yesterday)

if (hadActivity) {
  await incrementStreak(studentId)
  checkMilestone(newStreak)  // emit streak.milestone at 7, 30, 100
} else {
  const graceEligible = student.streak_days >= 7 &&
    (!student.streak_grace_used_at ||
     student.streak_grace_used_at < subDays(today, 30))

  if (graceEligible && !student.graceActivatedYesterday) {
    // Hold streak, activate grace
    await activateGracePeriod(studentId)
  } else {
    // Break streak
    await breakStreak(studentId)
  }
}
```

### Grace period
- Activates when streak ≥ 7, day missed, grace not used in last 30 days
- Sets a flag that next day's evaluation will consume grace if still inactive
- After grace consumed: `streak_grace_used_at = now()`
- Two consecutive inactive days → always breaks streak

## Certificates

```typescript
// POST /v1/certificates (teacher-only)
const cert = await prisma.certificate.create({
  data: {
    publicId: nanoid(12),  // e.g. "lex_b1_k7x2m"
    tenantId, studentId,
    issuedBy: req.user.userId,
    cefrLevel, targetLanguage,
    teacherNote: req.body.note,
  }
})
// Emit certificate.issued event → notify student
```

**Public page** (`/cert/:publicId`): Next.js SSR, `getServerSideProps`, no auth required. Include Open Graph meta tags for social sharing preview. Animated blob mark on load.

**PDF generation:** Puppeteer renders `/cert/:publicId?format=pdf` with `@media print` styles. Upload to R2 at `certificates/{publicId}.pdf`. Cache `pdf_s3_key` on the certificate record. Subsequent requests return the cached signed URL without regenerating.

```typescript
// GET /v1/certificates/:id/pdf
const cert = await getCertificate(id, req.user.tenantId)
if (cert.pdf_s3_key) {
  // Return cached signed URL
  return { url: await getSignedUrl(cert.pdf_s3_key) }
}
// Generate via Puppeteer (in BullMQ worker for long-running jobs)
const pdfBuffer = await generatePdf(cert.publicId)
const key = `certificates/${cert.publicId}.pdf`
await uploadToR2(key, pdfBuffer)
await updateCertificate(cert.id, { pdf_s3_key: key })
return { url: await getSignedUrl(key) }
```

## Definition of done

- All 12 badges seed correctly
- Each badge awards exactly once (no duplicates)
- Badge evaluators pass unit tests
- Streak increments on activity completion
- Grace period applies once per 30 days when streak ≥ 7
- Streak milestones emit `streak.milestone` event
- Certificate public page loads unauthenticated at `/cert/:publicId`
- PDF generates and caches in R2
- Growth tier: teacher logo appears on certificate
