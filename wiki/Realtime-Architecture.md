# Realtime Architecture

---

## Overview

The realtime server (`apps/realtime`) is a **separate process** from the REST API. It runs on Railway alongside `apps/api` but has its own deployment, its own Railway service, and its own port (4000).

**Critical rule:** the RT server and API server never call each other directly. They communicate exclusively via Redis pub/sub.

---

## Service topology

```
Client (browser/iOS)
    │
    └── WSS ──► rt.lexis.app:4000 (Socket.IO)
                      │
                      ├── Redis pub/sub ──► apps/api (for state sync)
                      ├── PostgreSQL (direct write for board_objects)
                      └── Cloudflare R2 (stroke flush)
```

---

## JWT authentication

Every Socket.IO connection must authenticate before joining any room:

```typescript
io.use(async (socket, next) => {
  const token = socket.handshake.auth.token
  if (!token) return next(new Error('auth:required'))

  try {
    const payload = verifyAccessToken(token)
    socket.data.userId = payload.sub
    socket.data.tenantId = payload.tenantId
    socket.data.role = payload.role
    next()
  } catch {
    next(new Error('auth:invalid'))
  }
})
```

The same `verifyAccessToken` function used in the API's `authenticate` hook — from `packages/types` or a shared `packages/auth-utils`.

---

## Room model

One Socket.IO room per `board_page_id`. Clients join via the `board:join` event:

```typescript
socket.on('board:join', async ({ pageId, token, lastSeq }) => {
  // 1. Verify tenant owns this page
  const page = await prisma.boardPage.findFirst({
    where: { id: pageId, tenant_id: socket.data.tenantId }
  })
  if (!page) return socket.emit('error', { code: 'resource/not_found' })

  // 2. Join the room
  socket.join(pageId)

  // 3. Send full board state (objects + presences) — to joining client only
  const objects = await prisma.boardObject.findMany({
    where: { page_id: pageId, deleted_at: null }
  })
  socket.emit('board:state', { objects, presences: [] })
})
```

---

## Redis pub/sub channels

The RT server publishes to and subscribes from these channels:

| Channel | Direction | Purpose |
|---|---|---|
| `rt:board:{pageId}:broadcast` | RT → subscribe | Forward to all room members |
| `api:session:start` | API → RT | Session created, prepare board |
| `api:session:end` | API → RT | Force-flush strokes, cleanup |

---

## Graceful shutdown

The RT server handles `SIGTERM` from Railway's rolling deploy:

```typescript
process.on('SIGTERM', async () => {
  logger.info('SIGTERM received — starting graceful shutdown')

  // 1. Stop accepting new connections
  io.close()

  // 2. Force-flush all active stroke buffers to R2
  await flushAllActiveBoards()

  // 3. Release all locks owned by currently connected sockets
  await releaseAllLocks()

  // 4. Wait for in-flight events (max 25s)
  await new Promise(r => setTimeout(r, 25000))

  process.exit(0)
})
```

Railway's `shutdownDelay = 30` in `apps/realtime/railway.toml` gives 30 seconds before force-kill — enough for the 25s wait plus cleanup.

---

## DNS requirement

`rt.lexis.app` **must** be configured as DNS-only (grey cloud) in Cloudflare. WebSocket connections cannot be proxied through Cloudflare's reverse proxy on the free/pro plan — they will be dropped after 100 seconds.

See [[Infrastructure]] for the full DNS table.

---

## Local development

```bash
# Start RT server locally
pnpm --filter realtime dev

# Server starts on localhost:4000
# Connect client with:
# io('http://localhost:4000', { auth: { token: accessToken } })
```

The local RT server connects to `localhost:6379` (Docker Redis). All test events are logged to stdout via pino.

---

## Load test target

- 20 concurrent boards, 2 users each = 40 concurrent connections
- 400 events/second total throughput
- p99 broadcast latency < 100ms on WiFi
- p99 broadcast latency < 300ms on LTE

Run: `pnpm test:load` (Artillery — not a CI gate, run weekly).
