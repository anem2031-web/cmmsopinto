# ROLLBACK Guide

## 1. Rollback a Railway Deployment

1. Open [Railway Dashboard](https://railway.app) → select the **CMMS** project.
2. Click the **Deployments** tab.
3. Find the last known-good deployment and click **Redeploy**.
4. Wait for the build to complete (green status indicator).
5. Verify with: `curl https://cmms-production-adf1.up.railway.app/api/health`

---

## 2. Restore Database from a Backup

The app exposes a backup restore API (Phase 16). Use it as follows:

1. Log in as **owner** or **admin**.
2. Navigate to **Settings → Backups**.
3. Select the backup to restore and click **Restore**.
4. Alternatively, call the API directly:
   ```
   POST /api/trpc/backups.restore
   Authorization: Bearer <session-token>
   Body: { "backupId": <id> }
   ```
5. Monitor the server logs on Railway for restore progress.

---

## 3. Verify System Health After Rollback

Run a single health check request:

```bash
curl https://cmms-production-adf1.up.railway.app/api/health
```

**Expected response (HTTP 200):**
```json
{
  "status": "ok",
  "timestamp": "2025-01-01T00:00:00.000Z",
  "database": "connected",
  "uptime": 42
}
```

If `database` is `"disconnected"` or HTTP status is `503`, the database connection has not recovered — check Railway's MySQL service status and environment variables (`DATABASE_URL`).
