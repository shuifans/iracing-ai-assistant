# iRacing AI Assistant — Deployment Runbook

## 1. Directory Structure

```
/opt/iracing-ai-assistant/              # Application code (git clone)
/opt/iracing-ai-assistant/.env          # Secrets file — root:root 0600
/srv/iracing-ai-assistant/data/         # Persistent data
  ├── db/app.sqlite                     # SQLite database (WAL mode)
  ├── md-wiki/                          # Wiki Git worktree
  ├── backups/                          # Automated & manual backups
  ├── uploads/                          # User-uploaded images
  └── drafts/                           # Knowledge draft files
/etc/nginx/sites-available/ai.iracing.club   # Nginx config
/etc/nginx/sites-enabled/ai.iracing.club     # Symlink to sites-available
```

> **Important:** The `.env` file contains secrets and must have permissions `0600` owned by `root:root`. Never commit `.env` to version control.

## 2. Pre-deployment Checklist

- [ ] Database and Wiki backed up (`scripts/backup.sh` completed successfully)
- [ ] Reviewed commit pulled — only deploy commits that have passed code review
- [ ] Migration validation passed: `scripts/pre-deploy-migrate.sh --dry-run`
- [ ] `.env` variables up to date (compare with `.env.example` for any new variables)
- [ ] Sufficient disk space for backup and new build (~500MB)
- [ ] Current process status verified: `pm2 status`

## 3. Deployment Steps

The deployment follows this order. All commands assume you are in the project root (`/opt/iracing-ai-assistant/`) unless otherwise noted.

### Step 1 — Backup

```bash
scripts/backup.sh
```

Verify backup completed:

```bash
ls -la /srv/iracing-ai-assistant/data/backups/$(date +%Y%m%d)*
```

### Step 2 — Pull reviewed commit

```bash
git pull origin master
```

> **Only deploy reviewed commits.** Never pull unreviewed changes to production.

### Step 3 — Validate migration (dry-run)

```bash
scripts/pre-deploy-migrate.sh --dry-run
```

Review the output. If any migration looks unexpected, **stop and investigate** before proceeding.

### Step 4 — Build

```bash
npm ci --production=false
npm run build
```

This builds the Next.js standalone output. After build, copy required assets:

```bash
cp -r .next/static .next/standalone/.next/static
cp -r public .next/standalone/public 2>/dev/null || true
mkdir -p .next/standalone/.next/server/chunks/migrations
cp src/db/migrations/*.sql .next/standalone/.next/server/chunks/migrations/
cp -r node_modules/bcrypt/prebuilds .next/standalone/node_modules/bcrypt/prebuilds
```

### Step 5 — Stop old processes

```bash
pm2 stop iracing-ai-web iracing-ai-worker
```

### Step 6 — Run migration

```bash
scripts/pre-deploy-migrate.sh
```

This script:
1. Backs up the current database
2. Validates migration on a temporary copy
3. Executes migration on the production database
4. Runs `PRAGMA integrity_check` to verify

If migration fails, the script automatically restores from the backup it created.

### Step 7 — Start new processes

```bash
pm2 restart iracing-ai-web iracing-ai-worker
```

Or if processes are not running:

```bash
pm2 start ecosystem.config.cjs
```

### Step 8 — Wait for ready

```bash
for i in $(seq 1 30); do
  if curl -sf http://localhost:3000/api/health/ready > /dev/null 2>&1; then
    echo "Application is ready"
    break
  fi
  echo "Waiting... ($i/30)"
  sleep 2
done
```

### Step 9 — Smoke test

Verify the following pages work:

1. **Login page**: `https://ai.iracing.club/login`
2. **Chat page**: `https://ai.iracing.club/chat` — send a test message
3. **Admin panel**: `https://ai.iracing.club/admin` — check stats load
4. **Health endpoints**:
   ```bash
   curl http://localhost:3000/api/health/live
   curl http://localhost:3000/api/health/ready
   ```

### Step 10 — Update Nginx (if config changed)

Only needed if `config/nginx/ai.iracing.club.conf` was modified:

