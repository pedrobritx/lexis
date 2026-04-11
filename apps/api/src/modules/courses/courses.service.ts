import { prisma } from '@lexis/db'
import { logger } from '@lexis/logger'
import { checkSubscriptionLimit } from '@lexis/billing'

const log = logger('courses-service')

// ─── Types ────────────────────────────────────────────────

type Framework = 'cefr' | 'jlpt' | 'hsk' | 'custom'
type Visibility = 'private' | 'public_template'
type CourseStatus = 'draft' | 'active' | 'archived'

export interface CreateCourseInput {
  title: string
  description?: string
  targetLanguage?: string
  framework?: Framework
  targetLevel?: string
  teacherLanguage?: string
}

export interface UpdateCourseInput {
  title?: string
  description?: string
  targetLanguage?: string
  framework?: Framework
  targetLevel?: string
  teacherLanguage?: string
  visibility?: Visibility
  status?: CourseStatus
}

export interface CreateUnitInput {
  title: string
  position?: number
}

export interface UpdateUnitInput {
  title?: string
  position?: number
}

export interface CreateLessonInput {
  title: string
  objective?: string
  position?: number
  estimatedMinutes?: number
}

export interface UpdateLessonInput {
  title?: string
  objective?: string
  position?: number
  estimatedMinutes?: number
}

// ─── Courses ─────────────────────────────────────────────

export async function listCourses(tenantId: string) {
  return prisma.course.findMany({
    where: { tenantId, deletedAt: null },
    orderBy: { createdAt: 'desc' },
    select: {
      id: true,
      title: true,
      description: true,
      targetLanguage: true,
      framework: true,
      targetLevel: true,
      visibility: true,
      status: true,
      version: true,
      createdAt: true,
      _count: { select: { units: { where: { deletedAt: null } } } },
    },
  })
}

export async function getCourse(courseId: string, tenantId: string) {
  const course = await prisma.course.findFirst({
    where: { id: courseId, tenantId, deletedAt: null },
    include: {
      units: {
        where: { deletedAt: null },
        orderBy: { position: 'asc' },
        include: {
          lessons: {
            where: { deletedAt: null },
            orderBy: { position: 'asc' },
            select: {
              id: true,
              title: true,
              objective: true,
              position: true,
              estimatedMinutes: true,
            },
          },
        },
      },
    },
  })

  if (!course) throw Object.assign(new Error('Course not found'), { statusCode: 404 })
  return course
}

export async function createCourse(
  tenantId: string,
  createdBy: string,
  input: CreateCourseInput,
) {
  // Check lesson_plan billing limit before creating
  await checkSubscriptionLimit(tenantId, 'lesson_plans')

  const course = await prisma.course.create({
    data: {
      tenantId,
      createdBy,
      title: input.title,
      description: input.description,
      targetLanguage: input.targetLanguage ?? 'en',
      framework: input.framework ?? 'cefr',
      targetLevel: input.targetLevel ?? 'b1',
      teacherLanguage: input.teacherLanguage,
    },
  })

  log.info({ courseId: course.id, tenantId }, 'Course created')
  return course
}

export async function updateCourse(
  courseId: string,
  tenantId: string,
  input: UpdateCourseInput,
) {
  const course = await prisma.course.findFirst({
    where: { id: courseId, tenantId, deletedAt: null },
  })
  if (!course) throw Object.assign(new Error('Course not found'), { statusCode: 404 })

  const updated = await prisma.course.update({
    where: { id: courseId },
    data: {
      ...input,
      version: { increment: 1 },
    },
  })

  log.info({ courseId, tenantId }, 'Course updated')
  return updated
}

