# Real-time (Socket.IO)

## Architecture

The RT server (`apps/realtime`) is a **separate process** from the API. They communicate only via Redis pub/sub. Never import API modules into the RT server.

```
Client → socket.io-client → apps/realtime (port 4000)
                                   ↕ Redis pub/sub
                              apps/api (port 3000)
```

**Room model:** one Socket.IO room per `board_page_id`. Clients join via `board:join`.

## JWT authentication

Every Socket.IO connection must authenticate:

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

## Complete event contract

### Phase 2 events

| Event | Direction | Payload | Purpose |
|---|---|---|---|
| `board:join` | C→S | `{pageId, token, lastSeq?}` | Auth + join room. Server verifies tenant owns page. |
| `board:state` | S→C | `{objects[], presences[]}` | Full board state on join — sent only to joining client. |
| `stroke:delta` | C→S→C | `{strokeId, points[], tool, color, width}` | Incremental stroke. Server appends to Redis buffer. |
| `stroke:end` | C→S→C | `{strokeId}` | Stroke complete. |
| `stroke:erase` | C→S→C | `{boundingBox}` | Remove strokes intersecting box. |
| `object:create` | C→S→C | `{object: BoardObject}` | New object. Server persists to PostgreSQL. |
| `object:update` | C→S→C | `{id, delta}` | Move/resize/edit. Server updates PostgreSQL. |
| `object:delete` | C→S→C | `{id}` | Remove. Server soft-deletes. |
| `cursor:move` | C→S→C | `{x, y, userId}` | Live cursor. Never persisted. |
| `follow:start` | Teacher→S→S | `{viewport}` | Teacher activates follow mode. |
| `follow:viewport` | Teacher→S→S | `{x, y, zoom}` | Continuous viewport sync. Throttled to 30fps. |
| `follow:end` | Teacher→S→S | `{}` | Follow mode deactivated. |
| `follow:break` | Student→S→T | `{}` | Student breaks free. Increments breaks_count. |
| `laser:move` | Teacher→S→C | `{x, y}` | Laser pointer. Ephemeral. Never stored. |
| `laser:end` | Teacher→S→C | `{}` | Laser hidden. |
| `presence:update` | C→S→C | `{userId, status, tool}` | Online presence. Redis TTL 5s. |

### Phase 3 events (add on top of Phase 2)

| Event | Direction | Payload | Purpose |
|---|---|---|---|
| `object:lock` | C→S | `{objectId}` | Request edit lock. |
| `object:locked` | S→All | `{objectId, lockedBy, userName, color}` | Lock granted. |
| `object:lock_rejected` | S→C | `{objectId, lockedBy}` | Lock denied. |
| `object:lock_keepalive` | C→S | `{objectId}` | Reset lock TTL. Rate-limited to 1/3s. |
| `object:unlock` | C→S→All | `{objectId, delta?}` | Release with optional committed state. |
| `object:force_unlock` | Teacher→S→All | `{objectId}` | Break stale lock (teacher only). |
| `board:undo` | C→S→All | `{pageId}` | Reverse latest command in log. |
| `board:redo` | C→S→All | `{pageId}` | Re-apply latest undone command. |
| `board:undo_empty` | S→C | `{}` | No commands to undo. |
| `overlay:open` | C→S→All | `{objectId, pageNum?}` | Open fullscreen overlay. |
| `overlay:close` | C→S→All | `{objectId}` | Close overlay. |
| `annotation:stroke:delta` | C→S→All | `{objectId, pageNum, points[], tool, color}` | Annotation over PDF/activity. Points in PDF-space. |
| `pdf:push_page` | Teacher→S→All | `{objectId, pageNum}` | Force all clients to PDF page. |

## Lock system

**Redis key:** `lock:{objectId}` → JSON `{userId, userName, color}` with TTL 30s

```typescript
// On object:lock received:
const existing = await redis.get(`lock:${objectId}`)
if (existing) {
  socket.emit('object:lock_rejected', { objectId, lockedBy: JSON.parse(existing).userId })
  return
}
await redis.set(`lock:${objectId}`, JSON.stringify({userId, userName, color}), 'EX', 30)
io.to(room).emit('object:locked', { objectId, lockedBy: userId, userName, color })

// On object:lock_keepalive:
await redis.expire(`lock:${objectId}`, 30)

// On disconnect:
// Scan all lock:* keys, delete those owned by this socket's userId
// Broadcast object:unlocked for each
```

**Lock enforcement:** on `object:update` and `object:delete`, check Redis for existing lock. If locked by another user, reject with `error:locked`. Locks only prevent position/size changes — text editing inside locked text boxes is still permitted.

## Shared undo/redo

Every mutation writes a `board_commands` row:

```typescript
interface BoardCommand {
  page_id: string
  author_id: string
  sequence_num: bigint        // INCR Redis seq:{pageId}
  command_type: CommandType
  forward_payload: object     // What was applied
  reverse_payload: object     // What reverses it
}

// reverse_payload construction:
// object_create → { type: 'object_delete', id }
// object_delete → { type: 'object_create', object: fullSnapshot }
// object_update → { type: 'object_update', id, delta: previousState }
// stroke_add    → { type: 'stroke_hide', strokeId }
```

**Stroke undo:** adding `strokeId` to Redis set `hidden_strokes:{pageId}`. Clients filter hidden IDs when rendering. On S3 flush, hidden strokes excluded from binary.

**History cap:** 500 commands per page. Prune oldest on overflow.

## Sequence numbers + replay buffer

Every broadcast event is stamped with a `seq` integer:

```typescript
const seq = await redis.incr(`seq:${pageId}`)
await redis.lpush(`replay:${pageId}`, JSON.stringify({seq, event, payload}))
await redis.ltrim(`replay:${pageId}`, 0, 499)   // Keep last 500
await redis.expire(`replay:${pageId}`, 300)      // 5-minute TTL

io.to(room).emit(event, { ...payload, seq })
```

**On reconnect with `lastSeq`:** fetch `replay:{pageId}` list, filter events with `seq > lastSeq`, emit in order to reconnecting client only. If `lastSeq` is older than buffer → emit full `board:state` (same as fresh join).

## Stroke persistence (S3/R2 flush)

BullMQ job every 60 seconds per active board page:
1. Read `strokes:{pageId}:buffer` from Redis
2. Remove hidden stroke IDs (from `hidden_strokes:{pageId}`)
3. Serialise to MessagePack binary
4. Upload to R2 at `strokes/{pageId}/{timestamp}.bin`
5. Update `board_strokes.strokes_url`
6. Clear Redis buffer

On session end (`session:end` event): force-flush immediately, don't wait for cron.

## Graceful shutdown (SIGTERM handling)

```typescript
process.on('SIGTERM', async () => {
  // Stop accepting new connections
  io.close()
  // Force-flush all active stroke buffers
  await flushAllActiveBoards()
  // Wait for in-flight events to complete (max 25s)
  await new Promise(r => setTimeout(r, 25000))
  process.exit(0)
})
```

Railway's `shutdownDelay = 30` in `railway.toml` gives 30 seconds before force-kill.
