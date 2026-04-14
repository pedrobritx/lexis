# Stroke Persistence

Whiteboard strokes are buffered in Redis and flushed to Cloudflare R2 every 60 seconds.

---

## Why buffering?

Persisting every stroke delta to PostgreSQL or R2 directly would be too expensive at whiteboard frame rates. Instead:

1. Stroke deltas are appended to a Redis list in real-time
2. A BullMQ job flushes the buffer to R2 as a MessagePack binary blob every 60 seconds
3. `board_strokes.strokes_url` points to the latest flushed binary

---

## Redis buffer

Key: `strokes:{pageId}:buffer`  
Type: Redis list (LPUSH)  
TTL: no explicit TTL — cleared on flush

```typescript
// On stroke:delta received:
await redis.lpush(`strokes:${pageId}:buffer`, JSON.stringify({
  strokeId,
  points,
  tool,
  color,
  width,
  userId: socket.data.userId,
  timestamp: Date.now()
}))
```

---

## BullMQ flush job

Runs every **60 seconds** per active board page. Triggered by a repeatable BullMQ job:

```typescript
async function flushBoardStrokes(pageId: string) {
  // 1. Read all events from the Redis buffer
  const rawEvents = await redis.lrange(`strokes:${pageId}:buffer`, 0, -1)
  if (rawEvents.length === 0) return

  // 2. Parse events
  const events = rawEvents.map(e => JSON.parse(e))

  // 3. Filter out hidden (undone) strokes
  const hiddenIds = await redis.smembers(`hidden_strokes:${pageId}`)
  const visibleStrokes = events.filter(e => !hiddenIds.has(e.strokeId))

  // 4. Serialise to MessagePack binary
  const binary = encode(visibleStrokes)  // msgpack5 or @msgpack/msgpack

  // 5. Upload to R2
  const key = `strokes/${pageId}/${Date.now()}.bin`
  await r2.send(new PutObjectCommand({
    Bucket: process.env.R2_BUCKET,
    Key: key,
    Body: binary,
    ContentType: 'application/octet-stream'
  }))

  // 6. Update board_strokes record
  await prisma.boardStroke.upsert({
    where: { page_id: pageId },
    create: { page_id: pageId, strokes_url: `https://media.lexis.app/${key}`, last_flushed_at: new Date() },
    update: { strokes_url: `https://media.lexis.app/${key}`, last_flushed_at: new Date() }
  })

  // 7. Clear the Redis buffer
  await redis.del(`strokes:${pageId}:buffer`)
}
```

---

## Force-flush on session end

When `session:end` is received (either via API or RT event), the board is immediately flushed without waiting for the 60s cron:

```typescript
socket.on('session:end', async ({ sessionId }) => {
  const pages = await prisma.boardPage.findMany({ where: { session_id: sessionId } })
  await Promise.all(pages.map(p => flushBoardStrokes(p.id)))
})
```

Also triggered during graceful shutdown (SIGTERM handling) — see [[Realtime-Architecture]].

---

## R2 key structure

```
strokes/{pageId}/{timestamp}.bin
```

Each flush creates a new file with a timestamp suffix. Only `board_strokes.strokes_url` is kept current — historical flush files are not retained (no versioning needed for strokes).

---

## Loading strokes on board:join

When a client joins a board that has existing strokes:

```typescript
socket.on('board:join', async ({ pageId }) => {
  // 1. Get persisted strokes URL
  const strokeRecord = await prisma.boardStroke.findUnique({ where: { page_id: pageId } })

  // 2. Get live buffer events
  const buffer = await redis.lrange(`strokes:${pageId}:buffer`, 0, -1)

  // 3. Send both to the client:
  // - strokesUrl: client fetches and renders the binary blob
  // - bufferEvents: apply on top of the blob (live delta since last flush)
  socket.emit('board:state', {
    objects,
    presences,
    strokesUrl: strokeRecord?.strokes_url ?? null,
    bufferEvents: buffer.map(e => JSON.parse(e))
  })
})
```

---

## Stroke rendering on client

The client renders strokes in two layers:
1. **Persisted layer:** fetch the R2 binary, decode MessagePack, render to canvas
2. **Buffer layer:** apply live delta events on top in chronological order
3. **Hidden filter:** exclude any strokeId in the local `hidden_strokes` set

On reconnect, the client re-fetches the binary if `strokes_url` has changed since its last join.
