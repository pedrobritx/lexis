import { buildApp } from './app.js'

const REQUIRED_VARS: Array<{ name: string; minLength?: number }> = [
  { name: 'DATABASE_URL' },
  { name: 'DIRECT_URL' },
  { name: 'JWT_SECRET', minLength: 32 },
  { name: 'JWT_REFRESH_SECRET', minLength: 32 },
  { name: 'REDIS_URL' },
  { name: 'ANTHROPIC_API_KEY' },
  { name: 'RESEND_API_KEY' },
  { name: 'WEBAUTHN_RP_ID' },
  { name: 'WEBAUTHN_RP_NAME' },
  { name: 'WEBAUTHN_ORIGIN' },
]

function validateEnv(): void {
  const errors: string[] = []
  for (const { name, minLength } of REQUIRED_VARS) {
    const value = process.env[name]
    if (!value) {
      errors.push(`  ${name}: missing`)
    } else if (minLength !== undefined && value.length < minLength) {
      errors.push(`  ${name}: must be at least ${minLength} characters (got ${value.length})`)
    }
  }
  if (errors.length > 0) {
    // eslint-disable-next-line no-console
    console.error('Server cannot start — missing or invalid environment variables:')
    // eslint-disable-next-line no-console
    console.error(errors.join('\n'))
    process.exit(1)
  }
}

async function start() {
  validateEnv()
  const app = await buildApp()
  const port = Number(process.env.PORT) || 3000
  await app.listen({ port, host: '0.0.0.0' })
  app.log.info({ port }, 'Lexis API server started')
}

start().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('Failed to start server:', err)
  process.exit(1)
})
