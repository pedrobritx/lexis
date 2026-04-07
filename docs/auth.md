# Authentication

Lexis has no passwords. Two auth paths, both issuing the same JWT pair on success.

## Auth paths

### Path 1 — Passkey (WebAuthn)

```
Registration:
  POST /v1/auth/passkey/register/begin    → challenge JSON
  POST /v1/auth/passkey/register/complete → JWT pair

Authentication:
  POST /v1/auth/passkey/login/begin    → assertion challenge
  POST /v1/auth/passkey/login/complete → JWT pair
```

**Implementation:** `@simplewebauthn/server` on the API. Browser uses `navigator.credentials`. iOS uses `ASAuthorizationController` with `ASAuthorizationPlatformPublicKeyCredentialProvider` (native Face ID / Touch ID, iOS 16+).

**Security:** `sign_count` in `passkey_credentials` prevents replay attacks. Verify `sign_count` is greater than stored value on every authentication. Reject and alert if equal or lower (possible cloned credential).

**Environment variables required:**
```
WEBAUTHN_RP_ID=lexis.app
WEBAUTHN_RP_ORIGIN=https://lexis.app
```

### Path 2 — Magic link OTP

```
POST /v1/auth/magic/request   body: {email}
  → Generates 6-digit code
  → Stores in Redis: SET otp:{email} {code} EX 600  (10 minutes)
  → Sends email via Resend
  → Returns: {message: 'Code sent'}

POST /v1/auth/magic/verify    body: {email, code}
  → Validates code from Redis
  → DEL otp:{email}  (consume — single use)
  → Issues JWT pair
  → Returns: {accessToken, refreshToken}
```

**OTP format:** exactly 6 numeric digits, zero-padded. Test across 1000 iterations.
**Fallback:** if user has no passkey registered, OTP is the only option. Always available.

## JWT pair

```typescript
// Access token — short-lived
{
  sub: userId,
  tenantId: string,
  role: 'teacher' | 'student' | 'system',
  exp: now + 15min
}

// Refresh token — long-lived, stored in Redis
{
  sub: userId,
  jti: uuid,  // unique token ID
  exp: now + 30d
}
```

**Refresh token storage:** `SET refresh:{jti} {userId} EX 2592000`
**Rotation on use:** consuming a refresh token deletes the old key and issues a new one.
**Reuse detection:** if a consumed token is presented again, invalidate ALL tokens for that user (possible theft).

```
POST /v1/auth/refresh   body: {refreshToken} → {accessToken, refreshToken}
POST /v1/auth/logout    body: {refreshToken} → DEL refresh:{jti}
```

## Fastify authenticate hook

```typescript
// Attach to every protected route
fastify.addHook('preHandler', authenticate)

// authenticate reads Authorization: Bearer {token}
// Attaches to req.user: { userId, tenantId, role }
// Throws 401 on missing/invalid/expired token
```

**Never trust `tenantId` from the request body or query params.** Always use `req.user.tenantId`.

## Tenant auto-creation on teacher registration

When a teacher registers (either auth path, first time):
1. Check if `users` row exists for this email
2. If not: create `users` row with `role = 'teacher'`
3. Create `tenants` row with `name = email prefix, slug = nanoid`
4. Create `subscriptions` row with `plan_slug = 'free', student_limit = 3, lesson_plan_limit = 5, ai_credits_remaining = 0`
5. Set `users.tenant_id = tenants.id`
6. Issue JWT pair with `tenantId` set

Students do not create tenants. Students are enrolled by teachers via `POST /v1/classrooms/:id/enroll`.

## Consent

Required before profile creation. Called once during onboarding:

```
POST /v1/auth/consent   body: {policyVersion: '1.0'}
  → Creates consent_records row
  → Sets req.user context
  → Returns: {consented: true}
```

If a user has no consent record, the onboarding middleware redirects to the consent screen.

## Passkey management

Users can register multiple passkeys (phone + laptop + tablet):

```
GET    /v1/auth/passkeys           → list user's registered passkeys
DELETE /v1/auth/passkeys/:id       → remove a passkey
```

**Guard:** cannot delete the last passkey if the user has no OTP fallback set up. Always leave at least one auth method.

## GDPR — account deletion

```
DELETE /v1/users/me
  → Sets users.deleted_at = now()
  → Cascades soft-delete to all user-owned data
  → Deletes all refresh tokens from Redis
  → Returns: {deleted: true, effectiveAt: timestamp}
```

Data is retained for 30 days before hard deletion (allows recovery on error). A BullMQ job sweeps soft-deleted users older than 30 days and hard-deletes them.
