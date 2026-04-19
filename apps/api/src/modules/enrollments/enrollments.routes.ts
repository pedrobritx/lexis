import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { authenticate } from '../../plugins/authenticate.js'
import * as enrollmentsService from './enrollments.service.js'
import type { ApiError } from '@lexis/types'

// ─── Schemas ──────────────────────────────────────────────

const ClassroomStatusEnum = z.enum(['active', 'paused', 'archived'])
const SessionStatusEnum = z.enum(['scheduled', 'active', 'completed', 'cancelled'])

const CreateClassroomSchema = z.object({
  name: z.string().min(1).max(255),
  courseId: z.string().uuid().optional(),
})

const UpdateClassroomSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  courseId: z.string().uuid().optional(),
  status: ClassroomStatusEnum.optional(),
})

const EnrollStudentSchema = z.object({
  studentId: z.string().uuid(),
})

const CreateSessionSchema = z.object({
  studentId: z.string().uuid().optional(),
  classroomId: z.string().uuid().optional(),
  status: SessionStatusEnum.optional(),
  startedAt: z.string().datetime().optional(),
})

const UpdateSessionSchema = z.object({
  status: SessionStatusEnum.optional(),
  startedAt: z.string().datetime().optional(),
  endedAt: z.string().datetime().optional(),
  durationSecs: z.number().int().positive().optional(),
})

// ─── Helpers ──────────────────────────────────────────────

function validate<T>(
  schema: z.ZodType<T>,
  data: unknown,
  reply: { status: (code: number) => { send: (body: ApiError) => void } },
): T | null {
  const result = schema.safeParse(data)
  if (!result.success) {
    reply.status(400).send({
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Invalid request body',
        details: result.error.flatten(),
      },
    })
    return null
  }
  return result.data
}

function requireTeacher(
  request: { user: { role: string } },
  reply: { status: (code: number) => { send: (body: ApiError) => void } },
): boolean {
  if (request.user.role !== 'teacher') {
    reply.status(403).send({
      error: { code: 'FORBIDDEN', message: 'Only teachers can perform this action' },
    })
    return false
  }
  return true
}

function handleError(
  err: unknown,
  reply: {
    status: (code: number) => { send: (body: unknown) => void }
    send: (body: unknown) => void
  },
) {
  const e = err as { statusCode?: number; code?: string; message?: string }
  const statusCode = e.statusCode ?? 500

  // BillingLimitError carries a details field
  const billing = err as {
    code?: string
    details?: { current: number; limit: number | null; upgradeRequired: boolean }
  }

  return reply.status(statusCode).send({
    error: {
      code: e.code ?? (statusCode === 404 ? 'NOT_FOUND' : 'INTERNAL_ERROR'),
      message: e.message ?? 'An unexpected error occurred',
      ...(billing.details ? { details: billing.details } : {}),
    },
  })
}

// ─── Classrooms ────────────────────────────────────────────
// Mounted at prefix /v1/classrooms

