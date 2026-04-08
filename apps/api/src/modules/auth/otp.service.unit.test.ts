/**
 * OTP service unit tests
 * Mocks Redis and Resend.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockRedis = {
  set: vi.fn().mockResolvedValue('OK'),
  get: vi.fn().mockResolvedValue(null),
  del: vi.fn().mockResolvedValue(1),
}

const mockSend = vi.fn().mockResolvedValue({ data: { id: 'email-id' }, error: null })
vi.mock('resend', () => ({
  Resend: vi.fn().mockImplementation(() => ({ emails: { send: mockSend } })),
}))
vi.mock('@lexis/cache', () => ({ redis: mockRedis }))
vi.mock('@lexis/logger', () => ({ logger: () => ({ info: vi.fn(), error: vi.fn() }) }))

const { generateOtp, requestOtp, verifyOtp } = await import('./otp.service.js')

beforeEach(() => {
  process.env.RESEND_API_KEY = 'test-key'
  process.env.FROM_EMAIL = 'noreply@test.lexis'
  vi.clearAllMocks()
  mockSend.mockResolvedValue({ data: { id: 'email-id' }, error: null })
})

describe('generateOtp', () => {
  it('returns a 6-digit zero-padded string', () => {
    for (let i = 0; i < 50; i++) {
      const code = generateOtp()
      expect(code).toMatch(/^\d{6}$/)
    }
  })

  it('pads codes below 100000', () => {
    // Force a low random value
    vi.spyOn(Math, 'random').mockReturnValueOnce(0)
    const code = generateOtp()
    expect(code).toBe('000000')
    vi.spyOn(Math, 'random').mockRestore()
  })
})

describe('requestOtp', () => {
  it('stores OTP in Redis with 600s TTL', async () => {
    await requestOtp('user@example.com')
    expect(mockRedis.set).toHaveBeenCalledWith(
      'otp:user@example.com',
      expect.stringMatching(/^\d{6}$/),
      'EX',
      600,
    )
  })

  it('sends email via Resend', async () => {
    await requestOtp('user@example.com')
    expect(mockSend).toHaveBeenCalledWith(
      expect.objectContaining({
        to: 'user@example.com',
        subject: 'Your Lexis login code',
      }),
    )
  })

  it('throws 500 when Resend returns an error', async () => {
    mockSend.mockResolvedValueOnce({ data: null, error: { message: 'send failed' } })
    await expect(requestOtp('fail@example.com')).rejects.toMatchObject({ statusCode: 500 })
  })
})

describe('verifyOtp', () => {
  it('returns true and deletes code on match', async () => {
    mockRedis.get.mockResolvedValueOnce('123456')
    const result = await verifyOtp('user@example.com', '123456')
    expect(result).toBe(true)
    expect(mockRedis.del).toHaveBeenCalledWith('otp:user@example.com')
  })

  it('returns false on code mismatch', async () => {
    mockRedis.get.mockResolvedValueOnce('654321')
    const result = await verifyOtp('user@example.com', '000000')
    expect(result).toBe(false)
    expect(mockRedis.del).not.toHaveBeenCalled()
  })

  it('returns false when no OTP stored (expired)', async () => {
    mockRedis.get.mockResolvedValueOnce(null)
    const result = await verifyOtp('user@example.com', '123456')
    expect(result).toBe(false)
  })
})
