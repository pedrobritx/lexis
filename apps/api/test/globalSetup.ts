import { execSync } from 'node:child_process'
import { setTimeout } from 'node:timers/promises'

const TEST_DATABASE_URL =
  'postgresql://lexis:lexis_test_password@localhost:5434/lexis_test'
const TEST_REDIS_URL = 'redis://localhost:6380'

export async function setup() {
  // Point all packages at test containers
  process.env.DATABASE_URL = TEST_DATABASE_URL
  process.env.DIRECT_URL = TEST_DATABASE_URL
  process.env.REDIS_URL = TEST_REDIS_URL

  // Ensure test containers are running
  try {
    execSync('docker compose -f docker-compose.test.yml up -d', {
      stdio: 'inherit',
      cwd: process.cwd(),
    })
  } catch {
    // containers may already be running — ignore
  }

  // Wait for postgres to be healthy (up to 30s)
  let attempts = 0
  while (attempts < 15) {
    try {
      execSync(
        'docker exec lexis-postgres-test pg_isready -U lexis -d lexis_test -p 5432',
        { stdio: 'pipe' },
      )
      break
    } catch {
      await setTimeout(2000)
      attempts++
    }
  }

  // Apply migrations and seed
  execSync('pnpm --filter @lexis/db exec prisma migrate deploy', {
    stdio: 'inherit',
    env: { ...process.env, DATABASE_URL: TEST_DATABASE_URL, DIRECT_URL: TEST_DATABASE_URL },
  })

  execSync('pnpm --filter @lexis/db exec prisma db seed', {
    stdio: 'inherit',
    env: { ...process.env, DATABASE_URL: TEST_DATABASE_URL, DIRECT_URL: TEST_DATABASE_URL },
  })
}

export async function teardown() {
  // Leave containers running between test runs for speed.
  // Run `pnpm docker:test:down` manually to stop them.
}
