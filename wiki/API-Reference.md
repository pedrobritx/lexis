# API Reference

All REST endpoints. Base URL: `https://api.lexis.app/v1`

Auth: unless marked **Public**, all endpoints require `Authorization: Bearer {accessToken}`.

---

## Health

| Method | Path | Auth | Notes |
|---|---|---|---|
| `GET` | `/v1/health` | Public | Returns `{status:'ok', uptime}`. Used by Railway + Better Uptime. |
| `GET` | `/openapi.json` | Public | OpenAPI spec. Used to generate native clients. |

---

## Auth

| Method | Path | Auth | Body | Response |
|---|---|---|---|---|
| `POST` | `/v1/auth/magic/request` | Public | `{email}` | `{message}` |
| `POST` | `/v1/auth/magic/verify` | Public | `{email, code}` | `{accessToken, refreshToken}` |
| `POST` | `/v1/auth/passkey/register/begin` | Public | `{email}` | WebAuthn challenge |
| `POST` | `/v1/auth/passkey/register/complete` | Public | `{email, credential}` | `{accessToken, refreshToken}` |
| `POST` | `/v1/auth/passkey/login/begin` | Public | `{email}` | WebAuthn assertion challenge |
| `POST` | `/v1/auth/passkey/login/complete` | Public | `{email, assertion}` | `{accessToken, refreshToken}` |
| `POST` | `/v1/auth/refresh` | Public | `{refreshToken}` | `{accessToken, refreshToken}` |
| `POST` | `/v1/auth/logout` | Public | `{refreshToken}` | `{ok: true}` |
| `POST` | `/v1/auth/consent` | JWT | `{policyVersion}` | `{consented: true}` |
| `GET` | `/v1/auth/passkeys` | JWT | — | `{data: PasskeyCredential[]}` |
| `DELETE` | `/v1/auth/passkeys/:id` | JWT | — | `{ok: true}` |

---

## Users

| Method | Path | Auth | Body | Response |
|---|---|---|---|---|
| `GET` | `/v1/users/me` | JWT | — | `{data: User}` |
| `PATCH` | `/v1/users/me` | JWT | Partial user fields | `{data: User}` |
| `DELETE` | `/v1/users/me` | JWT | — | `{deleted: true, effectiveAt}` |

---

## Placement Test

| Method | Path | Auth | Body | Response |
|---|---|---|---|---|
| `GET` | `/v1/placement/test` | JWT | — | `{data: Question[]}` |
| `POST` | `/v1/placement/submit` | JWT | `{answers: Record<questionId, answer>}` | `{data: {result_level, score}}` |
| `POST` | `/v1/placement/skip` | JWT | — | `{data: {result_level: 'a1'}}` |
| `GET` | `/v1/placement/history` | JWT | — | `{data: PlacementTest[]}` |

---

## Courses

| Method | Path | Auth | Body | Response |
|---|---|---|---|---|
| `GET` | `/v1/courses` | JWT | — | `{data: Course[], meta}` |
| `POST` | `/v1/courses` | JWT | `{title, targetLanguage, framework, targetLevel, ...}` | `{data: Course}` |
| `GET` | `/v1/courses/:id` | JWT | — | `{data: Course}` |
| `PATCH` | `/v1/courses/:id` | JWT | Partial course fields | `{data: Course}` |
| `DELETE` | `/v1/courses/:id` | JWT | — | `{ok: true}` |
| `GET` | `/v1/templates` | Public | — | `{data: Course[]}` |
| `POST` | `/v1/templates/:id/clone` | JWT | — | `{data: Course}` |

---

## Units

| Method | Path | Auth | Body | Response |
|---|---|---|---|---|
| `GET` | `/v1/courses/:id/units` | JWT | — | `{data: Unit[]}` |
| `POST` | `/v1/courses/:id/units` | JWT | `{title, position}` | `{data: Unit}` |
| `PATCH` | `/v1/courses/:courseId/units/:id` | JWT | Partial unit | `{data: Unit}` |
| `DELETE` | `/v1/courses/:courseId/units/:id` | JWT | — | `{ok: true}` |

