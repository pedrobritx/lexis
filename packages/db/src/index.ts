export { prisma } from './client.js'
export {
  tenantContext,
  withTenant,
  requireTenantContext,
  MissingTenantContextError,
} from './middleware/index.js'
export type { TenantStore } from './middleware/index.js'
