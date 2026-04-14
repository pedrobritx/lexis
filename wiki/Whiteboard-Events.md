# Whiteboard Events

Complete Socket.IO event contract for the whiteboard. Phase 2 events are the base set. Phase 3 events extend them.

**Direction notation:**
- `C→S` — client to server
- `S→C` — server to all room members
- `C→S→C` — client sends, server validates and broadcasts to all
- `Teacher→S→S` — teacher sends, server broadcasts to students only
- `Teacher→S→All` — teacher sends, server broadcasts to everyone
- `Student→S→T` — student sends, server forwards to teacher only

---

## Phase 2 Events

### Board lifecycle

| Event | Direction | Payload | Notes |
|---|---|---|---|
| `board:join` | C→S | `{pageId, token, lastSeq?}` | Auth + join room. Server verifies tenant owns page. |
| `board:state` | S→C | `{objects[], presences[]}` | Full board state. Sent only to the joining client. |

### Strokes

| Event | Direction | Payload | Notes |
|---|---|---|---|
| `stroke:delta` | C→S→C | `{strokeId, points[], tool, color, width}` | Incremental stroke points. Server appends to Redis buffer. |
| `stroke:end` | C→S→C | `{strokeId}` | Stroke complete — signals end of this stroke ID. |
| `stroke:erase` | C→S→C | `{boundingBox: {x,y,w,h}}` | Remove all strokes intersecting the bounding box. |

### Objects

All object mutations are persisted to PostgreSQL (`board_objects`) by the server.

| Event | Direction | Payload | Notes |
|---|---|---|---|
| `object:create` | C→S→C | `{object: BoardObject}` | New object. Server persists. |
| `object:update` | C→S→C | `{id, delta: Partial<BoardObject>}` | Move/resize/edit. Server updates. |
| `object:delete` | C→S→C | `{id}` | Soft-delete (`deleted_at = now()`). |

### Presence and cursors

| Event | Direction | Payload | Notes |
|---|---|---|---|
| `cursor:move` | C→S→C | `{x, y, userId}` | Live cursor position. **Never persisted.** |
| `presence:update` | C→S→C | `{userId, status, tool}` | Online presence. Redis TTL 5s — must refresh every ~3s. |

### Follow mode

| Event | Direction | Payload | Notes |
|---|---|---|---|
| `follow:start` | Teacher→S→S | `{viewport: {x,y,zoom}}` | Teacher activates follow mode. All students lock to teacher viewport. |
| `follow:viewport` | Teacher→S→S | `{x, y, zoom}` | Continuous viewport sync. Throttled to 30fps. |
| `follow:end` | Teacher→S→S | `{}` | Follow mode deactivated. Students can scroll freely. |
| `follow:break` | Student→S→T | `{}` | Student breaks free. Increments `follow_sessions.breaks_count`. |

### Laser pointer

| Event | Direction | Payload | Notes |
|---|---|---|---|
| `laser:move` | Teacher→S→C | `{x, y}` | Laser pointer position. **Ephemeral. Never stored.** |
| `laser:end` | Teacher→S→C | `{}` | Laser hidden. |

---

## Phase 3 Events

These events are added on top of the Phase 2 set.

### Object locking

| Event | Direction | Payload | Notes |
|---|---|---|---|
| `object:lock` | C→S | `{objectId}` | Request edit lock. |
| `object:locked` | S→All | `{objectId, lockedBy, userName, color}` | Lock granted. Broadcast to all room members. |
| `object:lock_rejected` | S→C | `{objectId, lockedBy}` | Lock denied — another user holds it. Sent only to requester. |
| `object:lock_keepalive` | C→S | `{objectId}` | Reset 30s lock TTL. Rate-limited to 1 per 3s. |
| `object:unlock` | C→S→All | `{objectId, delta?}` | Release lock with optional committed state delta. |
| `object:force_unlock` | Teacher→S→All | `{objectId}` | Break stale lock. Teacher role required. |

### Undo/redo

| Event | Direction | Payload | Notes |
|---|---|---|---|
| `board:undo` | C→S→All | `{pageId}` | Reverse latest active command for the requesting user. |
| `board:redo` | C→S→All | `{pageId}` | Re-apply latest undone command for the requesting user. |
| `board:undo_empty` | S→C | `{}` | No commands to undo. Sent only to requester. |

### Overlay

| Event | Direction | Payload | Notes |
|---|---|---|---|
| `overlay:open` | C→S→All | `{objectId, pageNum?}` | Open fullscreen overlay for PDF or activity object. |
| `overlay:close` | C→S→All | `{objectId}` | Close overlay — all clients return to main canvas. |

### PDF and annotations

| Event | Direction | Payload | Notes |
|---|---|---|---|
| `pdf:push_page` | Teacher→S→All | `{objectId, pageNum}` | Force all clients to jump to a specific PDF page. |
| `annotation:stroke:delta` | C→S→All | `{objectId, pageNum, points[], tool, color}` | Freehand annotation over PDF/activity. Points in PDF-space (0–1 normalised). |

---

## Sequence numbers

Every broadcast event is stamped with a `seq` integer by the server:

```typescript
const seq = await redis.incr(`seq:${pageId}`)
io.to(pageId).emit(event, { ...payload, seq })
```

Clients store the last received `seq` and pass it as `lastSeq` in `board:join` on reconnect.

See [[Sequence-Numbers-and-Reconnect]] for the full reconnect flow.

---

## Error events

The server may emit these error events to a specific client:

| Event | Payload | Meaning |
|---|---|---|
| `error:locked` | `{objectId, lockedBy}` | Update rejected — object is locked |
| `error:permission` | `{code}` | Operation not permitted for your role |
| `error:not_found` | `{objectId}` | Object does not exist in this page |
