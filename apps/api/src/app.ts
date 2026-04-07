import Fastify from 'fastify'
import cors from '@fastify/cors'
import helmet from '@fastify/helmet'
import rateLimit from '@fastify/rate-limit'

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

  app.get('/v1/health', async () => {
    return { status: 'ok', timestamp: new Date().toISOString() }
  })

  return app
}
