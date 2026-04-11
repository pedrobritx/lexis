import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { authenticate } from '../../plugins/authenticate.js'
import * as coursesService from './courses.service.js'
import type { ApiError } from '@lexis/types'

// ─── Schemas ──────────────────────────────────────────────

const FrameworkEnum = z.enum(['cefr', 'jlpt', 'hsk', 'custom'])
const VisibilityEnum = z.enum(['private', 'public_template'])
const StatusEnum = z.enum(['draft', 'active', 'archived'])

const CreateCourseSchema = z.object({
  title: z.string().min(1).max(255),
  description: z.string().optional(),
  targetLanguage: z.string().length(2).optional(),
  framework: FrameworkEnum.optional(),
  targetLevel: z.string().max(10).optional(),
  teacherLanguage: z.string().optional(),
})

const UpdateCourseSchema = z.object({
  title: z.string().min(1).max(255).optional(),
  description: z.string().optional(),
  targetLanguage: z.string().length(2).optional(),
  framework: FrameworkEnum.optional(),
  targetLevel: z.string().max(10).optional(),
  teacherLanguage: z.string().optional(),
  visibility: VisibilityEnum.optional(),
  status: StatusEnum.optional(),
})

const CreateUnitSchema = z.object({
  title: z.string().min(1).max(255),
  position: z.number().int().positive().optional(),
})

const UpdateUnitSchema = z.object({
  title: z.string().min(1).max(255).optional(),
  position: z.number().int().positive().optional(),
})

const CreateLessonSchema = z.object({
  title: z.string().min(1).max(255),
  objective: z.string().optional(),
  position: z.number().int().positive().optional(),
  estimatedMinutes: z.number().int().positive().optional(),
})

