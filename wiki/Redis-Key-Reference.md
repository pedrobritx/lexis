# Redis Key Reference

All Redis-only data structures used by Lexis. None of these have a PostgreSQL equivalent — they live exclusively in Redis (Upstash).

---

## Summary table

| Key pattern | Type | TTL | Contents |
|---|---|---|---|
| `refresh:{jti}` | string | 30 days | `userId` |
| `otp:{email}` | string | 10 min | 6-digit code |
| `lock:{objectId}` | string | 30s | JSON `{userId, userName, color}` |
| `strokes:{pageId}:buffer` | list | session | Stroke delta events |
| `replay:{pageId}` | list | 5 min | Last 500 RT events |
| `seq:{pageId}` | int | permanent | Monotonic sequence counter |
| `presence:{pageId}` | hash | 5s (per field) | `{userId: presenceData}` |
| `hidden_strokes:{pageId}` | set | session | Stroke IDs excluded from flush |
| `analytics:{type}:{id}` | string | 1 hr | Cached analytics JSON |
| `metrics:{socketId}` | hash | session | Connection health data |

---

## Auth keys

### `refresh:{jti}`
- **Type:** string
- **TTL:** 2,592,000s (30 days)
- **Value:** userId string
- **Set:** `SET refresh:{jti} {userId} EX 2592000` on token issuance
- **Consumed:** `DEL refresh:{jti}` on token use (rotation) or logout
- **Reuse detection:** if a consumed token is presented, the key will be missing → invalidate ALL tokens for that user

### `otp:{email}`
- **Type:** string
- **TTL:** 600s (10 minutes)
- **Value:** 6-digit zero-padded numeric code e.g. `"042819"`
- **Set:** `SET otp:{email} {code} EX 600` on magic link request
- **Consumed:** `DEL otp:{email}` on successful verify (single use)

---

## Realtime keys

### `lock:{objectId}`
- **Type:** string
- **TTL:** 30s (reset on keepalive)
- **Value:** `JSON.stringify({userId, userName, color})`
- **Set:** when `object:lock` event granted
- **Cleared:** `DEL` on `object:unlock`, `object:force_unlock`, or socket disconnect scan
- **Keepalive:** `EXPIRE lock:{objectId} 30` on `object:lock_keepalive` (rate-limited to 1/3s)

### `strokes:{pageId}:buffer`
- **Type:** list (LPUSH/LRANGE)
- **TTL:** session-lived (no explicit TTL — cleared on flush)
- **Value:** serialised stroke delta events
- **Flushed:** every 60s by BullMQ cron job → MessagePack binary → R2
- **Force-flushed:** on session end

### `replay:{pageId}`
- **Type:** list (LPUSH + LTRIM)
- **TTL:** 300s (5 minutes), refreshed on each push
- **Value:** `JSON.stringify({seq, event, payload})` — last 500 events
- **Used for:** reconnect replay (`lastSeq` provided by client)
- **Populated by:** every broadcast event in the RT server

### `seq:{pageId}`
- **Type:** integer (INCR)
- **TTL:** no TTL (permanent while server is running)
- **Value:** monotonically increasing integer
- **Used for:** stamping every broadcast with a sequence number
- **Reset:** on server restart (clients that reconnect with a `lastSeq` older than the buffer get a full `board:state`)

### `presence:{pageId}`
- **Type:** hash (HSET per userId)
- **TTL:** 5s per field — clients must refresh via `presence:update` every ~3s
- **Value:** `{status, tool, userId, color}` per user
- **Used for:** showing who is on the board and what tool they're using

### `hidden_strokes:{pageId}`
- **Type:** set (SADD)
- **TTL:** session-lived
- **Value:** set of strokeIds that have been undone
- **Used for:** stroke undo — clients filter hidden IDs when rendering; flush job excludes them from binary

---

## Analytics keys

### `analytics:{type}:{id}`
- **Type:** string (JSON)
- **TTL:** 3,600s (1 hour)
- **Value:** serialised analytics response (progress, heatmap, etc.)
- **Populated by:** analytics endpoints on first request (cache-aside)
- **Invalidated by:** nightly jobs that recompute error patterns

---

## Connection health keys

### `metrics:{socketId}`
- **Type:** hash
- **TTL:** session-lived
- **Value:** `{latency_ms, last_ping, connected_at}`
- **Used for:** connection health indicator displayed in whiteboard HUD

---

## Operational notes

- **Redis is not backed up.** All data stored here is either ephemeral (OTP, presence, replay) or reconstructible from PostgreSQL (refresh tokens → users re-authenticate, stroke buffer → 60s gap at worst).
- **Upstash:** serverless Redis. Connection string uses `REDIS_URL` env var. The `packages/cache` wrapper handles TLS and reconnection.
- **Local dev:** Redis runs on `localhost:6379` via Docker Compose.
- **Test isolation:** integration tests use a separate Redis on port `6380` (see `docker-compose.test.yml`).
