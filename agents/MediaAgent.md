# MediaAgent

You are building the **media upload pipeline** for Lexis (`apps/api/src/modules/media/`).

## Before you start

Read:
1. `docs/schema.md` — media_assets table
2. `docs/devops.md` — Cloudflare R2 configuration
3. `docs/billing.md` — storage limit enforcement
4. `docs/phases.md` — Phase 2 Week 3

## What you are building

A single upload endpoint that handles 5 asset types, enforces storage limits, processes media, and serves via signed R2 URLs.

## Files to create

```
apps/api/src/modules/media/
  media.routes.ts
  media.service.ts
  processors/
    image.processor.ts    Sharp → WebP + thumbnail
    pdf.processor.ts      pdf-thumbnail → WebP preview
    audio.processor.ts    FFmpeg → WebM/Opus + waveform
    embed.processor.ts    oEmbed validation + metadata
  media.test.ts
```

## Processing pipeline per asset type

### Images (JPEG/PNG/WebP)
```typescript
// Using Sharp
const processed = await sharp(inputBuffer)
  .resize(2048, 2048, { fit: 'inside', withoutEnlargement: true })
  .webp({ quality: 85 })
  .toBuffer()
const thumbnail = await sharp(inputBuffer).resize(400, 400, { fit: 'inside' }).webp().toBuffer()
```
Strip EXIF metadata. Store at `media/{tenantId}/{uuid}.webp` and `media/{tenantId}/{uuid}_thumb.webp`.

### PDFs
Store as-is (no transcoding). Generate first-page WebP thumbnail via `pdf-thumbnail`. Store at `media/{tenantId}/{uuid}.pdf` and `media/{tenantId}/{uuid}_thumb.webp`.

### Audio (uploaded file)
FFmpeg: normalize to WebM/Opus regardless of input format.
Extract waveform: amplitude per 100ms segment as `number[]` array. Store in `metadata.waveform`.
```bash
ffmpeg -i input.mp3 -c:a libopus -b:a 96k output.webm
```

### Audio (in-app recording)
Recorded as WebM/Opus by the browser's `MediaRecorder API`. Upload directly — no transcoding needed. Same endpoint, same processing path (FFmpeg still runs for waveform extraction).

### Video embeds (YouTube/Vimeo)
No bytes stored. Validate URL format. Fetch oEmbed endpoint for title + thumbnail.
```typescript
const oembedUrl = `https://www.youtube.com/oembed?url=${encodeURIComponent(url)}&format=json`
const meta = await fetch(oembedUrl).then(r => r.json())
```
Store `asset_type = 'video_embed'` with `size_bytes = 0`. Counts zero against storage quota.

## Storage limit check

Before accepting any file upload:
```typescript
const currentBytes = await getCurrentStorageBytes(tenantId)  // from usage_snapshots or live count
const limitBytes = getStorageLimitBytes(subscription.plan_slug)
if (currentBytes + incomingBytes > limitBytes) {
  throw new BillingLimitError('storage')
}
```

After upload: emit `media.uploaded` event with `{tenantId, bytes}` to update running Redis total.

## Signed URL delivery

**Never return permanent R2 URLs.** Always generate signed URLs:
```typescript
GET /v1/media/:id/url
→ Check tenant_id ownership
→ Generate signed URL via getSignedUrl (1-hour TTL)
→ Return {url, expiresAt}
```

Clients must request fresh signed URLs before each render. This allows revoking access by soft-deleting the `media_assets` record.

## Definition of done

- All 5 asset types upload and process correctly
- Images converted to WebP with thumbnail
- Audio has waveform data in metadata
- Video embeds validate and store oEmbed metadata
- Storage limit enforced before accepting upload
- Signed URLs returned with 1-hour TTL
- `pnpm test:integration` passes for upload + delivery
