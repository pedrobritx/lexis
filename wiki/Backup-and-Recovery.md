# Backup and Recovery

---

## PostgreSQL (Supabase Pro)

| Backup type | Frequency | Retention | How |
|---|---|---|---|
| Automated snapshots | Daily | 7 days | Supabase built-in |
| Point-in-time recovery | Continuous | Any second in 7 days | Supabase Pro PITR |
| Manual pg_dump | Weekly | 90 days | Uploaded to R2 at `backups/db/{date}.sql.gz` |

### Recovery targets

| Metric | Target |
|---|---|
| RTO (Recovery Time Objective) | < 30 minutes |
| RPO (Recovery Point Objective) | < 1 second |

### How to restore from PITR (Supabase)

1. Go to Supabase dashboard → Project → Database → Backups
2. Select "Restore to a point in time"
3. Choose the timestamp
4. Supabase restores to a new project — verify data, then update `DATABASE_URL` in Railway

### How to restore from pg_dump

```bash
# Download from R2
aws s3 cp s3://lexis-prod/backups/db/2024-03-15.sql.gz ./restore.sql.gz \
  --endpoint-url https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com

# Decompress and restore
gunzip restore.sql.gz
psql ${DIRECT_URL} < restore.sql
```

### Weekly dump schedule

A BullMQ cron job runs every Sunday at 01:00 UTC:

```typescript
// Creates a pg_dump and uploads to R2
// R2 lifecycle rule: delete objects in backups/db/ older than 90 days
```

---

## Cloudflare R2 (media + strokes)

| Feature | Detail |
|---|---|
| Object versioning | Enabled on production bucket |
| Deleted object retention | 30 days (object versioning keeps previous versions) |
| Durability SLA | 11 nines (99.999999999%) |
| Replication | Global by default (Cloudflare infrastructure) |

### Recovery

R2 object versioning means deletions are soft — objects can be recovered within 30 days:

```bash
# List versions of a deleted object
aws s3api list-object-versions \
  --bucket lexis-prod \
  --prefix media/tenant-id/images/example.webp \
  --endpoint-url https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com

# Restore by copying a specific version
aws s3api copy-object \
  --copy-source "lexis-prod/media/.../example.webp?versionId=xxx" \
  --bucket lexis-prod \
  --key media/.../example.webp \
  --endpoint-url https://...
```

---

## Redis (Upstash)

**Redis is intentionally not backed up.**

All Redis data is reconstructible from PostgreSQL or ephemeral by nature:

| Key type | Recovery strategy |
|---|---|
| `refresh:{jti}` | Users re-authenticate (new login) |
| `otp:{email}` | User requests new OTP |
| `lock:{objectId}` | Locks expire naturally (TTL 30s) |
| `strokes:*:buffer` | 60s of strokes lost at worst — acceptable |
| `replay:{pageId}` | Clients fall back to full board:state |
| `presence:{pageId}` | Presence rebuilds as clients reconnect |
| `analytics:*` | Recomputed on next request |

**Worst case on Redis loss:**
- All users are logged out (must re-authenticate)
- Up to 60 seconds of whiteboard strokes may be lost per active board
- No data loss for courses, progress, or student records (all in PostgreSQL)

---

## Runbook — production incident

### API is down

1. Check Railway dashboard → API service → Deployments
2. Check `GET api.lexis.app/v1/health` — if 503, check DB and Redis connectivity
3. If recent deploy: roll back via Railway (keep previous deployment)
4. If infrastructure issue: check Supabase and Upstash status pages
5. Update `status.lexis.app` via Better Uptime

### Database unresponsive

1. Check Supabase dashboard → Project status
2. If connection pool exhausted: restart PgBouncer in Supabase settings
3. If DB is down: check Supabase status page, wait or use PITR restore
4. API will return 503 — Redis and in-memory routes still work

### Data accidentally deleted

1. Identify the timestamp of deletion (from pino logs in Axiom)
2. Use Supabase PITR to restore to 1 minute before deletion
3. Extract affected rows from the restored project
4. Re-insert into production (not a full restore — surgical row-level recovery)