```bash
cp config/nginx/ai.iracing.club.conf /etc/nginx/sites-available/ai.iracing.club
nginx -t && systemctl reload nginx
```

## 4. Rollback Procedure

Use this procedure when a deployment causes issues that require reverting to the previous version.

### Step 1 — Stop new processes

```bash
pm2 stop iracing-ai-web iracing-ai-worker
```

### Step 2 — Restore database from backup

```bash
scripts/restore.sh /srv/iracing-ai-assistant/data/backups/<backup-dir>
```

The restore script:
1. Verifies the backup checksum (`sha256`)
2. Copies the database to an isolated temp directory
3. Runs `PRAGMA integrity_check`
4. Restores the Wiki Git bundle (if present)
5. Runs migration check on the restored copy

Follow the script's output to complete the restore:

```bash
cp /tmp/restore_<timestamp>/app.sqlite /srv/iracing-ai-assistant/data/db/app.sqlite
```

### Step 3 — Checkout previous commit

```bash
git checkout <previous-commit>
```

### Step 4 — Rebuild and start

```bash
npm run build
cp -r .next/static .next/standalone/.next/static
cp -r public .next/standalone/public 2>/dev/null || true
mkdir -p .next/standalone/.next/server/chunks/migrations
cp src/db/migrations/*.sql .next/standalone/.next/server/chunks/migrations/
cp -r node_modules/bcrypt/prebuilds .next/standalone/node_modules/bcrypt/prebuilds
pm2 restart iracing-ai-web iracing-ai-worker
```

### Step 5 — Verify

```bash
curl -sf http://localhost:3000/api/health/ready && echo "OK"
```

Run smoke tests (Step 9 from Deployment Steps) to confirm the application is fully functional.

## 5. Backup & Restore

### Manual Backup

```bash
scripts/backup.sh
```

Backup contents:
- `app.sqlite` — SQLite database (via better-sqlite3 backup API, no locking)
- `app.sqlite.sha256` — Checksum for integrity verification
- `wiki.bundle` — Git bundle of the Wiki worktree (if exists)
- `uploads-manifest.txt` — List of uploaded files
- `drafts-manifest.txt` — List of draft files
- `env-keys.txt` — Environment variable names (no values)

### Restore from Backup

```bash
scripts/restore.sh /srv/iracing-ai-assistant/data/backups/20260712_033000
```

### Automated Backup

Cron entry (runs as root):

```
30 19 * * * /opt/iracing-ai-assistant/scripts/cron-backup.sh >> /var/log/iracing-ai-backup.log 2>&1
```

- Schedule: daily at 19:30 UTC (03:30+1 Asia/Shanghai)
- Retention: keeps 7 daily + 4 weekly backups (older backups are pruned automatically)

## 6. Monitoring

### Health Endpoints

| Endpoint | Purpose | Used By |
|---|---|---|
| `/api/health/live` | Process liveness — basic process check | PM2 auto-restart, Nginx |
| `/api/health/ready` | Application readiness — verifies PAT, Wiki, and DB connectivity | Deployment verification |

> **Note:** Nginx blocks access to health endpoints other than `/live` and `/ready` from external requests.

### Logs

```bash
# All PM2 logs
pm2 logs

# Web process only (Next.js server)
pm2 logs iracing-ai-web

# Worker process only (knowledge processing)
pm2 logs iracing-ai-worker
```

### Process Status

```bash
pm2 status
```

Or for detailed info:

```bash
pm2 show iracing-ai-web
pm2 show iracing-ai-worker
```

## 7. Troubleshooting

### Process won't start

**Symptoms:** `pm2 start` exits immediately or process restarts in a loop.

1. Check logs:
   ```bash
   pm2 logs iracing-ai-web
   ```
2. Verify `.env` exists and has all required variables (compare with `.env.example`)
3. Check `/srv/iracing-ai-assistant/data` directory permissions:
   ```bash
   ls -la /srv/iracing-ai-assistant/data/
   ```
4. Verify the build completed successfully:
   ```bash
   ls -la .next/standalone/server.js
   ```

### Database migration failure

**Symptoms:** `[migrate] Failed:` in PM2 logs, or process exits after migration step.

