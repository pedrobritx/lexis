# ContentAgent

You are building the **content management modules** for Lexis: courses, units, lessons, activities, enrollments, sessions, classrooms, placement test.

## Before you start

Read:
1. `docs/schema.md` — courses, units, lessons, activities, classrooms, enrollments, sessions, placement_tests
2. `docs/billing.md` — limit enforcement (courses + students)
3. `docs/phases.md` — Phase 1 Days 6–9

## What you are building

Full CRUD for the content hierarchy, enrollment management, session management, placement test, and public template system.

## Files to create

```
apps/api/src/modules/
  courses/courses.routes.ts + courses.service.ts + courses.test.ts
  activities/activities.routes.ts + activities.service.ts + validators/
  classrooms/classrooms.routes.ts + classrooms.service.ts
  sessions/sessions.routes.ts + sessions.service.ts
  placement/placement.routes.ts + placement.service.ts + placement.test.ts
  progress/progress.routes.ts + progress.service.ts
```

## Key requirements

### Soft-delete everywhere
Never call `prisma.course.delete()`. Always use `softDelete('course', id)` from `packages/db`. Guard: cannot soft-delete a course with active enrollments — return 409.

### Template system
- `GET /v1/templates` — courses where `visibility = 'public_template'`, NO tenant scope
- `POST /v1/templates/:id/clone` — deep clone: copies Course + all Units + Lessons + Activities. Sets `tenant_id = req.user.tenantId` on all cloned records. Creates `template_clones` record. Cloned content starts as `visibility = 'private'`.
- Tenant B cannot PATCH or DELETE tenant A's templates — write operations always check `tenant_id`

### Activity validators

Each activity type has a validator in `activities/validators/`:

**Cloze validator:**
- Normalize: trim + lowercase + collapse whitespace
- If `scoring_rules.accept_near_match = true`: accept if Levenshtein distance ≤ 2
- Return `{correct, score, nearMatch?}`

**Ordering validator (partial scoring):**
- Score = fraction of items in correct relative position
- Full correct = 1.0, fully reversed = 0.0

**Matching validator:**
- One point per correct pair. Score = correct_pairs / total_pairs

**MCQ validator:**
- Check against `answer_key.correctIndex`

**Open writing + listening:** `status = 'pending_review'` always — never auto-graded

### Placement test scoring
Question bank: 2 MCQ + 1 cloze per CEFR level (A1–C1 = 15 questions).
Scoring: the highest level where both MCQs are correct AND cloze is non-empty.
No unique constraint on `student_id` — retakeable.

### Sessions constraint
Exactly one of `student_id` / `classroom_id` must be non-null. Enforce at application layer AND as a database check constraint. Auto-populate `session_participants` from classroom enrollment on group session creation.

## Definition of done

- All CRUD routes are tenant-scoped
- Soft-delete works on courses with enrollment guard
- Template clone deep-copies all levels with correct tenant_id
- All 5 activity validators pass unit tests
- Placement test scoring correct for all levels
- Session creation validates student_id XOR classroom_id
- `pnpm test:unit` and `pnpm test:integration` pass
