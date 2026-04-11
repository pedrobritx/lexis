import { defineWorkspace } from 'vitest/config'

export default defineWorkspace([
  // Unit tests for all shared packages
  {
    test: {
      name: 'packages',
      include: ['packages/*/src/**/*.test.ts'],
      environment: 'node',
      coverage: {
        thresholds: {
          '**/db/middleware/**': { lines: 90, functions: 90 },
          '**/srs/src/**': { lines: 90, functions: 90 },
          '**': { lines: 70, functions: 70 },
        },
      },
    },
  },

  // Unit tests for the API (services, utilities — no DB/network)
  {
    test: {
      name: 'api-unit',
      include: ['apps/api/src/**/*.unit.test.ts'],
      environment: 'node',
      coverage: {
        thresholds: {
          '**/modules/auth/**': { lines: 90, functions: 90 },
          '**': { lines: 70, functions: 70 },
        },
      },
    },
  },

  // Integration tests for the API (Supertest + real DB + Redis)
  // singleFork: true forces all test files in this project to run in a single
  // worker process, which serialises file execution and prevents the cross-test
  // OTP/Redis key interference that occurs when afterEach hooks in one file
  // delete keys that a concurrently-running file still needs.
  {
    test: {
      name: 'api-integration',
      include: ['apps/api/src/**/*.integration.test.ts'],
      environment: 'node',
      globalSetup: ['apps/api/test/globalSetup.ts'],
      testTimeout: 30_000,
      pool: 'forks',
      poolOptions: {
        forks: {
          singleFork: true,
        },
      },
      coverage: {
        thresholds: {
          '**/modules/auth/**': { lines: 90, functions: 90 },
          '**': { lines: 70, functions: 70 },
        },
      },
    },
  },

  // Realtime server unit tests (stubs until Day Phase 2)
  {
    test: {
      name: 'realtime',
      include: ['apps/realtime/src/**/*.unit.test.ts'],
      environment: 'node',
    },
  },

  // Realtime Socket.IO event sequence tests (stubs until Phase 2)
  {
    test: {
      name: 'realtime-events',
      include: ['apps/realtime/src/**/*.events.test.ts'],
      environment: 'node',
    },
  },
])
