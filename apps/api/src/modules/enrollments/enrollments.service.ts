import { prisma } from '@lexis/db'
import { logger } from '@lexis/logger'
import { checkSubscriptionLimit } from '@lexis/billing'

const log = logger('enrollments-service')

// ─── Types ────────────────────────────────────────────────

type ClassroomStatus = 'active' | 'paused' | 'archived'
type SessionStatus = 'scheduled' | 'active' | 'completed' | 'cancelled'

export interface CreateClassroomInput {
  name: string
  courseId?: string
}

export interface UpdateClassroomInput {
  name?: string
  courseId?: string
  status?: ClassroomStatus
}

export interface CreateSessionInput {
  studentId?: string
  classroomId?: string
  status?: SessionStatus
  startedAt?: string
}

export interface UpdateSessionInput {
  status?: SessionStatus
  startedAt?: string
  endedAt?: string
  durationSecs?: number
}

// ─── Classrooms ───────────────────────────────────────────

export async function listClassrooms(tenantId: string, teacherId: string) {
  return prisma.classroom.findMany({
    where: { tenantId, teacherId, status: { not: 'archived' } },
    orderBy: { name: 'asc' },
    include: {
      _count: { select: { enrollments: true } },
    },
  })
}

export async function getClassroom(classroomId: string, tenantId: string) {
  const classroom = await prisma.classroom.findFirst({
    where: { id: classroomId, tenantId },
    include: {
      enrollments: {
        orderBy: { enrolledAt: 'asc' },
        select: {
          id: true,
          studentId: true,
          enrolledAt: true,
        },
      },
    },
  })

  if (!classroom) {
    throw Object.assign(new Error('Classroom not found'), { statusCode: 404 })
  }

  return classroom
}

export async function createClassroom(
  tenantId: string,
  teacherId: string,
  input: CreateClassroomInput,
) {
  if (input.courseId) {
    const course = await prisma.course.findFirst({
      where: { id: input.courseId, tenantId, deletedAt: null },
    })
    if (!course) {
      throw Object.assign(new Error('Course not found'), { statusCode: 404 })
    }
  }

  const classroom = await prisma.classroom.create({
    data: {
      tenantId,
      teacherId,
      name: input.name,
      courseId: input.courseId,
    },
  })

  log.info({ classroomId: classroom.id, tenantId }, 'Classroom created')
  return classroom
}

export async function updateClassroom(
  classroomId: string,
  tenantId: string,
  input: UpdateClassroomInput,
) {
  const classroom = await prisma.classroom.findFirst({
    where: { id: classroomId, tenantId },
  })
  if (!classroom) {
    throw Object.assign(new Error('Classroom not found'), { statusCode: 404 })
  }

  if (input.courseId) {
    const course = await prisma.course.findFirst({
      where: { id: input.courseId, tenantId, deletedAt: null },
    })
    if (!course) {
      throw Object.assign(new Error('Course not found'), { statusCode: 404 })
    }
  }

  const updated = await prisma.classroom.update({
    where: { id: classroomId },
    data: input,
  })

  log.info({ classroomId, tenantId }, 'Classroom updated')
  return updated
}

export async function archiveClassroom(classroomId: string, tenantId: string) {
  const classroom = await prisma.classroom.findFirst({
    where: { id: classroomId, tenantId },
  })
  if (!classroom) {
    throw Object.assign(new Error('Classroom not found'), { statusCode: 404 })
  }

  const updated = await prisma.classroom.update({
    where: { id: classroomId },
    data: { status: 'archived' },
  })

  log.info({ classroomId, tenantId }, 'Classroom archived')
  return updated
}

// ─── Enrollments ──────────────────────────────────────────

export async function enrollStudent(
  classroomId: string,
  studentId: string,
  tenantId: string,
) {
  // Verify classroom belongs to tenant
  const classroom = await prisma.classroom.findFirst({
    where: { id: classroomId, tenantId },
  })
  if (!classroom) {
    throw Object.assign(new Error('Classroom not found'), { statusCode: 404 })
  }

  // Verify student exists and belongs to this tenant
  const student = await prisma.user.findFirst({
    where: { id: studentId, tenantId, role: 'student', deletedAt: null },
  })
  if (!student) {
    throw Object.assign(new Error('Student not found'), { statusCode: 404 })
  }

  // Check for duplicate enrollment
  const existing = await prisma.enrollment.findUnique({
    where: { classroomId_studentId: { classroomId, studentId } },
  })
  if (existing) {
    throw Object.assign(
      new Error('Student is already enrolled in this classroom'),
      { statusCode: 409, code: 'ALREADY_ENROLLED' },
    )
  }

  // Check billing limit (distinct students across tenant)
  await checkSubscriptionLimit(tenantId, 'students')

  const enrollment = await prisma.enrollment.create({
    data: { classroomId, studentId, tenantId },
  })

  log.info({ classroomId, studentId, tenantId }, 'Student enrolled')
  return enrollment
}

