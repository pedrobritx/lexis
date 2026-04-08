import { Resend } from 'resend'
import { redis } from '@lexis/cache'
import { logger } from '@lexis/logger'

const log = logger('otp-service')

// 10 minutes TTL
const OTP_TTL = 600

function getResend(): Resend {
  const key = process.env.RESEND_API_KEY
  if (!key) throw new Error('RESEND_API_KEY env var is required')
  return new Resend(key)
}

function fromEmail(): string {
  return process.env.FROM_EMAIL || 'noreply@lexis.app'
}

export function generateOtp(): string {
  return Math.floor(Math.random() * 1_000_000)
    .toString()
    .padStart(6, '0')
}

export async function requestOtp(email: string): Promise<void> {
  const code = generateOtp()

  await redis.set(`otp:${email}`, code, 'EX', OTP_TTL)

  const resend = getResend()
  const { error } = await resend.emails.send({
    from: fromEmail(),
    to: email,
    subject: 'Your Lexis login code',
    text: `Your Lexis login code: ${code}. Expires in 10 minutes. Do not share this code.`,
  })

  if (error) {
    log.error({ email, error }, 'Failed to send OTP email')
    throw Object.assign(new Error('Failed to send login code'), { statusCode: 500 })
  }

  log.info({ email }, 'OTP sent')
}

/**
 * Verifies an OTP for the given email.
 * Returns true and consumes the code on success.
 * Returns false on invalid or expired code.
 */
export async function verifyOtp(email: string, code: string): Promise<boolean> {
  const stored = await redis.get(`otp:${email}`)

  if (!stored || stored !== code) {
    return false
  }

  // Consume — single use
  await redis.del(`otp:${email}`)
  return true
}
