# Release Hygiene Remediation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove the four post-release hygiene issues while preserving the current Next.js/Qoder architecture and production safety.

**Architecture:** Fix repository-owned causes locally, prove the security findings disappear without major upgrades, then release via the verified sgserver bundle route. Treat sqlite3 installation and PM2 log archival as explicit shserver operations with independent verification gates.

**Tech Stack:** Git, npm overrides, Next.js 15.5.20, drizzle-kit 0.31.10, Ubuntu apt, SQLite, PM2, ssh-remote.

## Global Constraints

- Never run `git push` on the Mac.
- Do not run `npm audit fix --force` or downgrade Next.js/drizzle-kit.
- Keep Next.js at 15.5.20 and drizzle-kit at 0.31.10.
- Archive PM2 logs before flushing them.
- Stop on a dirty/diverged tree, failed audit, failed build, failed archive verification, or failed health check.

---

### Task 1: Track the backup script as executable

**Files:**
- Modify mode: `scripts/backup.sh` (`100644` -> `100755`)

**Interfaces:**
- Consumes: Git index metadata.
- Produces: a deployable backup script that can be invoked directly.

- [ ] **Step 1: Verify the failing mode check**

Run: `git ls-files -s scripts/backup.sh`

Expected RED: output begins with `100644`.

- [ ] **Step 2: Apply the minimal mode change**

Run: `chmod +x scripts/backup.sh`

- [ ] **Step 3: Verify the mode is fixed**

Run: `git diff --summary -- scripts/backup.sh && git ls-files -s scripts/backup.sh`

Expected: mode change `100644 => 100755`; after staging, the index must report `100755`.

- [ ] **Step 4: Commit the isolated fix with the dependency remediation in Task 2**

The final remediation commit is created after Task 2 because both changes share the same release verification and deployment.

