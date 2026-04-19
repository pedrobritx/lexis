import { execSync } from 'node:child_process'
import { createConnection } from 'node:net'
import { setTimeout } from 'node:timers/promises'

// Local-dev defaults — only used when env vars are absent (CI sets its own).
const LOCAL_DATABASE_URL =
  'postgresql://lexis:lexis_test_password@localhost:5434/lexis_test'
const LOCAL_REDIS_URL = 'redis://localhost:6380'

function parseHostPort(url: string): { host: string; port: number } {
  const u = new URL(url)
  const port = u.port ? Number(u.port) : u.protocol === 'redis:' ? 6379 : 5432
  return { host: u.hostname, port }
}

async function waitForTcp(url: string, label: string, tries = 30): Promise<void> {
  const { host, port } = parseHostPort(url)
  for (let i = 0; i < tries; i++) {
    const ok = await new Promise<boolean>((resolve) => {
      const socket = createConnection({ host, port })
      socket.once('connect', () => {
        socket.end()
        resolve(true)
      })
      socket.once('error', () => {
        socket.destroy()
        resolve(false)
      })
    })
    if (ok) return
    await setTimeout(1000)
  }
  throw new Error(`${label} at ${host}:${port} never became reachable`)
}

export async function setup() {
  const isCI = !!process.env.CI

  // Respect env vars set by CI (GitHub Actions service containers).
  // Fall back to local docker-compose.test.yml defaults when unset.
  if (!process.env.DATABASE_URL) process.env.DATABASE_URL = LOCAL_DATABASE_URL
  if (!process.env.DIRECT_URL) process.env.DIRECT_URL = process.env.DATABASE_URL
  if (!process.env.REDIS_URL) process.env.REDIS_URL = LOCAL_REDIS_URL

  // Only start local docker containers outside CI — in CI the service
  // containers already bind the same ports, and `docker compose up` would fail.
  if (!isCI) {
    try {
      execSync('docker compose -f docker-compose.test.yml up -d', {
        stdio: 'inherit',
        cwd: process.cwd(),
      })
    } catch {
      // containers may already be running — ignore
    }
  }

  // Wait for Postgres and Redis to accept TCP connections.
  await waitForTcp(process.env.DATABASE_URL, 'Postgres')
  await waitForTcp(process.env.REDIS_URL, 'Redis')

  // Apply migrations and seed against whatever DATABASE_URL resolves to.
  execSync('pnpm --filter @lexis/db exec prisma migrate deploy', {
    stdio: 'inherit',
    env: { ...process.env },
  })

  execSync('pnpm --filter @lexis/db exec prisma db seed', {
    stdio: 'inherit',
    env: { ...process.env },
  })
}

export async function teardown() {
  // Leave containers running between local test runs for speed.
  // Run `pnpm docker:test:down` manually to stop them.
}
