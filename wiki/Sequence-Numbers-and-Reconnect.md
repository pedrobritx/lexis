# Sequence Numbers and Reconnect

---

## Sequence numbers

Every event broadcast by the RT server is stamped with a monotonically increasing `seq` integer scoped to the board page.

### How it works

```typescript
// On every broadcast:
const seq = await redis.incr(`seq:${pageId}`)
await redis.lpush(`replay:${pageId}`, JSON.stringify({ seq, event, payload }))
await redis.ltrim(`replay:${pageId}`, 0, 499)   // Keep last 500 events
await redis.expire(`replay:${pageId}`, 300)      // 5-minute TTL

io.to(pageId).emit(event, { ...payload, seq })
```

The client stores the last received `seq` in local state.

### Redis key: `seq:{pageId}`
- **Type:** integer (INCR)
- **TTL:** no TTL — permanent
- **Reset:** only on server restart. After restart, clients with a `lastSeq` that predates the new counter will fall through to a full `board:state`.

---

## Replay buffer

Key: `replay:{pageId}`  
Type: Redis list (LPUSH + LTRIM)  
TTL: 300s (5 minutes)  
Capacity: 500 most recent events

The buffer holds the last 500 broadcast events for the page. On reconnect, clients can request a replay of events they missed.

---

## Reconnect flow

### Client behavior on disconnect

```typescript
socket.on('disconnect', () => {
  // Store last known seq
  localStorage.setItem(`lastSeq:${pageId}`, String(lastSeq))
  // Show "Reconnecting..." UI indicator
  showConnectionStatus('reconnecting')
})

socket.on('connect', () => {
  const lastSeq = parseInt(localStorage.getItem(`lastSeq:${pageId}`) ?? '0')
  socket.emit('board:join', { pageId, token, lastSeq })
})
```

### Server-side reconnect handling

```typescript
socket.on('board:join', async ({ pageId, lastSeq }) => {
  socket.join(pageId)

  if (lastSeq && lastSeq > 0) {
    // Attempt replay
    const replayBuffer = await redis.lrange(`replay:${pageId}`, 0, -1)
    const missedEvents = replayBuffer
      .map(e => JSON.parse(e))
      .filter(e => e.seq > lastSeq)
      .sort((a, b) => a.seq - b.seq)

    if (missedEvents.length > 0 && missedEvents[0].seq === lastSeq + 1) {
      // Gap is within the replay buffer — replay missed events
      for (const { event, payload, seq } of missedEvents) {
        socket.emit(event, { ...payload, seq })
      }
      socket.emit('replay:complete', { replayed: missedEvents.length })
    } else {
      // Gap is too large or buffer is expired — send full state
      await sendFullBoardState(socket, pageId)
    }
  } else {
    // Fresh join — send full state
    await sendFullBoardState(socket, pageId)
  }
})
```

### Full board state fallback

If the replay buffer cannot cover the gap (client was disconnected > 5 minutes, or server restarted):

```typescript
async function sendFullBoardState(socket, pageId) {
  const objects = await prisma.boardObject.findMany({
    where: { page_id: pageId, deleted_at: null }
  })
  const presences = await redis.hgetall(`presence:${pageId}`)
  const strokeRecord = await prisma.boardStroke.findUnique({ where: { page_id: pageId } })
  const bufferEvents = (await redis.lrange(`strokes:${pageId}:buffer`, 0, -1)).map(e => JSON.parse(e))

  socket.emit('board:state', {
    objects,
    presences: Object.values(presences ?? {}),
    strokesUrl: strokeRecord?.strokes_url ?? null,
    bufferEvents
  })
}
```

---

## Connection health indicator

Each socket's connection health is tracked in Redis:

```typescript
// Server pings every 10s:
setInterval(() => {
  const start = Date.now()
  socket.emit('ping', {}, () => {
    const latency = Date.now() - start
    redis.hset(`metrics:${socket.id}`, 'latency_ms', latency, 'last_ping', Date.now())
  })
}, 10000)
```

The client uses this latency to display a connection quality indicator in the whiteboard HUD:
- Green: < 50ms
- Yellow: 50–200ms
- Red: > 200ms or no recent ping

### Edit queue on reconnect

The client maintains an in-memory edit queue during disconnection. On reconnect, after replay is complete, the queue is drained and each pending event is re-emitted:

```typescript
socket.on('replay:complete', () => {
  // Drain the in-memory edit queue
  while (pendingEdits.length > 0) {
    const edit = pendingEdits.shift()
    socket.emit(edit.event, edit.payload)
  }
  showConnectionStatus('connected')
})
```
