# Critical Test Cases

These test cases **must exist** and pass. They cover the highest-risk paths in the system.

---

## Auth module (90% coverage required)

### OTP lifecycle

```typescript
it('issues JWT when OTP is correct', async () => {
  await request(app).post('/v1/auth/magic/request').send({ email: 'test@example.com' })
  const code = await redis.get('otp:test@example.com')
  const res = await request(app).post('/v1/auth/magic/verify').send({ email: 'test@example.com', code })
  expect(res.status).toBe(200)
  expect(res.body.data.accessToken).toBeDefined()
})

it('returns 401 for wrong OTP code', async () => {
  await request(app).post('/v1/auth/magic/request').send({ email: 'test@example.com' })
  const res = await request(app).post('/v1/auth/magic/verify').send({ email: 'test@example.com', code: '000000' })
  expect(res.status).toBe(401)
  expect(res.body.error.code).toBe('auth/invalid_otp')
})

it('returns 401 for expired OTP', async () => {
  await redis.set('otp:test@example.com', '123456', 'EX', 1)  // 1 second TTL
  await sleep(1100)
  const res = await request(app).post('/v1/auth/magic/verify').send({ email: 'test@example.com', code: '123456' })
  expect(res.status).toBe(401)
})

it('OTP is single-use — second verify fails', async () => {
  // First verify succeeds, second fails
})
```

### JWT security

```typescript
it('rejects tampered JWT', async () => {
  const token = validJwt.slice(0, -5) + 'XXXXX'
  const res = await request(app).get('/v1/users/me').set('Authorization', `Bearer ${token}`)
  expect(res.status).toBe(401)
  expect(res.body.error.code).toBe('auth/invalid_token')
})

it('rejects expired JWT', async () => {
  const expiredToken = signJwt({ sub: userId, tenantId }, { expiresIn: '-1s' })
  const res = await request(app).get('/v1/users/me').set('Authorization', `Bearer ${expiredToken}`)
  expect(res.status).toBe(401)
  expect(res.body.error.code).toBe('auth/expired_token')
})
```

### Refresh token rotation and reuse detection

```typescript
it('rotates refresh token on use', async () => {
  const { refreshToken } = await loginAsTeacher()
  const res = await request(app).post('/v1/auth/refresh').send({ refreshToken })
  expect(res.body.data.refreshToken).not.toBe(refreshToken)
  // Old token is gone from Redis
  const old = await redis.get(`refresh:${extractJti(refreshToken)}`)
  expect(old).toBeNull()
})

it('invalidates all tokens on refresh token reuse', async () => {
  const { refreshToken } = await loginAsTeacher()
  await request(app).post('/v1/auth/refresh').send({ refreshToken }) // consume it
  const res = await request(app).post('/v1/auth/refresh').send({ refreshToken }) // reuse
  expect(res.status).toBe(401)
  // All tokens for this user should now be gone
})
```

### Cross-tenant isolation

```typescript
it('never returns another tenant\'s data', async () => {
  const { tenantId: tenantA, authHeader: headerA } = await createTestTenant()
  const { tenantId: tenantB } = await createTestTenant()
  const courseB = await createCourse(tenantB)

  const res = await request(app)
    .get(`/v1/courses/${courseB.id}`)
    .set('Authorization', headerA)

  expect(res.status).toBe(404) // Appears not found — not forbidden — to avoid information leak
})
```

### Tenant auto-creation

```typescript
it('creates tenant and free subscription on first teacher registration', async () => {
  const res = await request(app).post('/v1/auth/magic/verify').send({ email: 'new@teacher.com', code: validCode })
  const user = await prisma.user.findUnique({ where: { email: 'new@teacher.com' } })
  expect(user.tenant_id).not.toBeNull()
  const sub = await prisma.subscription.findUnique({ where: { tenant_id: user.tenant_id } })
  expect(sub.plan_slug).toBe('free')
  expect(sub.student_limit).toBe(3)
})
```

---

## Billing module (90% coverage required)

