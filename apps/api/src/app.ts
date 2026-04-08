import Fastify from 'fastify'
import cors from '@fastify/cors'
import helmet from '@fastify/helmet'
import rateLimit from '@fastify/rate-limit'
import swagger from '@fastify/swagger'
import swaggerUi from '@fastify/swagger-ui'
import { tenantContext } from '@lexis/db'
import { authRoutes } from './modules/auth/auth.routes.js'

export async function buildApp() {
  const app = Fastify({
    logger: {
      level: process.env.LOG_LEVEL || 'info',
      name: 'api',
    },
  })

  await app.register(cors, {
    origin: process.env.RT_CORS_ORIGIN || 'http://localhost:3001',
    credentials: true,
  })

  await app.register(helmet)

  await app.register(rateLimit, {
    max: 100,
    timeWindow: '1 minute',
  })

  await app.register(swagger, {
    openapi: {
      info: {
        title: 'Lexis API',
        description: 'Language teaching platform API',
        version: '0.1.0',
      },
      components: {
        securitySchemes: {
          bearerAuth: {
            type: 'http',
            scheme: 'bearer',
            bearerFormat: 'JWT',
          },
        },
      },
    },
  })

  await app.register(swaggerUi, {
    routePrefix: '/docs',
    uiConfig: {
      docExpansion: 'list',
      deepLinking: true,
    },
  })

  // ── Per-request tenant context isolation ─────────────
  // Each request gets its own AsyncLocalStorage context. The authenticate
  // preHandler then calls enterWith() to set the tenant, but only within
  // this isolated async subtree — preventing cross-request context leaks.
  app.addHook('onRequest', (_req, _reply, done) => {
    tenantContext.run({ tenantId: '' }, () => done())
  })

  // ── Routes ────────────────────────────────────────────

  app.get('/v1/health', async () => {
    return { status: 'ok', timestamp: new Date().toISOString() }
  })

  await app.register(authRoutes, { prefix: '/v1/auth' })

  return app
}
