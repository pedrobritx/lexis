# Placement Test

The placement test assigns a student their initial CEFR level before their first lesson.

---

## Endpoints

```
GET    /v1/placement/test          Fetch test questions (no submission yet)
POST   /v1/placement/submit        Submit answers → returns result_level
POST   /v1/placement/skip          Skip test → result_level = 'a1' (default)
GET    /v1/placement/history       List all placement test results for student
```

---

## Question bank

The bank contains questions for CEFR levels A1 through C1 (5 levels). Each level has:
- 2 MCQ questions
- 1 cloze question

Total: 15 questions per test attempt.

Questions are seeded as system data (not tenant-specific). The question bank is versioned via `placement_tests.question_versions` (snapshot of question IDs used).

---

## Scoring algorithm

```
For each level L from A1 to C1 (ascending):
  Check if both MCQ questions for L are correct AND cloze for L is non-empty
  If yes → candidate_level = L

result_level = highest candidate_level where all conditions are met
If no level passes → result_level = 'a1'
```

Example: student gets A1 and A2 right but fails B1 → `result_level = 'a2'`

---

## Retakeability

**No unique constraint on `(student_id)` in `placement_tests`.** Students can retake the test multiple times. Each attempt creates a new row. The student's `cefr_level` in `student_profiles` is updated to the latest result.

---

## Data model

### `placement_tests`

| Field | Type | Notes |
|---|---|---|
| id | uuid PK | |
| student_id | uuid FK | No unique constraint |
| tenant_id | uuid FK | |
| score | int | Raw correct answer count |
| result_level | enum | `a1`·`a2`·`b1`·`b2`·`c1`·`c2` |
| question_versions | jsonb | Snapshot of question IDs used in this attempt |
| taken_at | timestamp | |

---

## After test completion

1. Set `student_profiles.cefr_level = result_level`
2. Redirect student to level-appropriate starting lesson (from public templates or enrolled course)
3. Record `placement_tests` row for history

---

## Skip flow

`POST /v1/placement/skip`:
1. Creates a `placement_tests` row with `result_level = 'a1'`, `score = 0`
2. Sets `student_profiles.cefr_level = 'a1'`
3. Student proceeds to onboarding with A1 as starting level

The teacher can manually change a student's CEFR level via `PATCH /v1/students/:id`.