export async function unenrollStudent(
  classroomId: string,
  enrollmentId: string,
  tenantId: string,
) {
  const enrollment = await prisma.enrollment.findFirst({
    where: { id: enrollmentId, classroomId, tenantId },
  })
  if (!enrollment) {
    throw Object.assign(new Error('Enrollment not found'), { statusCode: 404 })
  }

  await prisma.enrollment.delete({ where: { id: enrollmentId } })

  log.info({ classroomId, enrollmentId, tenantId }, 'Student unenrolled')
  return { deletedAt: new Date() }
}

// ─── Sessions ─────────────────────────────────────────────

export async function listSessions(tenantId: string, teacherId: string) {
  return prisma.session.findMany({
    where: { tenantId, teacherId },
    orderBy: { startedAt: 'desc' },
    include: {
      _count: { select: { participants: true } },
    },
  })
}

export async function getSession(sessionId: string, tenantId: string) {
  const session = await prisma.session.findFirst({
    where: { id: sessionId, tenantId },
    include: {
      participants: {
        select: {
          id: true,
          studentId: true,
          status: true,
          joinedAt: true,
          leftAt: true,
        },
      },
    },
  })

  if (!session) {
    throw Object.assign(new Error('Session not found'), { statusCode: 404 })
  }

  return session
}

export async function createSession(
  tenantId: string,
  teacherId: string,
  input: CreateSessionInput,
) {
  // Exactly one of studentId / classroomId must be provided
  if (!input.studentId && !input.classroomId) {
    throw Object.assign(
      new Error('Either studentId or classroomId must be provided'),
      { statusCode: 400, code: 'VALIDATION_ERROR' },
    )
  }
  if (input.studentId && input.classroomId) {
    throw Object.assign(
      new Error('Provide either studentId or classroomId, not both'),
      { statusCode: 400, code: 'VALIDATION_ERROR' },
    )
  }

  // Validate student exists if 1-on-1 session
  if (input.studentId) {
    const student = await prisma.user.findFirst({
      where: { id: input.studentId, tenantId, role: 'student', deletedAt: null },
    })
    if (!student) {
      throw Object.assign(new Error('Student not found'), { statusCode: 404 })
    }
  }

  // Validate classroom + collect enrolled students for group session
  let enrolledStudentIds: string[] = []
  if (input.classroomId) {
    const classroom = await prisma.classroom.findFirst({
      where: { id: input.classroomId, tenantId },
      include: { enrollments: { select: { studentId: true } } },
    })
    if (!classroom) {
      throw Object.assign(new Error('Classroom not found'), { statusCode: 404 })
    }
    enrolledStudentIds = classroom.enrollments.map((e) => e.studentId)
  }

  const session = await prisma.$transaction(async (tx) => {
    const created = await tx.session.create({
      data: {
        tenantId,
        teacherId,
        studentId: input.studentId,
        classroomId: input.classroomId,
        status: input.status ?? 'scheduled',
        startedAt: input.startedAt ? new Date(input.startedAt) : undefined,
      },
    })

    // Auto-populate session_participants for group sessions
    if (input.classroomId && enrolledStudentIds.length > 0) {
      await tx.sessionParticipant.createMany({
        data: enrolledStudentIds.map((studentId) => ({
          sessionId: created.id,
          studentId,
          tenantId,
          status: 'invited' as const,
        })),
      })
    }

    return created
  })

  log.info(
    { sessionId: session.id, teacherId, tenantId, isGroup: !!input.classroomId },
    'Session created',
  )
  return session
}

export async function updateSession(
  sessionId: string,
  tenantId: string,
  input: UpdateSessionInput,
) {
  const session = await prisma.session.findFirst({
    where: { id: sessionId, tenantId },
  })
  if (!session) {
    throw Object.assign(new Error('Session not found'), { statusCode: 404 })
  }

  const updated = await prisma.session.update({
    where: { id: sessionId },
    data: {
      status: input.status,
      startedAt: input.startedAt ? new Date(input.startedAt) : undefined,
      endedAt: input.endedAt ? new Date(input.endedAt) : undefined,
      durationSecs: input.durationSecs,
    },
  })

  log.info({ sessionId, tenantId, status: input.status }, 'Session updated')
  return updated
}