```typescript
it('returns 402 on 4th student enrollment (free plan)', async () => {
  // Enroll 3 students successfully
  await enroll(tenantId, classroomId, students[0])
  await enroll(tenantId, classroomId, students[1])
  await enroll(tenantId, classroomId, students[2])

  // 4th enrollment should fail
  const res = await request(app)
    .post(`/v1/classrooms/${classroomId}/enroll`)
    .set('Authorization', teacherAuth)
    .send({ studentId: students[3].id })

  expect(res.status).toBe(402)
  expect(res.body.error.code).toBe('billing/limit_reached')
  expect(res.body.error.details.limit).toBe(3)
})

it('returns 402 on 6th course creation (free plan)', async () => {
  // Create 5 courses
  for (let i = 0; i < 5; i++) await createCourse(tenantId)

  const res = await request(app)
    .post('/v1/courses')
    .set('Authorization', teacherAuth)
    .send({ title: '6th course', ... })

  expect(res.status).toBe(402)
})

it('pro plan allows unlimited students', async () => {
  await upgradeToPro(tenantId)
  for (let i = 0; i < 20; i++) {
    const res = await enroll(tenantId, classroomId, students[i])
    expect(res.status).toBe(201)
  }
})

it('Stripe webhook is idempotent (same event twice)', async () => {
  const eventId = 'evt_test_123'
  await processStripeWebhook(eventId)
  const sub1 = await getSubscription(tenantId)

  await processStripeWebhook(eventId) // Same event again
  const sub2 = await getSubscription(tenantId)

  // Subscription unchanged (not double-upgraded)
  expect(sub1.plan_slug).toBe(sub2.plan_slug)
  expect(sub1.ai_credits_remaining).toBe(sub2.ai_credits_remaining)
})

it('decrements AI credits atomically', async () => {
  await setAiCredits(tenantId, 1)
  const concurrent = [decrementAiCredit(tenantId), decrementAiCredit(tenantId)]
  const results = await Promise.allSettled(concurrent)
  const successes = results.filter(r => r.status === 'fulfilled').length
  const failures = results.filter(r => r.status === 'rejected').length
  expect(successes).toBe(1)  // Only one succeeds
  expect(failures).toBe(1)   // One gets InsufficientCreditsError
})
```

---

## SRS module (90% coverage required)

```typescript
it('10-review SM-2 sequence matches expected values', () => {
  const qualities = [4, 4, 5, 3, 4, 5, 5, 2, 4, 5]
  let item = createDefaultSrsItem()

  for (const quality of qualities) {
    item = updateSrsItem(item, quality)
  }

  // Assert final interval and ease_factor within expected range
  expect(item.ease_factor).toBeGreaterThanOrEqual(1.3)
  expect(item.ease_factor).toBeLessThanOrEqual(2.5)
  expect(item.interval_days).toBeGreaterThan(1)
})

it('ease_factor never goes below 1.3', () => {
  let item = createDefaultSrsItem()
  // Feed 20 quality=0 ratings
  for (let i = 0; i < 20; i++) {
    item = updateSrsItem(item, 0)
  }
  expect(item.ease_factor).toBe(1.3)
})

it('ease_factor never goes above 2.5', () => {
  let item = { ...createDefaultSrsItem(), ease_factor: 2.4 }
  item = updateSrsItem(item, 5) // Best rating
  expect(item.ease_factor).toBeLessThanOrEqual(2.5)
})

it('stale content version resets interval to 1', async () => {
  const item = await createSrsItemAtVersion(activityId, 1)
  await bumpActivityVersion(activityId) // Now version = 2

  const queue = await getSrsQueue(studentId)
  const updatedItem = queue.find(i => i.activity_id === activityId)

  expect(updatedItem.interval_days).toBe(1)
  expect(updatedItem.content_changed).toBe(true)
})
```

---

## Prisma middleware (90% coverage required)

```typescript
it('findMany appends tenant_id filter', async () => {
  setTenantContext({ tenantId: 'tenant-a' })
  const courses = await prisma.course.findMany()
  // All results should have tenant_id = 'tenant-a'
  courses.forEach(c => expect(c.tenant_id).toBe('tenant-a'))
})

it('public_template courses bypass tenant filter', async () => {
  const template = await createPublicTemplate() // visibility = 'public_template'
  setTenantContext({ tenantId: 'tenant-b' }) // Different tenant
  const courses = await prisma.course.findMany({
    where: { visibility: 'public_template' }
  })
  expect(courses.find(c => c.id === template.id)).toBeDefined()
})

it('throws MissingTenantContextError when no context set', async () => {
  clearTenantContext()
  await expect(prisma.course.findMany()).rejects.toThrow(MissingTenantContextError)
})

it('findMany excludes soft-deleted records', async () => {
  const course = await prisma.course.create({ data: { ... } })
  await softDelete('course', course.id)

  const courses = await prisma.course.findMany()
  expect(courses.find(c => c.id === course.id)).toBeUndefined()
})
```
