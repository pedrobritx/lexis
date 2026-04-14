# Certificates

Teachers can issue CEFR progress certificates to students. Each certificate has a permanent public URL.

---

## Issuing a certificate

```
POST /v1/certificates
  Body:
  {
    "studentId": "...",
    "cefrLevel": "b1",
    "targetLanguage": "en",
    "teacherNote": "Completed B1 English in 6 months."
  }
  Response:
  {
    "id": "...",
    "public_id": "lex_b1_k7x2m",
    "public_url": "https://lexis.app/cert/lex_b1_k7x2m",
    "issued_at": "2024-03-15T10:00:00Z"
  }
```

---

## Public ID format

Each certificate gets a `public_id` using nanoid:

```
lex_{cefr_level}_{nanoid(5)}
```

Examples:
- `lex_b1_k7x2m`
- `lex_a2_p9qr3`
- `lex_c1_x7mn8`

This ID is the URL slug and is unique across all tenants.

---

## Public certificate page

`https://lexis.app/cert/:publicId`

This is a **server-side rendered Next.js page** with:
- Certificate design with teacher branding
- Student name, level, language, issue date
- Teacher name and badge
- OpenGraph tags for sharing (thumbnail image)
- No authentication required — publicly accessible

```typescript
// apps/web/app/cert/[publicId]/page.tsx
export async function generateMetadata({ params }) {
  const cert = await getCertificate(params.publicId)
  return {
    title: `${cert.student_name} — ${cert.cefr_level.toUpperCase()} ${cert.target_language}`,
    openGraph: {
      images: [`/api/og/cert/${params.publicId}`]
    }
  }
}
```

---

## PDF generation

The certificate PDF is generated on the **first download request** and cached in R2:

```
GET /v1/certificates/:id/pdf
  → If pdf_s3_key is null: generate via Puppeteer, upload to R2, set pdf_s3_key
  → If pdf_s3_key is set: return signed R2 URL directly
  Response: {url: 'https://media.lexis.app/certs/...pdf', expires_at}
```

### PDF generation flow

```typescript
async function generateCertificatePdf(certId: string) {
  const cert = await prisma.certificate.findUnique({ where: { id: certId } })

  // 1. Launch headless Puppeteer
  const browser = await puppeteer.launch()
  const page = await browser.newPage()

  // 2. Load certificate page
  await page.goto(`${process.env.WEB_URL}/cert/${cert.public_id}?pdf=true`)
  await page.waitForSelector('[data-ready="true"]')

  // 3. Generate PDF
  const pdf = await page.pdf({ format: 'A4', printBackground: true })
  await browser.close()

  // 4. Upload to R2
  const key = `certs/${cert.public_id}.pdf`
  await r2.send(new PutObjectCommand({
    Bucket: process.env.R2_BUCKET,
    Key: key,
    Body: pdf,
    ContentType: 'application/pdf'
  }))

  // 5. Save key
  await prisma.certificate.update({
    where: { id: certId },
    data: { pdf_s3_key: key }
  })

  return key
}
```

---

## Data model

### `certificates`

| Field | Type | Notes |
|---|---|---|
| id | uuid PK | |
| public_id | string unique | `lex_{level}_{nanoid5}` |
| tenant_id | uuid FK | |
| student_id | uuid FK | |
| issued_by | uuid FK | Teacher's user ID |
| cefr_level | string | `a1`–`c2` |
| target_language | string | ISO 639-1 |
| teacher_note | text? | |
| pdf_s3_key | string? | Set on first PDF download |
| issued_at | timestamp | |

---

## Listing certificates

```
GET /v1/certificates
  → Lists all certificates issued by this tenant
  → Scoped to req.user.tenantId

GET /v1/students/:id/certificates
  → Lists certificates for a specific student
```