export async function classroomsRoutes(fastify: FastifyInstance) {
  /**
   * GET /v1/classrooms
   * List all non-archived classrooms for the authenticated teacher.
   */
  fastify.get('/', { preHandler: [authenticate] }, async (request, reply) => {
    if (!requireTeacher(request, reply)) return

    const classrooms = await enrollmentsService.listClassrooms(
      request.user.tenantId,
      request.user.userId,
    )
    return reply.send({ data: classrooms })
  })

  /**
   * POST /v1/classrooms
   * Create a classroom. Optionally linked to a course.
   * Teachers only.
   */
  fastify.post('/', { preHandler: [authenticate] }, async (request, reply) => {
    if (!requireTeacher(request, reply)) return

    const body = validate(CreateClassroomSchema, request.body, reply)
    if (!body) return

    try {
      const classroom = await enrollmentsService.createClassroom(
        request.user.tenantId,
        request.user.userId,
        body,
      )
      return reply.status(201).send({ data: classroom })
    } catch (err) {
      return handleError(err, reply)
    }
  })

  /**
   * GET /v1/classrooms/:id
   * Get a classroom with its enrollment list.
   * Teachers only.
   */
  fastify.get('/:id', { preHandler: [authenticate] }, async (request, reply) => {
    if (!requireTeacher(request, reply)) return

    const { id } = request.params as { id: string }

    try {
      const classroom = await enrollmentsService.getClassroom(id, request.user.tenantId)
      return reply.send({ data: classroom })
    } catch (err) {
      return handleError(err, reply)
    }
  })

  /**
   * PATCH /v1/classrooms/:id
   * Update classroom name, courseId, or status.
   * Teachers only.
   */
  fastify.patch('/:id', { preHandler: [authenticate] }, async (request, reply) => {
    if (!requireTeacher(request, reply)) return

    const { id } = request.params as { id: string }
    const body = validate(UpdateClassroomSchema, request.body, reply)
    if (!body) return

    try {
      const classroom = await enrollmentsService.updateClassroom(
        id,
        request.user.tenantId,
        body,
      )
      return reply.send({ data: classroom })
    } catch (err) {
      return handleError(err, reply)
    }
  })

  /**
   * DELETE /v1/classrooms/:id
   * Archive a classroom (sets status = 'archived').
   * Teachers only.
   */
  fastify.delete('/:id', { preHandler: [authenticate] }, async (request, reply) => {
    if (!requireTeacher(request, reply)) return

    const { id } = request.params as { id: string }

    try {
      const result = await enrollmentsService.archiveClassroom(id, request.user.tenantId)
      return reply.send({ data: result })
    } catch (err) {
      return handleError(err, reply)
    }
  })

  /**
   * POST /v1/classrooms/:id/enroll
   * Enroll a student in a classroom.
   * Checks billing student limit — returns 402 if exceeded.
   * Teachers only.
   */
  fastify.post('/:id/enroll', { preHandler: [authenticate] }, async (request, reply) => {
    if (!requireTeacher(request, reply)) return

    const { id } = request.params as { id: string }
    const body = validate(EnrollStudentSchema, request.body, reply)
    if (!body) return

    try {
      const enrollment = await enrollmentsService.enrollStudent(
        id,
        body.studentId,
        request.user.tenantId,
      )
      return reply.status(201).send({ data: enrollment })
    } catch (err) {
      return handleError(err, reply)
    }
  })

  /**
   * DELETE /v1/classrooms/:id/enrollments/:enrollmentId
   * Remove a student from a classroom.
   * Teachers only.
   */
  fastify.delete(
    '/:id/enrollments/:enrollmentId',
    { preHandler: [authenticate] },
    async (request, reply) => {
      if (!requireTeacher(request, reply)) return

      const { id, enrollmentId } = request.params as {
        id: string
        enrollmentId: string
      }

      try {
        const result = await enrollmentsService.unenrollStudent(
          id,
          enrollmentId,
          request.user.tenantId,
        )
        return reply.send({ data: result })
      } catch (err) {
        return handleError(err, reply)
      }
    },
  )
}

// ─── Sessions ──────────────────────────────────────────────
// Mounted at prefix /v1/sessions

export async function sessionsRoutes(fastify: FastifyInstance) {
  /**
   * GET /v1/sessions
   * List all sessions for the authenticated teacher.
   */
  fastify.get('/', { preHandler: [authenticate] }, async (request, reply) => {
    if (!requireTeacher(request, reply)) return

    const sessions = await enrollmentsService.listSessions(
      request.user.tenantId,
      request.user.userId,
    )
    return reply.send({ data: sessions })
  })

  /**
   * POST /v1/sessions
   * Create a session.
   * Body must include exactly one of: studentId (1-on-1) or classroomId (group).
   * Group sessions auto-populate session_participants from classroom enrollments.
   * Teachers only.
   */
  fastify.post('/', { preHandler: [authenticate] }, async (request, reply) => {
    if (!requireTeacher(request, reply)) return

    const body = validate(CreateSessionSchema, request.body, reply)
    if (!body) return

    try {
      const session = await enrollmentsService.createSession(
        request.user.tenantId,
        request.user.userId,
        body,
      )
      return reply.status(201).send({ data: session })
    } catch (err) {
      return handleError(err, reply)
    }
  })

  /**
   * GET /v1/sessions/:id
   * Get a session with its participant list.
   */
  fastify.get('/:id', { preHandler: [authenticate] }, async (request, reply) => {
    if (!requireTeacher(request, reply)) return

    const { id } = request.params as { id: string }

    try {
      const session = await enrollmentsService.getSession(id, request.user.tenantId)
      return reply.send({ data: session })
    } catch (err) {
      return handleError(err, reply)
    }
  })

  /**
   * PATCH /v1/sessions/:id
   * Update session status, timestamps, or duration.
   * Teachers only.
   */
  fastify.patch('/:id', { preHandler: [authenticate] }, async (request, reply) => {
    if (!requireTeacher(request, reply)) return

    const { id } = request.params as { id: string }
    const body = validate(UpdateSessionSchema, request.body, reply)
    if (!body) return

    try {
      const session = await enrollmentsService.updateSession(
        id,
        request.user.tenantId,
        body,
      )
      return reply.send({ data: session })
    } catch (err) {
      return handleError(err, reply)
    }
  })
}
