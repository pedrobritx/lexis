# Media Pipeline

Phase 2 feature. Handles image, PDF, audio, and video embed uploads for activities and whiteboard objects.

---

## Upload endpoint

```
POST /v1/media/upload
  Content-Type: multipart/form-data
  Body: {file, asset_type}

  → Checks storage limit before accepting (billing)
  → Processes file by type
  → Uploads to R2
  → Creates media_assets row
  Response: {id, asset_type, url, metadata}
```

---

## Processing by asset type

### Images → WebP

```typescript
const webp = await sharp(buffer)
  .webp({ quality: 85 })
  .resize({ width: 2000, height: 2000, fit: 'inside', withoutEnlargement: true })
  .toBuffer()

const key = `media/${tenantId}/images/${nanoid()}.webp`
await r2.send(new PutObjectCommand({ Bucket, Key: key, Body: webp, ContentType: 'image/webp' }))
```

Accepted input types: `image/jpeg`, `image/png`, `image/gif`, `image/webp`  
Max upload size: 10MB

### PDFs → thumbnail

```typescript
// Generate a WebP thumbnail of page 1 using pdf2pic or poppler
const thumbnail = await generatePdfThumbnail(buffer, { page: 1, width: 400 })

const pdfKey = `media/${tenantId}/pdfs/${nanoid()}.pdf`
const thumbKey = `media/${tenantId}/pdfs/${nanoid()}-thumb.webp`

await Promise.all([
  r2.send(new PutObjectCommand({ Key: pdfKey, Body: buffer, ContentType: 'application/pdf' })),
  r2.send(new PutObjectCommand({ Key: thumbKey, Body: thumbnail, ContentType: 'image/webp' }))
])

// metadata.thumbnail_key = thumbKey
```

Max upload size: 50MB

### Audio → WebM/Opus + waveform

```typescript
// Convert to WebM/Opus using FFmpeg
const webm = await convertToWebmOpus(buffer)

// Generate waveform JSON (array of ~100 amplitude values 0-1)
const waveform = await generateWaveform(buffer)

const key = `media/${tenantId}/audio/${nanoid()}.webm`
await r2.send(new PutObjectCommand({ Key: key, Body: webm, ContentType: 'audio/webm' }))

// metadata.waveform = waveform (stored in media_assets.metadata jsonb)
```

Accepted input types: `audio/mp3`, `audio/wav`, `audio/ogg`, `audio/webm`, `audio/m4a`  
Max upload size: 25MB

### Video embeds → oEmbed (no file upload)

```
POST /v1/media/embed
  Body: {url}  (YouTube, Vimeo, etc.)
  → Fetches oEmbed metadata
  → Creates media_assets row with asset_type = 'video_embed', s3_key = null
  → metadata.embed_url = original URL, metadata.provider = 'youtube'|'vimeo'
```

---

## Storage limit check

Before accepting any upload:

```typescript
await checkSubscriptionLimit(req.user.tenantId, 'storage')
// Checks: current total size_bytes for tenant < plan limit
// Throws 402 if exceeded
```

After upload, update usage snapshot:

```typescript
await prisma.usageSnapshot.upsert({
  where: { tenant_id_snapshot_date: { tenant_id, snapshot_date: today() } },
  update: { storage_bytes: { increment: file.size } },
  create: { tenant_id, snapshot_date: today(), storage_bytes: file.size }
})
```

---

## Signed URL delivery

Media assets are stored in a private R2 bucket. Access is via signed URLs with 1-hour TTL:

```
GET /v1/media/:id/url
  → Validates tenant owns this asset
  → Generates signed R2 URL
  Response: {url: 'https://media.lexis.app/...?sig=...', expires_at}
```

Public media (public template assets) is served directly via `https://media.lexis.app/{key}` without signing.

---

## In-app audio recording

The listening activity type allows students to record audio directly in the browser:

```typescript
// Client-side: MediaRecorder API
const recorder = new MediaRecorder(stream, { mimeType: 'audio/webm;codecs=opus' })
recorder.ondataavailable = (e) => chunks.push(e.data)
recorder.onstop = async () => {
  const blob = new Blob(chunks, { type: 'audio/webm' })
  // Upload via POST /v1/media/upload
  await uploadRecording(blob)
}
```

The recorded audio is attached to the student's submission as `{audio_asset_id}` in the response jsonb.

---

## Data model

### `media_assets`

| Field | Type | Notes |
|---|---|---|
| id | uuid PK | |
| tenant_id | uuid FK | |
| uploader_id | uuid FK | |
| asset_type | enum | `image`·`pdf`·`audio`·`video_embed` |
| s3_key | string? | null for video embeds |
| size_bytes | bigint | 0 for embeds |
| metadata | jsonb | `{waveform, thumbnail_key, embed_url, provider}` |
| deleted_at | timestamp? | |

---

## R2 key structure

```
media/{tenantId}/images/{nanoid}.webp
media/{tenantId}/pdfs/{nanoid}.pdf
media/{tenantId}/pdfs/{nanoid}-thumb.webp
media/{tenantId}/audio/{nanoid}.webm
```

All keys include `tenantId` to avoid cross-tenant key collisions and allow per-tenant R2 lifecycle rules in the future.
