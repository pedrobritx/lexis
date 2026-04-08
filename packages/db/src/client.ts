import { PrismaClient } from '@prisma/client'
import { softDeleteMiddleware } from './middleware/softDelete.middleware.js'
import { tenantMiddleware } from './middleware/tenant.middleware.js'

function createPrismaClient() {
  const client = new PrismaClient({
    log:
      process.env.NODE_ENV === 'development'
        ? ['query', 'warn', 'error']
        : ['warn', 'error'],
  })

  // Soft-delete must run first so tenant middleware receives the already-scoped action
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ;(client as any).$use(softDeleteMiddleware)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ;(client as any).$use(tenantMiddleware)

  return client
}

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined
}

export const prisma = globalForPrisma.prisma ?? createPrismaClient()

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma
}
