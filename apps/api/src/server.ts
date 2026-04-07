import { buildApp } from './app.js'

async function start() {
  const app = await buildApp()
  const port = Number(process.env.PORT) || 3000
  const host = '0.0.0.0'

  await app.listen({ port, host })
  app.log.info({ port }, 'Lexis API server started')
}

start().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('Failed to start server:', err)
  process.exit(1)
})