const UpdateLessonSchema = z.object({
  title: z.string().min(1).max(255).optional(),
  objective: z.string().optional(),
  position: z.number().int().positive().optional(),
  estimatedMinutes: z.number().int().positive().optional(),
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

// ─── Plugin ───────────────────────────────────────────────

export async function coursesRoutes(fastify: FastifyInstance) {
  // ── Course list + create ───────────────────────────────

  /**
   * GET /v1/courses
   * List all non-deleted courses for the authenticated teacher's tenant.
   */
  fastify.get('/', { preHandler: [authenticate] }, async (request, reply) => {
    if (!requireTeacher(request, reply)) return

    const courses = await coursesService.listCourses(request.user.tenantId)
    return reply.send({ data: courses })
  })

  /**
   * POST /v1/courses
   * Create a course. Checks lesson_plan billing limit.
   * Teachers only.
   */
  fastify.post('/', { preHandler: [authenticate] }, async (request, reply) => {
    if (!requireTeacher(request, reply)) return

    const body = validate(CreateCourseSchema, request.body, reply)
    if (!body) return

    try {
      const course = await coursesService.createCourse(
        request.user.tenantId,
        request.user.userId,
        body,
      )
      return reply.status(201).send({ data: course })
    } catch (err) {
      return handleError(err, reply)
    }
  })

  // ── Single course ──────────────────────────────────────

  /**
   * GET /v1/courses/:courseId
   * Returns a course with its full unit+lesson tree.
   */
  fastify.get('/:courseId', { preHandler: [authenticate] }, async (request, reply) => {
    if (!requireTeacher(request, reply)) return

    const { courseId } = request.params as { courseId: string }

    try {
      const course = await coursesService.getCourse(courseId, request.user.tenantId)
      return reply.send({ data: course })
    } catch (err) {
      return handleError(err, reply)
    }
  })

  /**
   * PATCH /v1/courses/:courseId
   * Update course metadata. Increments version on every update.
   */
  fastify.patch('/:courseId', { preHandler: [authenticate] }, async (request, reply) => {
    if (!requireTeacher(request, reply)) return

    const { courseId } = request.params as { courseId: string }
    const body = validate(UpdateCourseSchema, request.body, reply)
    if (!body) return

    try {
      const course = await coursesService.updateCourse(
        courseId,
        request.user.tenantId,
        body,
      )
      return reply.send({ data: course })
    } catch (err) {
      return handleError(err, reply)
    }
  })

  /**
   * DELETE /v1/courses/:courseId
   * Soft-delete with active-enrollment guard.
   * Returns 409 if the course has active enrollments.
   */
  fastify.delete('/:courseId', { preHandler: [authenticate] }, async (request, reply) => {
    if (!requireTeacher(request, reply)) return

    const { courseId } = request.params as { courseId: string }

    try {
      const result = await coursesService.deleteCourse(courseId, request.user.tenantId)
      return reply.send({ data: result })
    } catch (err) {
      return handleError(err, reply)
    }
  })

  // ── Units ──────────────────────────────────────────────

  /**
   * POST /v1/courses/:courseId/units
   */
  fastify.post(
    '/:courseId/units',
    { preHandler: [authenticate] },
    async (request, reply) => {
      if (!requireTeacher(request, reply)) return

      const { courseId } = request.params as { courseId: string }
      const body = validate(CreateUnitSchema, request.body, reply)
      if (!body) return

      try {
        const unit = await coursesService.createUnit(
          courseId,
          request.user.tenantId,
          body,
        )
        return reply.status(201).send({ data: unit })
      } catch (err) {
        return handleError(err, reply)
      }
    },
  )

  /**
   * PATCH /v1/courses/:courseId/units/:unitId
   */
  fastify.patch(
    '/:courseId/units/:unitId',
    { preHandler: [authenticate] },
    async (request, reply) => {
      if (!requireTeacher(request, reply)) return

      const { courseId, unitId } = request.params as {
        courseId: string
        unitId: string
      }
      const body = validate(UpdateUnitSchema, request.body, reply)
      if (!body) return

      try {
        const unit = await coursesService.updateUnit(
          courseId,
          unitId,
          request.user.tenantId,
          body,
        )
        return reply.send({ data: unit })
      } catch (err) {
        return handleError(err, reply)
      }
    },
  )

  /**
   * DELETE /v1/courses/:courseId/units/:unitId
   */
  fastify.delete(
    '/:courseId/units/:unitId',
    { preHandler: [authenticate] },
    async (request, reply) => {
      if (!requireTeacher(request, reply)) return

      const { courseId, unitId } = request.params as {
        courseId: string
        unitId: string
      }

      try {
        const result = await coursesService.deleteUnit(
          courseId,
          unitId,
          request.user.tenantId,
        )
        return reply.send({ data: result })
      } catch (err) {
        return handleError(err, reply)
      }
    },
  )

  // ── Lessons ────────────────────────────────────────────

  /**
   * POST /v1/courses/:courseId/units/:unitId/lessons
   */
  fastify.post(
    '/:courseId/units/:unitId/lessons',
    { preHandler: [authenticate] },
    async (request, reply) => {
      if (!requireTeacher(request, reply)) return

      const { courseId, unitId } = request.params as {
        courseId: string
        unitId: string
      }
      const body = validate(CreateLessonSchema, request.body, reply)
      if (!body) return

      try {
        const lesson = await coursesService.createLesson(
          courseId,
          unitId,
          request.user.tenantId,
          body,
        )
        return reply.status(201).send({ data: lesson })
      } catch (err) {
        return handleError(err, reply)
      }
    },
  )

  /**
   * PATCH /v1/courses/:courseId/units/:unitId/lessons/:lessonId
   */
  fastify.patch(
    '/:courseId/units/:unitId/lessons/:lessonId',
    { preHandler: [authenticate] },
    async (request, reply) => {
      if (!requireTeacher(request, reply)) return

      const { courseId, unitId, lessonId } = request.params as {
        courseId: string
        unitId: string
        lessonId: string
      }
      const body = validate(UpdateLessonSchema, request.body, reply)
      if (!body) return

      try {
        const lesson = await coursesService.updateLesson(
          courseId,
          unitId,
          lessonId,
          request.user.tenantId,
          body,
        )
        return reply.send({ data: lesson })
      } catch (err) {
        return handleError(err, reply)
      }
    },
  )

  /**
   * DELETE /v1/courses/:courseId/units/:unitId/lessons/:lessonId
   */
  fastify.delete(
    '/:courseId/units/:unitId/lessons/:lessonId',
    { preHandler: [authenticate] },
    async (request, reply) => {
      if (!requireTeacher(request, reply)) return

      const { courseId, unitId, lessonId } = request.params as {
        courseId: string
        unitId: string
        lessonId: string
      }

      try {
        const result = await coursesService.deleteLesson(
          courseId,
          unitId,
          lessonId,
          request.user.tenantId,
        )
        return reply.send({ data: result })
      } catch (err) {
        return handleError(err, reply)
      }
    },
  )
}

// ─── Template routes (separate prefix /v1/templates) ──────

export async function templateRoutes(fastify: FastifyInstance) {
  /**
   * GET /v1/templates
   * List all public templates. No tenant scope — any authenticated user.
   */
  fastify.get('/', { preHandler: [authenticate] }, async (_request, reply) => {
    const templates = await coursesService.listTemplates()
    return reply.send({ data: templates })
  })

  /**
   * POST /v1/templates/:id/clone
   * Deep-clone a public template into the caller's tenant.
   * Teachers only.
   */
  fastify.post(
    '/:id/clone',
    { preHandler: [authenticate] },
    async (request, reply) => {
      if (!requireTeacher(request, reply)) return

      const { id } = request.params as { id: string }

      try {
        const course = await coursesService.cloneTemplate(
          id,
          request.user.tenantId,
          request.user.userId,
        )
        return reply.status(201).send({ data: course })
      } catch (err) {
        const e = err as { statusCode?: number; code?: string; message?: string }
        return reply.status(e.statusCode ?? 500).send({
          error: {
            code: e.code ?? 'INTERNAL_ERROR',
            message: e.message ?? 'An unexpected error occurred',
          },
        })
      }
    },
  )
}
