# Authentication

Lexis has no passwords. Two auth paths, both issuing the same JWT pair on success.

---

## Path 1 — Passkey (WebAuthn)

### Registration

```
POST /v1/auth/passkey/register/begin
  Body: {email}
  Response: WebAuthn PublicKeyCredentialCreationOptions (challenge JSON)

POST /v1/auth/passkey/register/complete
  Body: {email, credential: AuthenticatorAttestationResponse}
  Response: {accessToken, refreshToken}
```

### Authentication

```
POST /v1/auth/passkey/login/begin
  Body: {email}
  Response: WebAuthn PublicKeyCredentialRequestOptions (assertion challenge)

POST /v1/auth/passkey/login/complete
  Body: {email, assertion: AuthenticatorAssertionResponse}
  Response: {accessToken, refreshToken}
```

### Implementation details

- Library: `@simplewebauthn/server` on the API
- Browser: `navigator.credentials.create()` / `navigator.credentials.get()`
- iOS: `ASAuthorizationController` with `ASAuthorizationPlatformPublicKeyCredentialProvider` (native Face ID / Touch ID, iOS 16+)

### Replay attack prevention

`sign_count` in `passkey_credentials` is incremented on every authentication. On each login:
1. Verify `sign_count` in the assertion is **greater than** the stored value
2. If equal or lower → reject AND alert (possible cloned credential)

### Environment variables required

```
WEBAUTHN_RP_ID=lexis.app
WEBAUTHN_RP_ORIGIN=https://lexis.app
```

For local dev: `WEBAUTHN_RP_ID=localhost`, `WEBAUTHN_RP_ORIGIN=http://localhost:3001`

---

## Path 2 — Magic link OTP

```
POST /v1/auth/magic/request
  Body: {email}
  → Generates 6-digit code (zero-padded)
  → SET otp:{email} {code} EX 600  (10 minutes)
  → Sends email via Resend
  Response: {message: 'Code sent'}

POST /v1/auth/magic/verify
  Body: {email, code}
  → Validates code from Redis
  → DEL otp:{email}  (single use — consume immediately)
  → Issues JWT pair
  Response: {accessToken, refreshToken}
```

**OTP format:** exactly 6 numeric digits, zero-padded (e.g. `"042819"`).

**Fallback:** if a user has no passkey registered, OTP is the only available path. OTP is always available regardless of passkey status.

---

## JWT pair

### Access token (short-lived)

```typescript
{
  sub: userId,
  tenantId: string,
  role: 'teacher' | 'student' | 'system',
  exp: now + 15min
}
```

### Refresh token (long-lived)

```typescript
{
  sub: userId,
  jti: uuid,   // unique token ID, stored as Redis key
  exp: now + 30d
}
```

Stored in Redis: `SET refresh:{jti} {userId} EX 2592000`

### Token operations

```
POST /v1/auth/refresh
  Body: {refreshToken}
  → Validates jti in Redis
  → DEL old key, issues new pair (rotation)
  Response: {accessToken, refreshToken}

POST /v1/auth/logout
  Body: {refreshToken}
  → DEL refresh:{jti}
  Response: {ok: true}
```

### Reuse detection

If a refresh token whose Redis key has already been deleted is presented again:
1. This indicates possible token theft
2. Invalidate ALL refresh tokens for that user (scan and delete all `refresh:*` keys for userId)
3. Return 401 — user must re-authenticate

---

## Fastify authenticate hook

Applied to every protected route:

```typescript
fastify.addHook('preHandler', authenticate)
```

The hook:
1. Reads `Authorization: Bearer {token}` header
2. Verifies signature and expiry
3. Attaches `req.user = { userId, tenantId, role }` to the request
4. Sets AsyncLocalStorage context for Prisma middleware
5. Throws 401 with appropriate error code on any failure

**Rule:** never trust `tenantId` from request body or query params. Always use `req.user.tenantId`.

---

## Tenant auto-creation on teacher registration

When a teacher registers for the first time (either auth path):

1. Check if `users` row exists for this email
2. If not: create `users` row with `role = 'teacher'`
3. Create `tenants` row with `name = email prefix, slug = nanoid()`
4. Create `subscriptions` row with `plan_slug = 'free', student_limit = 3, lesson_plan_limit = 5, ai_credits_remaining = 0, feature_flags = {ai: false, ...}`
5. Set `users.tenant_id = tenants.id`
6. Issue JWT pair with `tenantId` set

Students **do not** create tenants. Students are enrolled by teachers via `POST /v1/classrooms/:id/enroll`.

---

## Consent

Required before profile creation. Called once during onboarding:

```
POST /v1/auth/consent
  Body: {policyVersion: '1.0'}
  → Creates consent_records row
  Response: {consented: true}
```

If a user has no consent record, the onboarding middleware redirects to the consent screen. No API calls succeed (except the consent endpoint itself) until consent is recorded.

---

## Passkey management

Users can register multiple passkeys (phone + laptop + tablet):

```
GET    /v1/auth/passkeys        → list user's registered passkeys
DELETE /v1/auth/passkeys/:id    → remove a passkey
```

**Guard on delete:** cannot delete the last passkey if the user has no verified email for OTP fallback. Always leave at least one auth method.

---

## GDPR — Account deletion

```
DELETE /v1/users/me
  → Sets users.deleted_at = now()
  → Cascades soft-delete to all user-owned data
  → Deletes all refresh tokens from Redis (scan all refresh:* for this userId)
  Response: {deleted: true, effectiveAt: timestamp}
```

Data is retained for 30 days before hard deletion. A BullMQ nightly job sweeps `users WHERE deleted_at < now() - 30 days` and hard-deletes them along with all cascaded data.

---

## Error codes

| Code | Meaning |
|---|---|
| `auth/invalid_token` | Token fails signature verification |
| `auth/expired_token` | Token is past expiry |
| `auth/missing_token` | No Authorization header |
| `auth/invalid_otp` | OTP wrong, not found, or expired |
