# E2E Test Journeys

8 critical Playwright journeys run against **staging** as part of CI stage 5.

---

## Setup

```typescript
// playwright.config.ts
export default defineConfig({
  baseURL: process.env.PLAYWRIGHT_BASE_URL, // https://staging.lexis.app
  use: {
    trace: 'on-first-retry',
    screenshot: 'only-on-failure'
  },
  projects: [
    { name: 'chromium', use: devices['Desktop Chrome'] },
    { name: 'webkit', use: devices['Desktop Safari'] }  // For passkey auth test
  ]
})
```

---

## Journey 1 — Teacher onboarding

**Description:** New teacher registers, creates a profile, clones a template, and hits the free plan limit.

```
1. Navigate to /login
2. Enter email → receive OTP → verify code
3. Consent screen → accept
4. Profile creation form → fill name and language
5. Template browser → clone B1 English template
6. Courses list shows cloned course
7. Attempt to create a 6th course → 402 upgrade prompt appears
8. Upgrade modal shows correct plan comparison
```

**Assertions:**
- JWT cookie is set after OTP verify
- Course list shows cloned course with correct tenant_id
- 6th course button is disabled with upgrade prompt

---

## Journey 2 — Student lesson completion

**Description:** Student completes a placement test, opens a lesson, completes all activities, and earns a badge.

```
1. Teacher enrolls student (API call in setup)
2. Student logs in via OTP
3. Onboarding: welcome → placement test (select answers) → result screen
4. First lesson auto-selected based on result level
5. Complete cloze activity → feedback shown → XP animation
6. Complete MCQ activity → correct answer highlighted
7. Lesson progress bar reaches 100%
8. "Lesson Complete" screen with XP total
9. Badge notification: "First Step" badge appears
```

**Assertions:**
- `lesson_progress.status = 'completed'` in DB
- `student_profiles.xp_total` incremented
- `student_badges` row created for `first-step`

---

## Journey 3 — AI lesson generation

**Description:** Teacher generates a lesson with AI, edits it inline, and approves it into a course.

```
1. Teacher opens course → "Generate with AI" button
2. Fills brief: topic="Travel vocabulary", level="B2", grammar="Modal verbs"
3. Clicks Generate → SSE stream appears (content streams in real-time)
4. Generation completes → draft appears in review UI
5. Teacher edits an activity title inline
6. Clicks "Approve" → lesson appears in course unit list
7. Verify ai_drafts.status = 'approved'
8. Verify activity is accessible to enrolled students
```

**Assertions:**
- SSE stream produces visible text tokens
- `ai_drafts.status = 'approved'` after approval
- Course unit list shows new lesson

---

## Journey 4 — Whiteboard session

**Description:** Teacher creates a session, draws on the whiteboard, drops a sticky note, and activates follow mode.

```
1. Teacher creates session with classroom
2. Student joins via /sessions/:id link
3. Teacher draws a stroke (pen tool)
4. Teacher adds sticky note with text "Homework: Unit 3"
5. Teacher activates Follow Mode
6. Student's viewport syncs to teacher viewport (verified via screenshot)
7. Student clicks "Break Free" → teacher sees breaks_count increment
8. Session ends → strokes are flushed (board_strokes.last_flushed_at updates)
```

**Assertions:**
- `board_objects` row created for sticky note
- `follow_sessions.breaks_count` = 1
- `board_strokes.last_flushed_at` is set after session end

---

## Journey 5 — SRS review

**Description:** Student completes SRS review for both flashcard and mini-lesson modes.

```
1. Student logs in after completing a lesson (SRS items queued)
2. Navigate to /review
3. Flashcard: review 3 cards with ratings 5, 4, 2
4. Mini-lesson: complete activity directly in SRS player
5. Review summary screen shows streak increment
6. Verify next_review dates updated in DB
```

**Assertions:**
- `srs_items.interval_days` updated per SM-2
- `student_profiles.streak_days` incremented by 1
- Review summary shows correct count

---

## Journey 6 — Certificate issuance

**Description:** Teacher issues a CEFR certificate; student views the public page and downloads PDF.

```
1. Teacher navigates to student profile
2. Clicks "Issue Certificate" → selects B1 English, adds teacher note
3. Certificate appears in student profile with public URL
4. Navigate to /cert/{public_id} (unauthenticated)
5. Certificate page renders correctly
6. Click "Download PDF" → PDF downloads
7. PDF contains student name, level, teacher name
```

**Assertions:**
- `certificates` row created with unique `public_id`
- Public page renders without authentication
- `pdf_s3_key` set in DB after download

---

## Journey 7 — Passkey auth (WebKit only)

**Description:** Teacher registers and authenticates using passkeys (WebAuthn). WebKit browser required for WebAuthn API.

```
1. Navigate to /login on Safari/WebKit
2. Click "Sign in with passkey"
3. Browser prompts biometric (mocked in Playwright)
4. JWT issued → redirect to dashboard
5. Log out → log in again with passkey
6. JWT re-issued
```

**Note:** Playwright's WebKit driver supports WebAuthn virtual authenticators. Configure in `playwright.config.ts`:
```typescript
use: { launchOptions: { args: ['--enable-web-authn-test-profile'] } }
```

---

## Journey 8 — Analytics dashboard

**Description:** Teacher views student analytics, sees error patterns, and generates a personalised review.

```
1. Teacher navigates to student progress page
2. Analytics load: accuracy chart, SRS health, error patterns visible
3. Error pattern "second_conditional" shows 42% accuracy
4. Teacher clicks "Generate targeted review"
5. AI draft created → teacher approves → lesson added to course
6. Student sees new lesson in their queue
```

**Assertions:**
- Analytics data matches seeded activity attempts
- `ai_drafts` row with capability = `personalised_review`
- New lesson visible in student's course

---

## Load test targets

Run with Artillery weekly (not a CI gate):

| Scenario | Config | Target |
|---|---|---|
| REST API | 100 concurrent users, 5min duration | p99 < 500ms |
| WebSocket | 20 boards × 2 users, 400 events/s | p99 broadcast < 100ms |
| AI generation | 20 concurrent SSE streams | All complete successfully |
| Analytics (cold) | 50 concurrent requests | p99 < 2s |
| Analytics (warm) | 50 concurrent requests (after warmup) | p99 < 50ms |

```bash
pnpm test:load --target staging
```
