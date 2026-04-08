import { describe, it, expect, vi } from 'vitest'
import { tenantMiddleware, tenantContext, withTenant, MissingTenantContextError } from './tenant.middleware.js'

type Params = {
  model?: string
  action: string
  args: Record<string, unknown>
  dataPath: string[]
  runInTransaction: boolean
}

function makeParams(override: Partial<Params>): Params {
  return {
    model: 'Course',
    action: 'findMany',
    args: { where: {} },
    dataPath: [],
    runInTransaction: false,
    ...override,
  }
}

describe('tenantMiddleware', () => {
  describe('with tenant context set', () => {
    it('appends tenantId to findMany where clause', async () => {
      const next = vi.fn().mockResolvedValue([])
      const params = makeParams({ model: 'Course', action: 'findMany', args: { where: { status: 'active' } } })

      await withTenant('tenant-abc', () => tenantMiddleware(params, next))

      expect(next).toHaveBeenCalledWith(
        expect.objectContaining({
          args: expect.objectContaining({
            where: expect.objectContaining({ tenantId: 'tenant-abc', status: 'active' }),
          }),
        }),
      )
    })

    it('appends tenantId to findFirst where clause', async () => {
      const next = vi.fn().mockResolvedValue(null)
      const params = makeParams({ model: 'User', action: 'findFirst', args: { where: {} } })

      await withTenant('tenant-xyz', () => tenantMiddleware(params, next))

      const called = next.mock.calls[0][0] as Params
      expect((called.args.where as Record<string, unknown>).tenantId).toBe('tenant-xyz')
    })

    it('injects tenantId into create data', async () => {
      const next = vi.fn().mockResolvedValue({ id: '1' })
      const params = makeParams({ model: 'Course', action: 'create', args: { data: { title: 'Test' } } })

      await withTenant('tenant-def', () => tenantMiddleware(params, next))

      const called = next.mock.calls[0][0] as Params
      expect((called.args.data as Record<string, unknown>).tenantId).toBe('tenant-def')
    })

    it('does not override explicit tenantId in create data', async () => {
      const next = vi.fn().mockResolvedValue({ id: '1' })
      const params = makeParams({
        model: 'Course',
        action: 'create',
        args: { data: { title: 'Test', tenantId: 'explicit-tenant' } },
      })

      await withTenant('different-tenant', () => tenantMiddleware(params, next))

      const called = next.mock.calls[0][0] as Params
      expect((called.args.data as Record<string, unknown>).tenantId).toBe('explicit-tenant')
    })
  })

  describe('without tenant context', () => {
    it('passes through findMany without filtering (auth routes work before auth)', async () => {
      const next = vi.fn().mockResolvedValue([])
      const params = makeParams({ model: 'User', action: 'findMany', args: { where: { email: 'x@x.com' } } })

      // No withTenant wrapper — no context
      await tenantMiddleware(params, next)

      const called = next.mock.calls[0][0] as Params
      // Should NOT have tenantId injected
      expect((called.args.where as Record<string, unknown>).tenantId).toBeUndefined()
    })

    it('passes through create without injecting tenantId', async () => {
      const next = vi.fn().mockResolvedValue({ id: '1' })
      const params = makeParams({ model: 'User', action: 'create', args: { data: { email: 'x@x.com' } } })

      await tenantMiddleware(params, next)

      const called = next.mock.calls[0][0] as Params
      expect((called.args.data as Record<string, unknown>).tenantId).toBeUndefined()
    })
  })

  describe('public_template bypass', () => {
    it('does not inject tenantId for Course findMany with public_template visibility', async () => {
      const next = vi.fn().mockResolvedValue([])
      const params = makeParams({
        model: 'Course',
        action: 'findMany',
        args: { where: { visibility: 'public_template' } },
      })

      await withTenant('some-tenant', () => tenantMiddleware(params, next))

      const called = next.mock.calls[0][0] as Params
      expect((called.args.where as Record<string, unknown>).tenantId).toBeUndefined()
    })
  })

  describe('non-tenant models', () => {
    it('passes through Tenant model without modification', async () => {
      const next = vi.fn().mockResolvedValue([])
      const params = makeParams({ model: 'Tenant', action: 'findMany', args: { where: {} } })

      await withTenant('some-tenant', () => tenantMiddleware(params, next))

      const called = next.mock.calls[0][0] as Params
      expect((called.args.where as Record<string, unknown>).tenantId).toBeUndefined()
    })
  })

  describe('withTenant helper', () => {
    it('correctly sets and clears tenant context', async () => {
      let capturedTenantId: string | undefined

      await withTenant('ctx-tenant', async () => {
        capturedTenantId = tenantContext.getStore()?.tenantId
      })

      expect(capturedTenantId).toBe('ctx-tenant')
      // After withTenant exits, context is gone
      expect(tenantContext.getStore()).toBeUndefined()
    })
  })

  describe('MissingTenantContextError', () => {
    it('is an instance of Error with correct name', () => {
      const err = new MissingTenantContextError()
      expect(err).toBeInstanceOf(Error)
      expect(err.name).toBe('MissingTenantContextError')
    })
  })
})
