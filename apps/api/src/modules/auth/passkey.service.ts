import {
  generateRegistrationOptions,
  verifyRegistrationResponse,
  generateAuthenticationOptions,
  verifyAuthenticationResponse,
} from '@simplewebauthn/server'
import type {
  RegistrationResponseJSON,
  AuthenticationResponseJSON,
} from '@simplewebauthn/types'
import { prisma } from '@lexis/db'
import { redis } from '@lexis/cache'
import { logger } from '@lexis/logger'

const log = logger('passkey-service')

// Challenge TTL: 5 minutes
const CHALLENGE_TTL = 300

function rpID(): string {
  return process.env.WEBAUTHN_RP_ID || 'localhost'
}

function rpName(): string {
  return process.env.WEBAUTHN_RP_NAME || 'Lexis'
}

function rpOrigin(): string | string[] {
  const origin = process.env.WEBAUTHN_RP_ORIGIN || 'http://localhost:3001'
  return origin.includes(',') ? origin.split(',').map((o) => o.trim()) : origin
}

// ─── Registration ─────────────────────────────────────────

export async function beginRegistration(userId: string, email: string) {
  const existingCredentials = await prisma.passkeyCredential.findMany({
    where: { userId },
    select: { credentialId: true },
  })

  const options = await generateRegistrationOptions({
    rpName: rpName(),
    rpID: rpID(),
    userID: userId,  // v9 expects a string
    userName: email,
    userDisplayName: email,
    attestationType: 'none',
    excludeCredentials: existingCredentials.map((c) => ({
      id: new Uint8Array(c.credentialId),
      type: 'public-key' as const,
    })),
    authenticatorSelection: {
      residentKey: 'preferred',
      userVerification: 'preferred',
    },
  })

  await redis.set(
    `challenge:reg:${userId}`,
    options.challenge,
    'EX',
    CHALLENGE_TTL,
  )

  return options
}

export async function completeRegistration(
  userId: string,
  response: RegistrationResponseJSON,
  deviceLabel?: string,
) {
  const expectedChallenge = await redis.get(`challenge:reg:${userId}`)
  if (!expectedChallenge) {
    throw Object.assign(new Error('Registration challenge expired or not found'), {
      statusCode: 400,
    })
  }
  await redis.del(`challenge:reg:${userId}`)

  const verification = await verifyRegistrationResponse({
    response,
    expectedChallenge,
    expectedOrigin: rpOrigin(),
    expectedRPID: rpID(),
  })

  if (!verification.verified || !verification.registrationInfo) {
    throw Object.assign(new Error('Passkey registration verification failed'), {
      statusCode: 400,
    })
  }

  const { credentialID, credentialPublicKey, counter, credentialDeviceType } =
    verification.registrationInfo

  log.info({ userId, credentialDeviceType }, 'Passkey registered')

  const credential = await prisma.passkeyCredential.create({
    data: {
      userId,
      credentialId: Buffer.from(credentialID),
      publicKey: Buffer.from(credentialPublicKey),
      signCount: counter,
      deviceLabel: deviceLabel ?? null,
    },
  })

  return credential
}

// ─── Authentication ───────────────────────────────────────

export async function beginAuthentication(email: string) {
  const user = await prisma.user.findUnique({
    where: { email },
    include: { passkeyCredentials: true },
  })

  if (!user || user.passkeyCredentials.length === 0) {
    throw Object.assign(
      new Error('No passkeys registered for this email'),
      { statusCode: 404 },
    )
  }

  const options = await generateAuthenticationOptions({
    rpID: rpID(),
    allowCredentials: user.passkeyCredentials.map((c) => ({
      id: new Uint8Array(c.credentialId),
      type: 'public-key' as const,
    })),
    userVerification: 'preferred',
  })

  await redis.set(
    `challenge:auth:${user.id}`,
    options.challenge,
    'EX',
    CHALLENGE_TTL,
  )

  return { options, userId: user.id }
}

export async function completeAuthentication(
  email: string,
  response: AuthenticationResponseJSON,
) {
  const user = await prisma.user.findUnique({
    where: { email },
    include: { passkeyCredentials: true },
  })

  if (!user) {
    throw Object.assign(new Error('User not found'), { statusCode: 404 })
  }

  const expectedChallenge = await redis.get(`challenge:auth:${user.id}`)
  if (!expectedChallenge) {
    throw Object.assign(new Error('Authentication challenge expired or not found'), {
      statusCode: 400,
    })
  }
  await redis.del(`challenge:auth:${user.id}`)

  // Match credential by base64url-encoded ID from the response
  const responseId = response.rawId ?? response.id
  const credential = user.passkeyCredentials.find(
    (c) => Buffer.from(c.credentialId).toString('base64url') === responseId,
  )

  if (!credential) {
    throw Object.assign(new Error('Credential not found'), { statusCode: 400 })
  }

  const verification = await verifyAuthenticationResponse({
    response,
    expectedChallenge,
    expectedOrigin: rpOrigin(),
    expectedRPID: rpID(),
    authenticator: {
      credentialID: new Uint8Array(credential.credentialId),
      credentialPublicKey: new Uint8Array(credential.publicKey),
      counter: credential.signCount,
    },
  })

  if (!verification.verified) {
    throw Object.assign(new Error('Passkey authentication failed'), { statusCode: 401 })
  }

  const { newCounter } = verification.authenticationInfo

  // Replay attack detection: sign count must increase
  if (newCounter <= credential.signCount) {
    log.warn(
      { userId: user.id, credentialId: credential.id },
      'Possible passkey clone detected — sign count did not increase',
    )
    throw Object.assign(
      new Error('Passkey replay attack detected'),
      { statusCode: 401 },
    )
  }

  await prisma.passkeyCredential.update({
    where: { id: credential.id },
    data: { signCount: newCounter },
  })

  log.info({ userId: user.id }, 'Passkey authentication successful')
  return user
}

// ─── Management ───────────────────────────────────────────

export async function listPasskeys(userId: string) {
  return prisma.passkeyCredential.findMany({
    where: { userId },
    select: {
      id: true,
      deviceLabel: true,
      createdAt: true,
    },
    orderBy: { createdAt: 'asc' },
  })
}

export async function deletePasskey(userId: string, credentialDbId: string) {
  const credentials = await prisma.passkeyCredential.findMany({
    where: { userId },
  })

  const target = credentials.find((c) => c.id === credentialDbId)
  if (!target) {
    throw Object.assign(new Error('Passkey not found'), { statusCode: 404 })
  }

  if (credentials.length === 1) {
    throw Object.assign(
      new Error('Cannot delete the last passkey'),
      { statusCode: 409 },
    )
  }

  await prisma.passkeyCredential.delete({ where: { id: credentialDbId } })
}

