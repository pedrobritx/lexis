# Courses and Content

The content hierarchy is: **Course → Unit → Lesson → Activity**. All levels are tenant-scoped and support soft-delete.

---

## Content hierarchy

```
Course
└── Unit (position-ordered)
    └── Lesson (position-ordered)
        └── Activity (position-ordered)
```

---

## Courses

### CRUD endpoints

```
GET    /v1/courses              List all courses for tenant
POST   /v1/courses              Create course (checks lesson_plan limit)
GET    /v1/courses/:id          Get single course
PATCH  /v1/courses/:id          Update course
DELETE /v1/courses/:id          Soft-delete (guarded — see below)
```

### Soft-delete guard

`DELETE /v1/courses/:id` is blocked if the course has active enrollments:

```typescript
const activeEnrollments = await prisma.enrollment.count({
  where: { classroom: { course_id: id }, tenant_id: req.user.tenantId }
})
if (activeEnrollments > 0) {
  throw new ConflictError('resource/has_active_enrollments', 'Archive the classroom first')
}
```

### Public templates

Courses with `visibility = 'public_template'` bypass the tenant isolation middleware. They are readable by any tenant but not modifiable (owned by the system tenant).

```
GET /v1/templates              List all public templates (no auth required)
POST /v1/templates/:id/clone   Deep-clone into the caller's tenant
```

### Template deep-clone

`POST /v1/templates/:id/clone` creates a full copy of the course with all units, lessons, and activities, setting `tenant_id` to the caller's tenant:

```typescript
// Creates in a single transaction:
// 1. New course row (tenant_id = req.user.tenantId, visibility = 'private')
// 2. New unit rows (with new IDs, preserving position)
// 3. New lesson rows (with new IDs, preserving position)
// 4. New activity rows (with new IDs, preserving content)
// 5. template_clones audit row
```

---

## Units and Lessons

```
GET    /v1/courses/:id/units
POST   /v1/courses/:id/units
PATCH  /v1/courses/:id/units/:unitId
DELETE /v1/courses/:id/units/:unitId    (soft-delete)

GET    /v1/units/:id/lessons
POST   /v1/units/:id/lessons
PATCH  /v1/units/:id/lessons/:lessonId
DELETE /v1/units/:id/lessons/:lessonId  (soft-delete)
```

`position` is an integer. When reordering, PATCH all affected items in a single transaction.

---

## Activities

### CRUD endpoints

```
GET    /v1/lessons/:id/activities
POST   /v1/lessons/:id/activities
GET    /v1/activities/:id
PATCH  /v1/activities/:id
DELETE /v1/activities/:id             (soft-delete)
POST   /v1/activities/:id/validate    (answer validation)
```

### Activity types

| Type | Description |
|---|---|
| `cloze` | Fill-in-the-blank. Supports near-match. |
| `mcq` | Multiple choice. Single or multi-select. |
| `matching` | Match pairs from two columns. |
| `ordering` | Arrange items in correct order. Partial scoring. |
| `open_writing` | Free-text response with rubric grading. |
| `listening` | Audio prompt + recording or text response. Phase 2. |

### `content` jsonb structure by type

**cloze:**
```json
{
  "text": "The cat ___ on the mat.",
  "blanks": [{"index": 1, "answer": "sat", "hint": "past tense of sit"}]
}
```

**mcq:**
```json
{
  "question": "Which is correct?",
  "options": ["He go", "He goes", "He going"],
  "correct_indices": [1],
  "multi_select": false
}
```

**matching:**
```json
{
  "pairs": [
    {"left": "cat", "right": "chat"},
    {"left": "dog", "right": "chien"}
  ]
}
```

**ordering:**
```json
{
  "items": ["First", "Second", "Third", "Fourth"],
  "correct_order": [0, 1, 2, 3]
}
```

### Answer validation — `POST /v1/activities/:id/validate`

```typescript
// Request body:
{ "response": <student answer JSON> }

// Response:
{
  "correct": boolean,
  "score": number,        // 0.0 – 1.0
  "feedback": string?,
  "content_changed": boolean  // true if activity was updated since SRS item created
}
```

### Near-match for cloze

When `scoring_rules.accept_near_match = true`, a cloze answer is accepted if Levenshtein distance ≤ 2 from any accepted answer:

```typescript
import { distance } from 'fastest-levenshtein'
const isNearMatch = distance(studentAnswer, correctAnswer) <= 2
```

### Partial scoring for ordering

Score = fraction of items in correct relative position:
```typescript
score = correctlyPlaced / totalItems
```

### Version tracking

Every `PATCH /v1/activities/:id` increments `activities.version`. SRS items snapshot `activity_version` at creation. If `srs_items.activity_version < activities.version`, the content has changed and the SRS interval resets. See [[SRS-Algorithm]].

---

## `image_url` → `media_asset_id` migration

Phase 1 uses `activities.image_url` (a plain URL string) as a shortcut. In Phase 2, this is replaced by `activities.media_asset_id` (FK to `media_assets`). The `image_url` column is kept for backwards compatibility until Phase 2 is fully deployed.

Never add new features that depend on `image_url` — use `media_asset_id` for any Phase 2+ work.
