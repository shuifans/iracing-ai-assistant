# Release Hygiene Remediation Design

## Goal

Eliminate the four release leftovers from the Qoder Agent deployment without weakening security controls or introducing a major framework upgrade.

## Confirmed root causes

1. `scripts/backup.sh` is tracked by Git as mode `100644`, so every deployment reproduces the missing executable bit.
2. shserver has no `sqlite3` package installed; Ubuntu Noble provides candidate `3.45.1-1ubuntu2.6` from the configured Alibaba Cloud mirror.
3. The six moderate npm findings collapse to two vulnerable transitive dependency roots:
   - `next@15.5.20` pins `postcss@8.4.31`, below the `8.5.10` security floor.
   - `drizzle-kit@0.31.10` retains deprecated `@esbuild-kit/esm-loader -> @esbuild-kit/core-utils -> esbuild@0.18.20`, below the safe Esbuild line.
4. `/root/.pm2/logs/iracing-ai-web-error-0.log` contains historical Server Action errors and was last modified before the `dce2976` deployment. PM2 did not rotate or clear historical logs during deployment.

## Selected approach

Use the smallest compatible remediation:

- Track `scripts/backup.sh` as executable (`100755`).
- Install the distribution-maintained `sqlite3` package on shserver and verify both CLI execution and the checked-in migration script dry-run.
- Add precise npm `overrides` that reuse the direct safe PostCSS dependency across the tree and replace the vulnerable nested Esbuild copy, regenerate the lockfile, require `npm audit` to report zero vulnerabilities, and retain Next.js 15.5.20 and drizzle-kit 0.31.10.
- Archive the existing PM2 logs under `/srv/iracing-ai-assistant/data/backups/`, record SHA-256, then flush PM2 logs. Generate fresh health traffic and require the error log to stay empty.

No `npm audit fix --force`, Next.js major upgrade, dependency downgrade, force-push, or direct Mac GitHub push is allowed.

## Verification gates

### Local acceptance gates

- Before the mode change, `git ls-files -s scripts/backup.sh` demonstrates RED with `100644`; after the change it must show `100755`.
- Before dependency changes, `npm audit --json` demonstrates RED with exactly six moderate findings; after lockfile regeneration it must report zero total findings.
- `npm ls` must show safe nested PostCSS and Esbuild versions with no invalid dependency tree.
- Typecheck, unit tests, integration tests, lint, API E2E, production build, fresh A-H migration, and `git diff --check` must pass.

### Production gates

- Release only through Mac bundle -> sgserver GitHub push -> sgserver bundle transfer -> shserver deployment.
- `command -v sqlite3` and `sqlite3 --version` must succeed.
- `DATABASE_PATH=/srv/iracing-ai-assistant/data/db/app.sqlite scripts/pre-deploy-migrate.sh --dry-run` must complete successfully and list no pending migrations.
- PM2 logs must be archived before flush; the archive must be non-empty and have a recorded SHA-256.
- After `pm2 flush`, both processes must remain online, local and public health endpoints must return success, and the new web error log must remain empty.
- Production HEAD must equal the released TARGET; the worktree and Mac tracking state must be clean.

## Rollback

- Dependency or build failure: do not push or deploy.
- sqlite3 installation failure: stop before any release mutation; the existing Node/better-sqlite3 migration fallback remains valid.
- Deployment failure: use the normal verified production database backup and previous Git target.
- Log cleanup failure: keep the archive and do not delete source logs manually.
