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
  {
    test: {
      name: 'api-integration',
      include: ['apps/api/src/**/*.integration.test.ts'],
      environment: 'node',
      globalSetup: ['apps/api/test/globalSetup.ts'],
      testTimeout: 30_000,
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