export async function deleteCourse(courseId: string, tenantId: string) {
  const course = await prisma.course.findFirst({
    where: { id: courseId, tenantId, deletedAt: null },
  })
  if (!course) throw Object.assign(new Error('Course not found'), { statusCode: 404 })

  // Guard: refuse if any active classroom is using this course
  const activeEnrollmentCount = await prisma.enrollment.count({
    where: {
      classroom: { courseId, status: 'active' },
      tenantId,
    },
  })

  if (activeEnrollmentCount > 0) {
    throw Object.assign(
      new Error(
        'Cannot delete a course that has active enrollments. Archive the course or remove enrollments first.',
      ),
      { statusCode: 409, code: 'ACTIVE_ENROLLMENTS' },
    )
  }

  const now = new Date()

  // Soft-delete course + cascade to units + lessons
  await prisma.$transaction([
    prisma.lesson.updateMany({
      where: {
        unit: { courseId },
        tenantId,
        deletedAt: null,
      },
      data: { deletedAt: now },
    }),
    prisma.unit.updateMany({
      where: { courseId, tenantId, deletedAt: null },
      data: { deletedAt: now },
    }),
    prisma.course.update({
      where: { id: courseId },
      data: { deletedAt: now },
    }),
  ])

  log.info({ courseId, tenantId }, 'Course soft-deleted')
  return { deletedAt: now }
}

// ─── Units ────────────────────────────────────────────────

async function assertCourseAccess(courseId: string, tenantId: string) {
  const course = await prisma.course.findFirst({
    where: { id: courseId, tenantId, deletedAt: null },
  })
  if (!course) throw Object.assign(new Error('Course not found'), { statusCode: 404 })
  return course
}

export async function createUnit(
  courseId: string,
  tenantId: string,
  input: CreateUnitInput,
) {
  await assertCourseAccess(courseId, tenantId)

  // Default position = last + 1
  let position = input.position
  if (position === undefined) {
    const last = await prisma.unit.findFirst({
      where: { courseId, tenantId, deletedAt: null },
      orderBy: { position: 'desc' },
      select: { position: true },
    })
    position = (last?.position ?? 0) + 1
  }

  const unit = await prisma.unit.create({
    data: { courseId, tenantId, title: input.title, position },
  })

  log.info({ unitId: unit.id, courseId, tenantId }, 'Unit created')
  return unit
}

export async function updateUnit(
  courseId: string,
  unitId: string,
  tenantId: string,
  input: UpdateUnitInput,
) {
  const unit = await prisma.unit.findFirst({
    where: { id: unitId, courseId, tenantId, deletedAt: null },
  })
  if (!unit) throw Object.assign(new Error('Unit not found'), { statusCode: 404 })

  const updated = await prisma.unit.update({
    where: { id: unitId },
    data: input,
  })

  log.info({ unitId, courseId, tenantId }, 'Unit updated')
  return updated
}

export async function deleteUnit(courseId: string, unitId: string, tenantId: string) {
  const unit = await prisma.unit.findFirst({
    where: { id: unitId, courseId, tenantId, deletedAt: null },
  })
  if (!unit) throw Object.assign(new Error('Unit not found'), { statusCode: 404 })

  const now = new Date()

  await prisma.$transaction([
    prisma.lesson.updateMany({
      where: { unitId, tenantId, deletedAt: null },
      data: { deletedAt: now },
    }),
    prisma.unit.update({
      where: { id: unitId },
      data: { deletedAt: now },
    }),
  ])

  log.info({ unitId, courseId, tenantId }, 'Unit soft-deleted')
  return { deletedAt: now }
}

// ─── Lessons ──────────────────────────────────────────────

async function assertUnitAccess(courseId: string, unitId: string, tenantId: string) {
  const unit = await prisma.unit.findFirst({
    where: { id: unitId, courseId, tenantId, deletedAt: null },
  })
  if (!unit) throw Object.assign(new Error('Unit not found'), { statusCode: 404 })
  return unit
}

export async function createLesson(
  courseId: string,
  unitId: string,
  tenantId: string,
  input: CreateLessonInput,
) {
  await assertUnitAccess(courseId, unitId, tenantId)

  let position = input.position
  if (position === undefined) {
    const last = await prisma.lesson.findFirst({
      where: { unitId, tenantId, deletedAt: null },
      orderBy: { position: 'desc' },
      select: { position: true },
    })
    position = (last?.position ?? 0) + 1
  }

  const lesson = await prisma.lesson.create({
    data: {
      unitId,
      tenantId,
      title: input.title,
      objective: input.objective,
      position,
      estimatedMinutes: input.estimatedMinutes,
    },
  })

  log.info({ lessonId: lesson.id, unitId, courseId, tenantId }, 'Lesson created')
  return lesson
}