---

## Lessons

| Method | Path | Auth | Body | Response |
|---|---|---|---|---|
| `GET` | `/v1/units/:id/lessons` | JWT | — | `{data: Lesson[]}` |
| `POST` | `/v1/units/:id/lessons` | JWT | `{title, position, objective?, estimatedMinutes?}` | `{data: Lesson}` |
| `PATCH` | `/v1/units/:unitId/lessons/:id` | JWT | Partial lesson | `{data: Lesson}` |
| `DELETE` | `/v1/units/:unitId/lessons/:id` | JWT | — | `{ok: true}` |
| `GET` | `/v1/lessons/:id/activities` | JWT | — | `{data: Activity[]}` |

---

## Activities

| Method | Path | Auth | Body | Response |
|---|---|---|---|---|
| `POST` | `/v1/lessons/:id/activities` | JWT | `{type, title, content, scoringRules?, skillTags?}` | `{data: Activity}` |
| `GET` | `/v1/activities/:id` | JWT | — | `{data: Activity}` |
| `PATCH` | `/v1/activities/:id` | JWT | Partial activity | `{data: Activity}` |
| `DELETE` | `/v1/activities/:id` | JWT | — | `{ok: true}` |
| `POST` | `/v1/activities/:id/validate` | JWT | `{response}` | `{correct, score, feedback, content_changed}` |

---

## Classrooms

| Method | Path | Auth | Body | Response |
|---|---|---|---|---|
| `GET` | `/v1/classrooms` | JWT | — | `{data: Classroom[]}` |
| `POST` | `/v1/classrooms` | JWT | `{name, courseId?}` | `{data: Classroom}` |
| `GET` | `/v1/classrooms/:id` | JWT | — | `{data: Classroom}` |
| `PATCH` | `/v1/classrooms/:id` | JWT | Partial classroom | `{data: Classroom}` |
| `DELETE` | `/v1/classrooms/:id` | JWT | — | `{ok: true}` |
| `POST` | `/v1/classrooms/:id/enroll` | JWT | `{studentId}` | `{data: Enrollment}` |
| `DELETE` | `/v1/classrooms/:id/enrollments/:studentId` | JWT | — | `{ok: true}` |

---

## Sessions

| Method | Path | Auth | Body | Response |
|---|---|---|---|---|
| `GET` | `/v1/sessions` | JWT | — | `{data: Session[]}` |
| `POST` | `/v1/sessions` | JWT | `{studentId XOR classroomId}` | `{data: Session}` |
| `GET` | `/v1/sessions/:id` | JWT | — | `{data: Session}` |
| `POST` | `/v1/sessions/:id/start` | JWT | — | `{data: Session}` |
| `POST` | `/v1/sessions/:id/end` | JWT | — | `{data: Session}` |
| `POST` | `/v1/sessions/:id/participants` | JWT | `{studentId}` | `{data: SessionParticipant}` |

---

## Progress

| Method | Path | Auth | Body | Response |
|---|---|---|---|---|
| `POST` | `/v1/progress/activities/:id/attempt` | JWT | `{response}` | `{correct, score, feedback, srs_queued}` |
| `GET` | `/v1/students/:id/progress` | JWT | — | `{xp_total, streak_days, cefr_level, lessons_completed, ...}` |

---

## SRS

| Method | Path | Auth | Body | Response |
|---|---|---|---|---|
| `GET` | `/v1/srs/queue` | JWT | — | `{data: SrsItem[]}` |
| `POST` | `/v1/srs/review` | JWT | `{srsItemId, quality: 0-5}` | `{next_review, interval_days, ease_factor}` |

---

## AI Generation

