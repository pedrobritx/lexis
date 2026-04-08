/**
 * JWT service unit tests
 * Mocks Redis — no network required.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import jwt from 'jsonwebtoken'

// ── Mock Redis ────────────────────────────────────────────
const mockRedis = {
  set: vi.fn().mockResolvedValue('OK'),
  del: vi.fn().mockResolvedValue(1),
  get: vi.fn().mockResolvedValue(null),
  sadd: vi.fn().mockResolvedValue(1),
  srem: vi.fn().mockResolvedValue(1),
  expire: vi.fn().mockResolvedValue(1),
  smembers: vi.fn().mockResolvedValue([]),
  pipeline: vi.fn().mockReturnValue({
    del: vi.fn().mockReturnThis(),
    exec: vi.fn().mockResolvedValue([]),
  }),
}

vi.mock('@lexis/cache', () => ({ redis: mockRedis }))

// ── Import AFTER mocking ──────────────────────────────────
const { signAccessToken, signRefreshToken, verifyAccessToken, consumeRefreshToken, logout, invalidateAllTokensForUser } =
  await import('./jwt.service.js')

const SECRET = 'test-secret-min-32-chars-long-ok'
const REFRESH_SECRET = 'test-refresh-secret-min-32-chars-ok'

beforeEach(() => {
  process.env.JWT_SECRET = SECRET
  process.env.JWT_REFRESH_SECRET = REFRESH_SECRET
  vi.clearAllMocks()
  mockRedis.pipeline.mockReturnValue({
    del: vi.fn().mockReturnThis(),
    exec: vi.fn().mockResolvedValue([]),
  })
})

describe('signAccessToken', () => {
  it('creates a JWT with correct sub, tenantId, role', () => {
    const token = signAccessToken({ userId: 'u1', tenantId: 'tid', role: 'teacher' })
    const decoded = jwt.verify(token, SECRET) as Record<string, unknown>
    expect(decoded.sub).toBe('u1')
    expect(decoded.tenantId).toBe('tid')
    expect(decoded.role).toBe('teacher')
  })

  it('expires in 15 minutes', () => {
    const token = signAccessToken({ userId: 'u1', tenantId: 'tid', role: 'teacher' })
    const decoded = jwt.decode(token) as { exp: number; iat: number }
    expect(decoded.exp - decoded.iat).toBe(900)
  })
})

describe('verifyAccessToken', () => {
  it('returns correct payload for valid token', () => {
    const token = signAccessToken({ userId: 'u2', tenantId: 'tid2', role: 'student' })
    const payload = verifyAccessToken(token)
    expect(payload.userId).toBe('u2')
    expect(payload.tenantId).toBe('tid2')
    expect(payload.role).toBe('student')
  })

  it('throws on tampered token', () => {
    const token = signAccessToken({ userId: 'u1', tenantId: 'tid', role: 'teacher' })
    const tampered = token.slice(0, -5) + 'XXXXX'
    expect(() => verifyAccessToken(tampered)).toThrow()
  })

  it('throws on expired token', () => {
    const expired = jwt.sign({ tenantId: 't', role: 'teacher' }, SECRET, {
      subject: 'uid',
      expiresIn: '-1s',
    })
    expect(() => verifyAccessToken(expired)).toThrow()
  })

  it('throws on wrong secret', () => {
    const token = jwt.sign({ tenantId: 't', role: 'teacher' }, 'wrong-secret-long-enough-for-jwt', { subject: 'uid' })
    expect(() => verifyAccessToken(token)).toThrow()
  })
})

describe('signRefreshToken', () => {
  it('creates a token and stores it in Redis', async () => {
    const token = await signRefreshToken('user1')
    expect(typeof token).toBe('string')
    expect(mockRedis.set).toHaveBeenCalledWith(
      expect.stringMatching(/^refresh:/),
      'user1',
      'EX',
      expect.any(Number),
    )
  })

  it('generates unique jti on each call', async () => {
    const t1 = await signRefreshToken('user1')
    const t2 = await signRefreshToken('user1')
    expect(t1).not.toBe(t2)
  })
})

describe('consumeRefreshToken', () => {
  it('returns userId on valid token', async () => {
    mockRedis.del.mockResolvedValueOnce(1)
    const token = await signRefreshToken('user-abc')
    const userId = await consumeRefreshToken(token)
    expect(userId).toBe('user-abc')
  })

  it('throws 401 on reuse (Redis DEL returns 0)', async () => {
    mockRedis.del.mockResolvedValueOnce(0)
    mockRedis.smembers.mockResolvedValueOnce([])
    const token = await signRefreshToken('user-xyz')
    await expect(consumeRefreshToken(token)).rejects.toMatchObject({ statusCode: 401 })
  })

  it('throws 401 on invalid token string', async () => {
    await expect(consumeRefreshToken('not.a.token')).rejects.toMatchObject({ statusCode: 401 })
  })
})

describe('logout', () => {
  it('deletes the refresh token from Redis', async () => {
    const token = await signRefreshToken('user-logout')
    await logout(token)
    expect(mockRedis.del).toHaveBeenCalled()
  })

  it('does not throw on already-invalid token', async () => {
    await expect(logout('invalid.token.here')).resolves.toBeUndefined()
  })
})

describe('invalidateAllTokensForUser', () => {
  it('DELs all jtis for the user', async () => {
    const pipe = { del: vi.fn().mockReturnThis(), exec: vi.fn().mockResolvedValue([]) }
    mockRedis.pipeline.mockReturnValueOnce(pipe)
    mockRedis.smembers.mockResolvedValueOnce(['jti1', 'jti2'])

    await invalidateAllTokensForUser('user-purge')

    expect(pipe.del).toHaveBeenCalledWith('refresh:jti1')
    expect(pipe.del).toHaveBeenCalledWith('refresh:jti2')
    expect(pipe.del).toHaveBeenCalledWith('refresh:user:user-purge')
  })
})