export async function updateLesson(
  courseId: string,
  unitId: string,
  lessonId: string,
  tenantId: string,
  input: UpdateLessonInput,
) {
  const lesson = await prisma.lesson.findFirst({
    where: { id: lessonId, unitId, tenantId, deletedAt: null },
  })
  if (!lesson) throw Object.assign(new Error('Lesson not found'), { statusCode: 404 })

  // Verify the unit is in the expected course (extra guard)
  await assertUnitAccess(courseId, unitId, tenantId)

  const updated = await prisma.lesson.update({
    where: { id: lessonId },
    data: input,
  })

  log.info({ lessonId, unitId, courseId, tenantId }, 'Lesson updated')
  return updated
}

export async function deleteLesson(
  courseId: string,
  unitId: string,
  lessonId: string,
  tenantId: string,
) {
  const lesson = await prisma.lesson.findFirst({
    where: { id: lessonId, unitId, tenantId, deletedAt: null },
  })
  if (!lesson) throw Object.assign(new Error('Lesson not found'), { statusCode: 404 })

  await assertUnitAccess(courseId, unitId, tenantId)

  const now = new Date()
  await prisma.lesson.update({
    where: { id: lessonId },
    data: { deletedAt: now },
  })

  log.info({ lessonId, unitId, courseId, tenantId }, 'Lesson soft-deleted')
  return { deletedAt: now }
}

// ─── Templates ────────────────────────────────────────────

export async function listTemplates() {
  return prisma.course.findMany({
    where: { visibility: 'public_template', deletedAt: null },
    orderBy: { createdAt: 'asc' },
    select: {
      id: true,
      title: true,
      description: true,
      targetLanguage: true,
      framework: true,
      targetLevel: true,
      status: true,
      createdAt: true,
      _count: { select: { units: { where: { deletedAt: null } } } },
    },
  })
}

export async function cloneTemplate(
  sourceId: string,
  tenantId: string,
  clonedBy: string,
) {
  // Check lesson_plan limit before cloning
  await checkSubscriptionLimit(tenantId, 'lesson_plans')

  const source = await prisma.course.findFirst({
    where: { id: sourceId, visibility: 'public_template', deletedAt: null },
    include: {
      units: {
        where: { deletedAt: null },
        orderBy: { position: 'asc' },
        include: {
          lessons: {
            where: { deletedAt: null },
            orderBy: { position: 'asc' },
          },
        },
      },
    },
  })

  if (!source) throw Object.assign(new Error('Template not found'), { statusCode: 404 })

  // Deep clone inside a transaction
  const cloned = await prisma.$transaction(async (tx) => {
    const newCourse = await tx.course.create({
      data: {
        tenantId,
        createdBy: clonedBy,
        title: source.title,
        description: source.description,
        targetLanguage: source.targetLanguage,
        framework: source.framework,
        targetLevel: source.targetLevel,
        teacherLanguage: source.teacherLanguage,
        visibility: 'private',
        status: 'draft',
        version: 1,
      },
    })

    for (const unit of source.units) {
      const newUnit = await tx.unit.create({
        data: {
          courseId: newCourse.id,
          tenantId,
          title: unit.title,
          position: unit.position,
        },
      })

      for (const lesson of unit.lessons) {
        await tx.lesson.create({
          data: {
            unitId: newUnit.id,
            tenantId,
            title: lesson.title,
            objective: lesson.objective,
            position: lesson.position,
            estimatedMinutes: lesson.estimatedMinutes,
          },
        })
      }
    }

    // Record the clone lineage
    await tx.templateClone.create({
      data: {
        sourceCourseId: source.id,
        clonedCourseId: newCourse.id,
        clonedByTenant: tenantId,
      },
    })

    return newCourse
  })

  log.info(
    { sourceId, clonedCourseId: cloned.id, tenantId },
    'Template cloned',
  )

  return cloned
}
