import type { Prisma } from '@prisma/client'

// Models that use soft-delete (deleted_at column) per CLAUDE.md rules
const SOFT_DELETE_MODELS = new Set([
  'User',
  'Course',
  'Unit',
  'Lesson',
  'Activity',
])

type MiddlewareParams = {
  model?: string
  action: string
  args: Record<string, unknown>
  dataPath: string[]
  runInTransaction: boolean
}

type MiddlewareNext = (params: MiddlewareParams) => Promise<unknown>

export async function softDeleteMiddleware(
  params: MiddlewareParams,
  next: MiddlewareNext,
): Promise<unknown> {
  if (!SOFT_DELETE_MODELS.has(params.model ?? '')) {
    return next(params)
  }

  if (params.action === 'findMany' || params.action === 'findFirst') {
    const where = (params.args.where as Record<string, unknown>) ?? {}
    // Only inject if caller hasn't explicitly set deletedAt (allow opt-out)
    if (!('deletedAt' in where)) {
      params.args = {
        ...params.args,
        where: { ...where, deletedAt: null },
      }
    }
  }

  if (params.action === 'delete') {
    params.action = 'update'
    params.args = {
      ...params.args,
      data: { deletedAt: new Date() },
    }
  }

  if (params.action === 'deleteMany') {
    params.action = 'updateMany'
    params.args = {
      ...params.args,
      data: { deletedAt: new Date() },
    }
  }

  return next(params)
}

// Satisfy Prisma's internal middleware type
export type SoftDeleteMiddleware = Prisma.Middleware
