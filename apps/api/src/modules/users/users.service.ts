import { prisma } from '@lexis/db'
import { logger } from '@lexis/logger'
import { invalidateAllTokensForUser } from '../auth/jwt.service.js'

const log = logger('users-service')

// ─── GET /v1/users/me ─────────────────────────────────────

export async function getMe(userId: string) {
  const user = await prisma.user.findUnique({
    where: { id: userId, deletedAt: null },
    select: {
      id: true,
      email: true,
      role: true,
      ageGroup: true,
      createdAt: true,
      teacherProfile: {
        select: {
          displayName: true,
          teacherLanguage: true,
          bio: true,
        },
      },
      studentProfile: {
        select: {
          displayName: true,
          cefrLevel: true,
          streakDays: true,
          xpTotal: true,
          timezone: true,
        },
      },
      consentRecords: {
        select: { policyVersion: true, acceptedAt: true },
        orderBy: { acceptedAt: 'desc' },
        take: 1,
      },
    },
  })

  if (!user) throw Object.assign(new Error('User not found'), { statusCode: 404 })
  return user
}

// ─── PATCH /v1/users/me ───────────────────────────────────

export interface PatchTeacherInput {
  displayName?: string
  teacherLanguage?: string
  bio?: string
}

export interface PatchStudentInput {
  displayName?: string
  timezone?: string
}

export async function patchMe(
  userId: string,
  tenantId: string,
  role: string,
  input: PatchTeacherInput | PatchStudentInput,
) {
  if (role === 'teacher') {
    const data = input as PatchTeacherInput

    await prisma.teacherProfile.upsert({
      where: { userId },
      create: {
        userId,
        tenantId,
        displayName: data.displayName ?? '',
        teacherLanguage: data.teacherLanguage,
        bio: data.bio,
      },
      update: {
        ...(data.displayName !== undefined && { displayName: data.displayName }),
        ...(data.teacherLanguage !== undefined && { teacherLanguage: data.teacherLanguage }),
        ...(data.bio !== undefined && { bio: data.bio }),
      },
    })
  } else if (role === 'student') {
    const data = input as PatchStudentInput

    await prisma.studentProfile.upsert({
      where: { userId },
      create: {
        userId,
        tenantId,
        displayName: data.displayName ?? '',
        timezone: data.timezone ?? 'UTC',
      },
      update: {
        ...(data.displayName !== undefined && { displayName: data.displayName }),
        ...(data.timezone !== undefined && { timezone: data.timezone }),
      },
    })
  }

  return getMe(userId)
}

// ─── DELETE /v1/users/me (GDPR) ───────────────────────────

export async function deleteMe(userId: string): Promise<Date> {
  const effectiveAt = new Date()

  // Soft-delete user
  await prisma.user.update({
    where: { id: userId },
    data: { deletedAt: effectiveAt },
  })

  // Revoke all refresh tokens from Redis
  await invalidateAllTokensForUser(userId)

  log.info({ userId }, 'User soft-deleted (GDPR)')
  return effectiveAt
}