### Task 2: Remove all six npm audit findings

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`

**Interfaces:**
- Consumes: npm override resolution.
- Produces: safe nested PostCSS and Esbuild versions with an audit total of zero.

- [ ] **Step 1: Preserve the failing audit evidence**

Run: `npm audit --json`

Expected RED: six moderate findings, rooted in `next -> postcss` and `drizzle-kit -> @esbuild-kit -> esbuild`.

- [ ] **Step 2: Add exact nested overrides**

Add to `package.json`:

```json
"overrides": {
  "next": {
    "postcss": "8.5.16"
  },
  "@esbuild-kit/core-utils": {
    "esbuild": "0.25.12"
  }
}
```

- [ ] **Step 3: Regenerate the lockfile without force fixes**

Run: `npm install --package-lock-only`

Expected: exit 0; no package downgrade.

- [ ] **Step 4: Install and verify dependency resolution**

Run: `npm ci`

Run: `npm ls next postcss drizzle-kit esbuild @esbuild-kit/core-utils @esbuild-kit/esm-loader`

Expected: Next.js 15.5.20 and drizzle-kit 0.31.10 remain installed; vulnerable nested PostCSS/Esbuild copies are absent; no `invalid` tree entries.

- [ ] **Step 5: Verify GREEN audit**

Run: `npm audit --json`

Expected GREEN: metadata total is `0`.

- [ ] **Step 6: Run regression verification**

Run sequentially:

```bash
npm run typecheck
npm run test:unit
npm run test:integration
npm run lint
npx vitest run tests/e2e/chat.test.ts
npm run build
env DATABASE_PATH=/tmp/iracing-release-hygiene.sqlite WEB_KNOWLEDGE_SOURCES_SNAPSHOT_PATH=/tmp/iracing-release-hygiene-sources.md node --import tsx src/db/migrate.ts
git diff --check
```

Expected: all commands exit 0; migration applies A-H on the fresh database.

- [ ] **Step 7: Commit repository remediation**

```bash
git add package.json package-lock.json scripts/backup.sh docs/superpowers/specs/2026-07-15-release-hygiene-remediation-design.md docs/superpowers/plans/2026-07-15-release-hygiene-remediation.md
git commit -m "fix(deploy): clear release hygiene issues"
```

### Task 3: Install and verify sqlite3 on shserver

**Files:**
- Production package database only; no repository file changes.

**Interfaces:**
- Consumes: Ubuntu Noble configured package repositories.
- Produces: `/usr/bin/sqlite3` usable by `scripts/pre-deploy-migrate.sh`.

- [ ] **Step 1: Refresh package metadata and install sqlite3**

Through `ssh-remote --host shserver`, run:

```bash
apt-get update
DEBIAN_FRONTEND=noninteractive apt-get install -y sqlite3
```

Expected: package installation exits 0 without removing project dependencies.

- [ ] **Step 2: Verify CLI and project migration script**

```bash
command -v sqlite3
sqlite3 --version
cd /opt/iracing-ai-assistant
DATABASE_PATH=/srv/iracing-ai-assistant/data/db/app.sqlite scripts/pre-deploy-migrate.sh --dry-run
```

Expected: `/usr/bin/sqlite3`; dry-run reports no pending migrations and makes no production DB changes.

### Task 4: Release the repository remediation

**Files:**
- Generated bundle: `/tmp/iracing-ai-assistant-$TARGET.bundle`

**Interfaces:**
- Consumes: clean local `master`, reviewed remediation commit.
- Produces: the same TARGET on GitHub and shserver.

- [ ] **Step 1: Follow the complete project deployment skill**

Use `iracing-ai-deploy-via-sgserver` without deviations: verified bundle, sgserver push, Mac post-fetch, sgserver-to-shserver transfer, production backup, one build, standalone assembly, dry-run, migration/integrity gate, PM2 restart, and public health verification.

- [ ] **Step 2: Verify the executable mode in production**

Run: `stat -c '%a %n' /opt/iracing-ai-assistant/scripts/backup.sh`

Expected: `755`.

### Task 5: Archive and reset PM2 logs

**Files:**
- Create on shserver: `/srv/iracing-ai-assistant/data/backups/pm2-logs-release-hygiene-20260715.tar.gz`
- Create on shserver: matching `.sha256` file.

**Interfaces:**
- Consumes: `/root/.pm2/logs` after successful deployment.
- Produces: retained historical evidence and clean current-generation logs.

- [ ] **Step 1: Archive logs and verify the archive**

```bash
tar -C /root/.pm2 -czf /srv/iracing-ai-assistant/data/backups/pm2-logs-release-hygiene-20260715.tar.gz logs
sha256sum /srv/iracing-ai-assistant/data/backups/pm2-logs-release-hygiene-20260715.tar.gz > /srv/iracing-ai-assistant/data/backups/pm2-logs-release-hygiene-20260715.tar.gz.sha256
test -s /srv/iracing-ai-assistant/data/backups/pm2-logs-release-hygiene-20260715.tar.gz
sha256sum -c /srv/iracing-ai-assistant/data/backups/pm2-logs-release-hygiene-20260715.tar.gz.sha256
```

Expected: archive verification reports `OK`.

- [ ] **Step 2: Flush only after archive verification**

Run: `pm2 flush`

Expected: PM2 confirms logs were flushed.

- [ ] **Step 3: Generate fresh traffic and inspect new logs**

```bash
curl -sf http://127.0.0.1:3000/api/health/live
curl -sf http://127.0.0.1:3000/api/health/ready
curl -sf https://ai.iracing.club/login -o /dev/null
pm2 logs iracing-ai-web --lines 50 --nostream
pm2 logs iracing-ai-worker --lines 50 --nostream
test ! -s /root/.pm2/logs/iracing-ai-web-error-0.log
```

Expected: health checks succeed; no new web or worker error content.

- [ ] **Step 4: Final state verification**

Verify PM2 online state, production TARGET, clean production tree, zero pending migrations, database integrity, Mac `HEAD == origin/master`, and clean Mac status.
