import { prisma } from '@lexis/db'
import jwt from 'jsonwebtoken'
import { nanoid } from 'nanoid'

export async function createTestTenant() {
  const email = `teacher-${nanoid(8)}@test.lexis`

  const tenant = await prisma.tenant.create({
    data: {
      name: `Test Tenant ${nanoid(4)}`,
      slug: nanoid(12),
    },
  })

  await prisma.subscription.create({
    data: {
      tenantId: tenant.id,
      planSlug: 'free',
      studentLimit: 3,
      lessonPlanLimit: 5,
      aiCreditsRemaining: 0,
    },
  })

  const user = await prisma.user.create({
    data: {
      email,
      role: 'teacher',
      tenantId: tenant.id,
    },
  })

  return { tenant, user }
}

export async function createTestStudent(tenantId: string) {
  const email = `student-${nanoid(8)}@test.lexis`

  const user = await prisma.user.create({
    data: {
      email,
      role: 'student',
      tenantId,
    },
  })

  return user
}

export function getAuthHeader(userId: string, tenantId: string, role: 'teacher' | 'student' | 'system' = 'teacher') {
  const token = jwt.sign(
    { sub: userId, tenantId, role },
    process.env.JWT_SECRET || 'test-secret-min-32-chars-long-ok',
    { expiresIn: '15m' },
  )
  return { Authorization: `Bearer ${token}` }
}