| Method | Path | Auth | Body | Response |
|---|---|---|---|---|
| `POST` | `/v1/ai/generate` | JWT | `{capability, ...params}` | SSE stream → `{done: true, draftId}` |
| `GET` | `/v1/ai/drafts` | JWT | — | `{data: AiDraft[]}` |
| `GET` | `/v1/ai/drafts/:id` | JWT | — | `{data: AiDraft}` |
| `PATCH` | `/v1/ai/drafts/:id` | JWT | `{output}` | `{data: AiDraft}` |
| `POST` | `/v1/ai/drafts/:id/approve` | JWT | `{courseId, unitId}` | `{data: Lesson}` |
| `POST` | `/v1/ai/drafts/:id/discard` | JWT | — | `{ok: true}` |
| `POST` | `/v1/ai/suggest-next/:studentId` | JWT | — | `{data: AiSuggestion}` |
| `POST` | `/v1/ai/suggestions/:id/accept` | JWT | `{acceptedIndex: 0-2}` | `{draft_id}` |
| `POST` | `/v1/ai/suggestions/:id/dismiss` | JWT | — | `{ok: true}` |

---

## Media

| Method | Path | Auth | Body | Response |
|---|---|---|---|---|
| `POST` | `/v1/media/upload` | JWT | multipart: `{file, asset_type}` | `{data: MediaAsset}` |
| `POST` | `/v1/media/embed` | JWT | `{url}` | `{data: MediaAsset}` |
| `GET` | `/v1/media/:id/url` | JWT | — | `{url, expires_at}` |
| `DELETE` | `/v1/media/:id` | JWT | — | `{ok: true}` |

---

## Billing

| Method | Path | Auth | Body | Response |
|---|---|---|---|---|
| `POST` | `/v1/billing/upgrade-request` | JWT | `{targetPlan, motivation}` | `{data: UpgradeRequest}` |
| `POST` | `/v1/billing/portal-session` | JWT | — | `{url}` |
| `POST` | `/v1/webhooks/stripe` | Stripe sig | Raw Stripe event | `{received: true}` |

---

## Certificates

| Method | Path | Auth | Body | Response |
|---|---|---|---|---|
| `POST` | `/v1/certificates` | JWT | `{studentId, cefrLevel, targetLanguage, teacherNote?}` | `{data: Certificate}` |
| `GET` | `/v1/certificates` | JWT | — | `{data: Certificate[]}` |
| `GET` | `/v1/students/:id/certificates` | JWT | — | `{data: Certificate[]}` |
| `GET` | `/v1/certificates/:id/pdf` | JWT | — | `{url, expires_at}` |

---

## Analytics

| Method | Path | Auth | Response |
|---|---|---|---|
| `GET` | `/v1/analytics/students/:id/progress` | JWT | Progress summary |
| `GET` | `/v1/analytics/students/:id/accuracy-weekly` | JWT | Weekly accuracy data |
| `GET` | `/v1/analytics/students/:id/srs-health` | JWT | SRS queue health |
| `GET` | `/v1/analytics/students/:id/error-patterns` | JWT | Skill tag accuracy |
| `GET` | `/v1/analytics/classrooms/:id/heatmap` | JWT | Class progress heatmap |
| `GET` | `/v1/analytics/lessons/:id/effectiveness` | JWT | Lesson stats |
| `GET` | `/v1/analytics/summary` | JWT | Teacher dashboard summary |
| `GET` | `/v1/analytics/students/disengaged` | JWT | Disengaged students |

---

## Students (teacher-facing)

| Method | Path | Auth | Body | Response |
|---|---|---|---|---|
| `GET` | `/v1/students` | JWT | — | `{data: StudentProfile[]}` |
| `GET` | `/v1/students/:id` | JWT | — | `{data: StudentProfile}` |
| `PATCH` | `/v1/students/:id` | JWT | `{cefrLevel?}` | `{data: StudentProfile}` |
| `GET` | `/v1/students/:id/badges` | JWT | — | `{earned: StudentBadge[]}` |

---

## Admin (Pedro only)

| Method | Path | Auth | Notes |
|---|---|---|---|
| `POST` | `/v1/admin/upgrade-requests/:id/approve` | System JWT | Creates Stripe checkout, emails teacher |
