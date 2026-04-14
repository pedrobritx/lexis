# Lock and Undo

Phase 3 features for collaborative editing safety.

---

## Object lock system

### Purpose

Prevents two users from simultaneously editing the same object, which would cause conflicting updates.

### Lock acquisition

```typescript
socket.on('object:lock', async ({ objectId }) => {
  const existing = await redis.get(`lock:${objectId}`)

  if (existing) {
    // Object already locked by someone else
    socket.emit('object:lock_rejected', {
      objectId,
      lockedBy: JSON.parse(existing).userId
    })
    return
  }

  // Grant the lock
  const lockData = {
    userId: socket.data.userId,
    userName: socket.data.userName,
    color: socket.data.color  // Per-user color for lock indicator
  }
  await redis.set(`lock:${objectId}`, JSON.stringify(lockData), 'EX', 30)

  io.to(pageId).emit('object:locked', {
    objectId,
    lockedBy: socket.data.userId,
    userName: lockData.userName,
    color: lockData.color
  })
})
```

### Lock TTL and keepalive

- Lock TTL: **30 seconds**
- Clients must send `object:lock_keepalive` every ~10s to prevent expiry
- Keepalive is rate-limited to 1 per 3 seconds server-side

```typescript
socket.on('object:lock_keepalive', async ({ objectId }) => {
  const lock = await redis.get(`lock:${objectId}`)
  if (lock && JSON.parse(lock).userId === socket.data.userId) {
    await redis.expire(`lock:${objectId}`, 30)
  }
})
```

### Lock enforcement

On `object:update` and `object:delete`, the server checks for a lock:

```typescript
const lock = await redis.get(`lock:${objectId}`)
if (lock && JSON.parse(lock).userId !== socket.data.userId) {
  socket.emit('error:locked', { objectId, lockedBy: JSON.parse(lock).userId })
  return
}
```

**Exception:** text editing inside a locked text box is still permitted. The lock prevents position/size changes only.

### Auto-release on disconnect

```typescript
socket.on('disconnect', async () => {
  // Scan all lock:* keys, delete those owned by this socket's userId
  const keys = await redis.keys('lock:*')
  for (const key of keys) {
    const lock = await redis.get(key)
    if (lock && JSON.parse(lock).userId === socket.data.userId) {
      const objectId = key.replace('lock:', '')
      await redis.del(key)
      io.to(pageId).emit('object:unlocked', { objectId })
    }
  }
})
```

### Teacher force-unlock

```typescript
socket.on('object:force_unlock', async ({ objectId }) => {
  if (socket.data.role !== 'teacher') {
    socket.emit('error:permission', { code: 'permission/role_required' })
    return
  }
  await redis.del(`lock:${objectId}`)
  io.to(pageId).emit('object:unlocked', { objectId })
})
```

---

## Shared undo/redo

### Board commands table

Every mutation writes a `board_commands` row:

```typescript
interface BoardCommand {
  page_id: string
  author_id: string
  sequence_num: bigint        // INCR Redis seq:{pageId} — monotonic
  command_type: CommandType
  forward_payload: object     // The state that was applied
  reverse_payload: object     // The state that undoes it
  undone_at: timestamp | null // null = active, set = undone
}
```

### Reverse payload construction

| Command type | `forward_payload` | `reverse_payload` |
|---|---|---|
| `object_create` | Full object snapshot | `{type: 'object_delete', id}` |
| `object_delete` | `{id}` | `{type: 'object_create', object: fullSnapshot}` |
| `object_update` | `{id, delta: newState}` | `{type: 'object_update', id, delta: previousState}` |
| `stroke_add` | `{strokeId, points[]}` | `{type: 'stroke_hide', strokeId}` |
| `stroke_erase` | `{boundingBox}` | `{type: 'stroke_restore', strokeIds[]}` |

### Undo flow

```typescript
socket.on('board:undo', async ({ pageId }) => {
  // Find the most recent non-undone command for this user on this page
  const command = await prisma.boardCommand.findFirst({
    where: {
      page_id: pageId,
      author_id: socket.data.userId,
      undone_at: null
    },
    orderBy: { sequence_num: 'desc' }
  })

  if (!command) {
    socket.emit('board:undo_empty', {})
    return
  }

  // Apply the reverse payload
  await applyCommand(pageId, command.reverse_payload)
  await prisma.boardCommand.update({
    where: { id: command.id },
    data: { undone_at: new Date() }
  })

  // Broadcast the reverse operation to all room members
  io.to(pageId).emit(command.reverse_payload.type, {
    ...command.reverse_payload,
    seq: await redis.incr(`seq:${pageId}`)
  })
})
```

### Stroke undo via hidden set

Stroke undo cannot update the binary stroke buffer in-place. Instead:

```typescript
// On stroke_add undo:
await redis.sadd(`hidden_strokes:${pageId}`, strokeId)
// Client filters hidden IDs when rendering strokes
// On R2 flush: excluded from binary output
```

### History cap

500 commands per page. When this limit is exceeded, the oldest command is pruned:

```typescript
const count = await prisma.boardCommand.count({ where: { page_id: pageId } })
if (count > 500) {
  await prisma.boardCommand.deleteMany({
    where: { page_id: pageId },
    orderBy: { sequence_num: 'asc' },
    take: count - 500
  })
}
```
