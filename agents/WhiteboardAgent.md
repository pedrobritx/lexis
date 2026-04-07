# WhiteboardAgent

You are building the **real-time whiteboard system** for Lexis: the RT server (`apps/realtime/`) and the web canvas UI (`apps/web/src/components/whiteboard/`).

## Before you start

Read in this order — all of them, fully:
1. `docs/realtime.md` — complete Socket.IO event contract, lock system, undo/redo, stroke persistence
2. `docs/schema.md` — board_pages, board_objects, board_strokes, board_commands, pdf_annotations
3. `docs/phases.md` — Phase 2 Weeks 1–2, Phase 3 Weeks 1–3

## What you are building

**Phase 2 (build first):**
- `apps/realtime/` — dedicated Socket.IO server
- Web canvas with all drawing tools, object system, follow mode, laser

**Phase 3 (build after Phase 2 complete):**
- Lock-based conflict resolution
- Shared undo/redo with command log
- Zoom overlay system (5-layer z-stack)
- PDF annotation with PDF-space coordinates

## RT server structure

```
apps/realtime/src/
  server.ts               Socket.IO setup, JWT middleware
  handlers/
    board.handler.ts      board:join, board:state
    stroke.handler.ts     stroke:delta/end/erase + Redis buffer
    object.handler.ts     object:create/update/delete (Phase 2)
                          + lock handlers (Phase 3)
    follow.handler.ts     follow:start/viewport/end/break
    command.handler.ts    board:undo/redo (Phase 3)
    overlay.handler.ts    overlay:open/close, pdf:push_page (Phase 3)
    annotation.handler.ts annotation:stroke:delta (Phase 3)
  workers/
    stroke.flush.ts       BullMQ job: Redis → R2 every 60s
  test/
    locks.test.ts         Lock state machine (Phase 3)
    commands.test.ts      Undo/redo sequences (Phase 3)
    reconnection.test.ts  Replay buffer (Phase 3)
    security.test.ts      Auth + cross-tenant rejection
```

## Canvas web component structure

```
apps/web/src/components/whiteboard/
  WhiteboardCanvas.tsx    Root component, stage management
  layers/
    PatternLayer.tsx       CSS background (blank/dotted/squared)
    StrokeCanvas.tsx       HTML5 Canvas 2D for freehand
    ObjectLayer.tsx        SVG/DOM positioned objects
    OverlayLayer.tsx       Phase 3: PDF/activity fullscreen
    AnnotationCanvas.tsx   Phase 3: annotation strokes over overlay
    HUDLayer.tsx           Always-on-top toolbar
  objects/
    StickyNote.tsx
    TextBox.tsx
    Shape.tsx
    ActivityCard.tsx       Collapsed chip ↔ expanded interactive
    PDFCard.tsx
  tools/
    PenTool.ts             Catmull-Rom spline smoothing
    HighlighterTool.ts     Semi-transparent overlay layer
    EraserTool.ts          Intersecting stroke removal
    ShapeTool.ts
  hooks/
    useSocketBoard.ts      Socket.IO connection + event handling
    useSnapGuides.ts       Magnetic alignment (8px threshold)
    useLockState.ts        Phase 3: lock indicators
```

## Critical implementation details

### Stroke smoothing (Catmull-Rom)
Raw pointer events must be smoothed before rendering. Apply Catmull-Rom spline to the point array before drawing to the canvas. This prevents jagged lines on fast pointer movement.

### Stroke persistence (Redis → R2)
Strokes NEVER go to PostgreSQL. Redis buffer only, flushed to R2 every 60s via BullMQ. On session end: force-flush immediately. See `docs/realtime.md` for the full flush procedure.

### Object persistence
Structured objects (stickies, shapes, activity cards, PDFs) persist to PostgreSQL via the REST API on every `object:create` and `object:update` event. The RT server calls the API service via HTTP after broadcasting.

### Phase 3: 5-layer z-stack
```
z:50 — HUD (drawing tools, always on top, never obscured)
z:40 — Annotation canvas (active when overlay open)
z:30 — Overlay content (PDF.js or activity card)
z:20 — Object layer (stickies, shapes, cards)
z:10 — Stroke canvas
z:0  — Pattern background
```
When overlay opens: set `pointer-events: none` on stroke canvas (z:10), set `pointer-events: all` on annotation canvas (z:40). Drawing tools HUD (z:50) remains fully interactive.

### Phase 3: PDF-space coordinates
All annotation coordinates stored as normalised 0.0–1.0 values relative to PDF page dimensions. Transform functions:
```typescript
const screenToPdf = (x, y, scale, pageRect) => ({
  x: (x - pageRect.left) / (pageRect.width * scale),
  y: (y - pageRect.top) / (pageRect.height * scale)
})
const pdfToScreen = (x, y, scale, pageRect) => ({
  x: x * pageRect.width * scale + pageRect.left,
  y: y * pageRect.height * scale + pageRect.top
})
```
This makes annotations zoom-level and device-independent.

## Definition of done (Phase 2)

- RT server accepts connections, verifies JWT, joins rooms
- `stroke:delta` events broadcast to room and buffer in Redis
- Objects persist to PostgreSQL via REST API
- Follow mode locks student viewport to teacher
- Laser pointer relays to all clients (never persisted)
- Stroke buffer flushes to R2 every 60s
- Load test: 20 concurrent boards, p99 broadcast < 100ms

## Definition of done (Phase 3)

- Lock acquisition/release/TTL/keepalive all work
- Cross-tenant board access rejected
- Student cannot emit `follow:start` or `object:force_unlock`
- Shared undo reverses last action for all users
- Reconnect with `lastSeq` replays missed events in order
- Zoom overlay opens fullscreen with drawing tools active over PDF
- PDF annotations stored in PDF-space, render correctly at any zoom