1. The `pre-deploy-migrate.sh` script auto-restores from its own backup on failure.
2. To manually rollback the last migration:
   ```bash
   scripts/pre-deploy-migrate.sh --rollback --steps 1
   ```
3. Or restore from a full backup:
   ```bash
   scripts/restore.sh /srv/iracing-ai-assistant/data/backups/<backup-dir>
   ```
4. Check migration file syntax:
   ```bash
   sqlite3 /srv/iracing-ai-assistant/data/db/app.sqlite < src/db/migrations/<migration-file>.sql
   ```

### Worker not processing jobs

**Symptoms:** Knowledge items stuck in `processing` status, no worker activity in logs.

1. Check worker logs:
   ```bash
   pm2 logs iracing-ai-worker
   ```
2. Verify `QODER_PERSONAL_ACCESS_TOKEN` is set in `.env`
3. Check job lease status in the admin panel (`/admin` → Knowledge section)
4. Verify worker process is running:
   ```bash
   pm2 show iracing-ai-worker
   ```
5. If the worker has crashed, restart it:
   ```bash
   pm2 restart iracing-ai-worker
   ```

### Git push failures

**Symptoms:** Knowledge items published locally but not pushed to remote Wiki repository.

1. Knowledge is still published locally even if Git push fails — the Wiki remains functional.
2. Retry via admin panel or API:
   ```bash
   curl -X POST http://localhost:3000/api/knowledge/git/retry \
     -H "Authorization: Bearer <token>"
   ```
3. Verify `WIKI_GIT_REMOTE` is set correctly in `.env`
4. Check Git credentials are configured and valid
5. Test connectivity:
   ```bash
   cd /srv/iracing-ai-assistant/data/md-wiki && git remote -v && git fetch --dry-run
   ```

### Nginx 502 Bad Gateway

**Symptoms:** Users see 502 errors when accessing the site.

1. Verify processes are running:
   ```bash
   pm2 status
   ```
2. Check health:
   ```bash
   curl http://localhost:3000/api/health/live
   ```
3. Check Nginx config syntax:
   ```bash
   nginx -t
   ```
4. Check Nginx error logs:
   ```bash
   tail -50 /var/log/nginx/error.log
   ```
5. If processes are up but Nginx can't connect, verify the proxy port:
   ```bash
   curl -v http://127.0.0.1:3000/api/health/live
   ```

### SSE (Server-Sent Events) issues

**Symptoms:** Chat responses not streaming, connection drops during AI responses.

1. Verify Nginx SSE location has buffering disabled:
   ```nginx
   proxy_buffering off;
   proxy_cache off;
   proxy_read_timeout 180s;
   ```
2. Check that `X-Accel-Buffering: no` header is present in responses
3. Verify no intermediate proxy (CDN, load balancer) is buffering SSE responses

## 8. Environment Variables

See `.env.example` for all required and optional variables.

### Required for Production

| Variable | Description |
|---|---|
| `JWT_ACCESS_SECRET` | JWT signing key (must not be empty) |
| `REFRESH_TOKEN_PEPPER` | Refresh token salt |
| `IP_HASH_PEPPER` | IP address hashing pepper |
| `QODER_PERSONAL_ACCESS_TOKEN` | Qoder SDK access token |

### Optional but Recommended

| Variable | Default | Description |
|---|---|---|
| `APP_BASE_URL` | `http://localhost:3000` | Public URL of the application |
| `WIKI_GIT_REMOTE` | _(empty)_ | Remote Git repo for Wiki sync |
| `IQS_API_BASE_URL` | _(empty)_ | IQS search API endpoint |
| `IQS_API_KEY` | _(empty)_ | IQS search API key |
| `LOG_LEVEL` | `info` | Logging verbosity |

### Security Notes

- `.env` file permissions must be `0600` (owner read/write only)
- Never log or expose secret values
- `BOOTSTRAP_ADMIN_USERNAME` / `BOOTSTRAP_ADMIN_PASSWORD` are only for initial setup via `scripts/bootstrap-admin.ts` — remove after first admin is created
- The backup script saves env variable **names only** (no values) in `env-keys.txt`
