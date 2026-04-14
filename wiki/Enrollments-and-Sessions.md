# Enrollments and Sessions

---

## Classrooms

A classroom groups students under a teacher for a specific course.

```
GET    /v1/classrooms
POST   /v1/classrooms
GET    /v1/classrooms/:id
PATCH  /v1/classrooms/:id
DELETE /v1/classrooms/:id
```

### Classroom status

| Status | Meaning |
|---|---|
| `active` | Accepting sessions and enrollments |
| `paused` | Temporarily disabled |
| `archived` | Soft-archived — no new activity |

---

## Enrollments

```
POST   /v1/classrooms/:id/enroll
  Body: {studentId}
  → Checks student limit (billing)
  → Creates enrollment row
  Response: {enrollment}

DELETE /v1/classrooms/:id/enrollments/:studentId
  → Removes enrollment
  → Does NOT affect lesson_progress or activity_attempts
```

### Student limit check

Before creating any enrollment, check against the plan limit:

```typescript
await checkSubscriptionLimit(req.user.tenantId, 'students')
```

This counts `DISTINCT student_id` across **all classrooms in the tenant**, not just the target classroom.

Use a PostgreSQL transaction to prevent race conditions with concurrent enrollment requests hitting the same limit.

### Enrollment guard on course delete

A course cannot be soft-deleted if it has active enrollments. See [[Courses-and-Content]].

---

## Sessions

A session is a live or scheduled teaching event. It is either 1-on-1 (single student) or group (via classroom).

**Constraint:** exactly one of `student_id` or `classroom_id` must be non-null. Both null or both non-null is rejected at the API layer.

```
GET    /v1/sessions
POST   /v1/sessions
GET    /v1/sessions/:id
PATCH  /v1/sessions/:id
DELETE /v1/sessions/:id
POST   /v1/sessions/:id/start
POST   /v1/sessions/:id/end
```

### Session status flow

```
scheduled → active → completed
           ↘ cancelled
```

`POST /v1/sessions/:id/start` transitions `scheduled → active` and sets `started_at`.
`POST /v1/sessions/:id/end` transitions `active → completed`, sets `ended_at` and computes `duration_secs`.

### Group session — auto-populate participants

When `POST /v1/sessions` is called with `classroomId`:

```typescript
// In a transaction:
// 1. Create session row with classroom_id set
// 2. Fetch all active enrollments for the classroom
// 3. Create session_participants row for each enrolled student
//    with status = 'invited'
```

---

## Session participants

Tracks individual student attendance within a group session.

| Field | Type | Notes |
|---|---|---|
| id | uuid PK | |
| session_id | uuid FK | |
| student_id | uuid FK | |
| tenant_id | uuid FK | |
| joined_at | timestamp? | Set when student joins whiteboard |
| left_at | timestamp? | Set on disconnect |
| status | enum | `invited` · `joined` · `absent` |

Students can be added to an active session individually:
```
POST /v1/sessions/:id/participants
  Body: {studentId}
```

---

## Whiteboard integration

When a session transitions to `active`, the RT server creates the `board_pages` for the session. The session ID is the link between the REST session object and the whiteboard room.

See [[Realtime-Architecture]] for the Socket.IO connection flow.
