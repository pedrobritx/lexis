import { AsyncLocalStorage } from 'node:async_hooks'

export class MissingTenantContextError extends Error {
  constructor() {
    super('Tenant context is required for this operation. Ensure the authenticate hook is applied.')
    this.name = 'MissingTenantContextError'
  }
}

export interface TenantStore {
  tenantId: string
}

// Shared AsyncLocalStorage — set by the authenticate Fastify hook for each request
export const tenantContext = new AsyncLocalStorage<TenantStore>()

// Run a callback within an explicit tenant context (useful in tests and background jobs)
export function withTenant<T>(tenantId: string, fn: () => Promise<T>): Promise<T> {
  return tenantContext.run({ tenantId }, fn)
}

// Assert tenant context exists — call in service methods that require isolation
export function requireTenantContext(): TenantStore {
  const store = tenantContext.getStore()
  if (!store) throw new MissingTenantContextError()
  return store
}

// Models that carry a tenantId column and must be filtered per tenant
const TENANT_SCOPED_MODELS = new Set([
  'User',
  'Course',
  'Unit',
  'Lesson',
  'Activity',
  'Classroom',
  'Enrollment',
  'Session',
  'SrsItem',
  'MediaAsset',
  'AiDraft',
  'AiGenerationLog',
  'AiSuggestion',
  'ErrorPattern',
  'Certificate',
  'LessonProgress',
  'ActivityAttempt',
  'SrsReviewLog',
  'StudentBadge',
])

type MiddlewareParams = {
  model?: string
  action: string
  args: Record<string, unknown>
  dataPath: string[]
  runInTransaction: boolean
}

type MiddlewareNext = (params: MiddlewareParams) => Promise<unknown>

export async function tenantMiddleware(
  params: MiddlewareParams,
  next: MiddlewareNext,
): Promise<unknown> {
  if (!TENANT_SCOPED_MODELS.has(params.model ?? '')) {
    return next(params)
  }

  const store = tenantContext.getStore()

  // Only apply tenant filter when there is an active, non-empty tenantId.
  // Public routes (auth endpoints) and the fresh request context (tenantId = '')
  // both result in no filtering — isolation is enforced after authentication.
  const activeTenantId = store?.tenantId || null

  if (params.action === 'findMany' || params.action === 'findFirst') {
    const where = (params.args.where as Record<string, unknown>) ?? {}

    // Public template courses are visible to all tenants — bypass tenant filter
    if (params.model === 'Course' && where.visibility === 'public_template') {
      return next(params)
    }

    if (activeTenantId) {
      if (!('tenantId' in where)) {
        params.args = {
          ...params.args,
          where: { ...where, tenantId: activeTenantId },
        }
      }
    }
  }

  if (params.action === 'create') {
    if (activeTenantId) {
      const data = (params.args.data as Record<string, unknown>) ?? {}
      if (!('tenantId' in data)) {
        params.args = {
          ...params.args,
          data: { ...data, tenantId: activeTenantId },
        }
      }
    }
  }

  return next(params)
}
