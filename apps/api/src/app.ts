import Fastify from 'fastify'
import cors from '@fastify/cors'
import helmet from '@fastify/helmet'
import rateLimit from '@fastify/rate-limit'
import swagger from '@fastify/swagger'
import swaggerUi from '@fastify/swagger-ui'
import { tenantContext } from '@lexis/db'
import { authRoutes } from './modules/auth/auth.routes.js'
import { usersRoutes } from './modules/users/users.routes.js'
import { placementRoutes } from './modules/placement/placement.routes.js'
import { coursesRoutes, templateRoutes } from './modules/courses/courses.routes.js'
import { lessonActivitiesRoutes, activitiesRoutes } from './modules/activities/activities.routes.js'
import { classroomsRoutes, sessionsRoutes } from './modules/enrollments/enrollments.routes.js'
import { progressRoutes } from './modules/progress/progress.routes.js'
import { srsRoutes } from './modules/srs/srs.routes.js'
import { initSrsListeners } from './modules/srs/srs.service.js'
import { initGamificationListeners } from './modules/gamification/gamification.listeners.js'

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
    // Raise the cap significantly in test environments so integration test
    // suites (which fire many requests in a short window) never trip the limiter.
    max: process.env.NODE_ENV === 'test' ? 10_000 : 100,
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
  await app.register(usersRoutes, { prefix: '/v1/users' })
  await app.register(placementRoutes, { prefix: '/v1/placement' })
  await app.register(coursesRoutes, { prefix: '/v1/courses' })
  await app.register(templateRoutes, { prefix: '/v1/templates' })
  await app.register(lessonActivitiesRoutes, { prefix: '/v1/lessons' })
  await app.register(activitiesRoutes, { prefix: '/v1/activities' })
  await app.register(classroomsRoutes, { prefix: '/v1/classrooms' })
  await app.register(sessionsRoutes, { prefix: '/v1/sessions' })
  await app.register(progressRoutes, { prefix: '/v1/progress' })
  await app.register(srsRoutes, { prefix: '/v1/srs' })

  initSrsListeners()
  initGamificationListeners()

  return app
}
