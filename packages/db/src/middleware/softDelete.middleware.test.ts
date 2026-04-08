import { describe, it, expect, vi } from 'vitest'
import { softDeleteMiddleware } from './softDelete.middleware.js'

type Params = {
  model?: string
  action: string
  args: Record<string, unknown>
  dataPath: string[]
  runInTransaction: boolean
}

function makeParams(override: Partial<Params>): Params {
  return {
    model: 'User',
    action: 'findMany',
    args: {},
    dataPath: [],
    runInTransaction: false,
    ...override,
  }
}

describe('softDeleteMiddleware', () => {
  it('appends deletedAt: null for findMany on soft-delete models', async () => {
    const next = vi.fn().mockResolvedValue([])
    const params = makeParams({ model: 'User', action: 'findMany', args: { where: { role: 'teacher' } } })

    await softDeleteMiddleware(params, next)

    expect(next).toHaveBeenCalledWith(
      expect.objectContaining({
        args: expect.objectContaining({
          where: expect.objectContaining({ deletedAt: null, role: 'teacher' }),
        }),
      }),
    )
  })

  it('appends deletedAt: null for findFirst on soft-delete models', async () => {
    const next = vi.fn().mockResolvedValue(null)
    const params = makeParams({ model: 'Course', action: 'findFirst', args: { where: {} } })

    await softDeleteMiddleware(params, next)

    expect(next).toHaveBeenCalledWith(
      expect.objectContaining({
        args: expect.objectContaining({ where: expect.objectContaining({ deletedAt: null }) }),
      }),
    )
  })

  it('does not double-apply deletedAt filter if already set', async () => {
    const next = vi.fn().mockResolvedValue([])
    const params = makeParams({
      model: 'User',
      action: 'findMany',
      args: { where: { deletedAt: { not: null } } }, // caller wants soft-deleted records
    })

    await softDeleteMiddleware(params, next)

    // Should not override caller's explicit deletedAt filter
    expect(next).toHaveBeenCalledWith(
      expect.objectContaining({
        args: expect.objectContaining({
          where: expect.objectContaining({ deletedAt: { not: null } }),
        }),
      }),
    )
  })

  it('converts delete to update with deletedAt for soft-delete models', async () => {
    const next = vi.fn().mockResolvedValue({ id: '1' })
    const params = makeParams({
      model: 'User',
      action: 'delete',
      args: { where: { id: '1' } },
    })

    await softDeleteMiddleware(params, next)

    expect(next).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'update',
        args: expect.objectContaining({
          data: expect.objectContaining({ deletedAt: expect.any(Date) }),
        }),
      }),
    )
  })

  it('converts deleteMany to updateMany with deletedAt', async () => {
    const next = vi.fn().mockResolvedValue({ count: 2 })
    const params = makeParams({
      model: 'Lesson',
      action: 'deleteMany',
      args: { where: { courseId: 'cid' } },
    })

    await softDeleteMiddleware(params, next)

    expect(next).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'updateMany',
        args: expect.objectContaining({
          data: expect.objectContaining({ deletedAt: expect.any(Date) }),
        }),
      }),
    )
  })

  it('passes through non-soft-delete models unchanged', async () => {
    const next = vi.fn().mockResolvedValue([])
    const params = makeParams({ model: 'Tenant', action: 'findMany', args: { where: {} } })
    const originalParams = { ...params }

    await softDeleteMiddleware(params, next)

    expect(next).toHaveBeenCalledWith(expect.objectContaining({ model: originalParams.model }))
    // where should NOT have deletedAt injected
    const calledWith = next.mock.calls[0][0] as Params
    expect((calledWith.args.where as Record<string, unknown>)?.deletedAt).toBeUndefined()
  })

  it('handles undefined where in findMany', async () => {
    const next = vi.fn().mockResolvedValue([])
    const params = makeParams({ model: 'Activity', action: 'findMany', args: {} })

    await softDeleteMiddleware(params, next)

    expect(next).toHaveBeenCalledWith(
      expect.objectContaining({
        args: expect.objectContaining({
          where: expect.objectContaining({ deletedAt: null }),
        }),
      }),
    )
  })
})
