# P0/P1 Remediation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: follow strict test-driven development. Add a regression test, run it and record the expected failure, implement the smallest fix, then run the focused suite. Multiple implementers share one working tree, so edit only the assigned files.

**Goal:** Close findings F-01 through F-11 without implementing P2/P3 scope.

**Architecture:** Keep the modular monolith. Fix security controls at their existing boundaries: Git operations use argv and explicit publish states; worker leases end when execution ends; chat authorization/rate limiting runs before model work; attachment/evidence/Markdown inputs gain ownership and schemas; URL connections bind DNS validation to the actual socket. Changes are split by non-overlapping file ownership and integrated through tests.

**Implementation status:** Completed on 2026-07-14. All eight tasks passed focused verification and independent review; final whole-tree results are recorded in `10-p0-p1-remediation-report.md`.

**Tech Stack after remediation:** Next.js 15.5.20, React 19.2.7, TypeScript strict, Vitest, Playwright, Drizzle/better-sqlite3, Qoder Agent SDK, Node.js HTTP/TLS and Git.

## Global Constraints

- Scope is only F-01 through F-11 from `06-findings.md`; do not opportunistically fix P2/P3.
- Do not commit, push, deploy, or modify secrets. The primary agent integrates and verifies the shared working tree.
- This local machine may run `git pull` but must never push directly to GitHub. Any future push for this repository must be relayed through sgserver using its checkout at `/home/admin/ai-projects/iracing-ai-assistant`; the user instruction overrides the generic SSH skill's hkserver default.
- Preserve all pre-existing untracked review documents.
- Every production change requires a regression test that was observed failing for the expected reason before implementation.
- Prefer real SQLite/temp Git/component behavior; mock only the external boundary being isolated.
- Do not weaken authentication, Origin checks, SQLite constraints, file size limits, or the Wiki category allowlist.
- Public error responses must not disclose shell commands, credentials, internal paths, or raw provider responses.

---

### Task 1: Secure and Recoverable Knowledge Publishing (F-01, F-02)

**Owned files:**

- Modify: `src/modules/knowledge/publisher.ts`
- Modify if needed: `src/modules/knowledge/repository.ts`
- Test: `tests/unit/modules/knowledge/publisher.test.ts`
- Test: `tests/integration/modules/knowledge/repository.test.ts`
- Create focused integration test under `tests/integration/modules/knowledge/` if the current publisher mocks cannot exercise SQLite and Git together.

**Required behavior:**

- Replace every shell-string Git invocation with `execFileSync`/`spawn` argv; include `--` before file paths where Git supports it.
- A title containing `$()`, backticks, quotes, leading dashes, or newlines is a literal commit message and can never execute.
- Use only `committed`, `push_pending`, `synced`, `push_failed`.
- No remote: commit succeeds and status is `committed`.
- Remote configured: persist `push_pending` before/while asynchronous push is pending; do not claim `synced` until exit status is known. A failed start/exit becomes `push_failed` without reverting a published DB state or deleting the published Wiki file.
- Put item upsert, draft approval, job `publishing→published`, and audit insertion in one SQLite transaction where feasible. At minimum, post-publish Git failure must not enter the pre-publish file rollback block.
- Retry push uses argv and ends in `synced` on confirmed success or remains `push_failed` on failure.

**TDD cases:** malicious title sentinel is not created; DB rejects no status; push failure retains published job/file; retry success writes `synced`; path outside Wiki root is rejected.

**Focused commands:**

```bash
npx vitest run tests/unit/modules/knowledge/publisher.test.ts
npx vitest run --project integration tests/integration/modules/knowledge/repository.test.ts
```

### Task 2: Worker Lease Lifecycle (F-03)

**Owned files:**

- Modify: `src/modules/jobs/repository.ts`
- Modify if needed: `src/modules/jobs/service.ts`
- Modify if needed: `worker/processors/knowledge.ts`
- Test: `tests/integration/modules/jobs/lease.test.ts`
- Test: `tests/unit/modules/jobs/repository.test.ts`
- Test: `tests/unit/worker/processors/knowledge.test.ts`

**Required behavior:**

- Transitioning worker execution to `pending_review` clears `lease_owner`, `lease_expires_at`, and `heartbeat_at` atomically with the status change.
- Expired-lease recovery handles only `extracting` and `cleaning`.
- Recovery update repeats the expired-at and execution-status predicates so a concurrent state advance cannot be rolled back after the select.
- Do not implement maxAttempts enforcement; that is F-12/P2.

**TDD cases:** pending_review with stale lease is never recovered; extracting/cleaning are recovered; publishing is never recovered; concurrent status advance is retained.

**Focused commands:**

```bash
npx vitest run --project integration tests/integration/modules/jobs/lease.test.ts
npx vitest run tests/unit/modules/jobs/repository.test.ts tests/unit/worker/processors/knowledge.test.ts
```

### Task 3: Chat Rate Limits, Diagnostic Guard, and Stop Ownership (F-05, F-06)

**Owned files:**

- Modify: `src/modules/chat/service.ts`
- Modify: `src/app/api/chat/diagnostic/route.ts`
- Modify if needed: `src/modules/rate-limit/service.ts`
- Modify if needed: `src/modules/chat/repository.ts`
- Test: `tests/unit/modules/chat/service.test.ts`
- Test: relevant chat/diagnostic route tests under `tests/unit` or `tests/e2e`

**Required behavior:**

- `checkRateLimit(user.id, user.role)` executes in the shared chat service before messages are created and before any LLM/Agent call, so send, retry, and diagnostic cannot bypass it.
- Diagnostic POST requires `admin` or `knowledge_admin`, active status, and valid Origin. Validate questions as 1–10 non-empty strings with a finite per-question length; a supplied session must belong to the caller.
- Stop resolves the message through session ownership using `userId`; a cross-user request returns NOT_FOUND and cannot abort the other controller.
- Keep stopping an owned, non-active message idempotent.

**TDD cases:** rate-limit failure creates no message and calls no model; ordinary user diagnostic is forbidden; invalid Origin rejected; user B cannot stop user A; user A can stop its own active response.

**Focused commands:**

```bash
npx vitest run tests/unit/modules/chat/service.test.ts tests/unit/modules/rate-limit/service.test.ts
npx vitest run --project e2e tests/e2e/chat.test.ts
```

### Task 4: Owned Two-Phase Attachments and Model Input (F-04)

**Owned files:**

- Modify: `src/db/schema/chat.ts`
- Create: next ordered SQL migration in `src/db/migrations/`
- Modify: `src/app/api/uploads/images/route.ts`
- Modify: `src/modules/chat/repository.ts`
- Modify: `src/modules/chat/service.ts` only after Task 3 is integrated, or coordinate a non-overlapping attachment section.
- Modify: `src/modules/agent/llm-client.ts` and Qoder request construction if supported.
- Test: chat repository/service/upload tests and a real migration integration test.

**Required behavior:**

- An unbound upload has nullable `message_id`, an `uploaded_by` FK, and creation/expiry metadata sufficient for ownership and cleanup.
- Uploads are stored under `DATA_ROOT/uploads`, not `/data/uploads`.
- Sending atomically verifies each attachment belongs to the caller, is unbound, and then binds it to the newly created user message. Cross-user and double binding fail.
- The selected model request receives the image content in a provider-supported form. If Qoder SDK has no supported image input, reject attachments on that backend with a clear validation error; never silently ignore them.
- Migration preserves existing attachment rows and foreign keys.

**TDD cases:** upload succeeds with real SQLite; owner send binds; cross-user/double bind reject; path honors DATA_ROOT; direct request contains image; unsupported backend returns explicit error before model call.

### Task 5: Qoder Tool Boundaries and Evidence Contract (F-07, F-08)

**Owned files:**

- Modify: `src/modules/agent/client.ts`
- Modify: `src/modules/agent/types.ts`
- Modify: `src/modules/chat/service.ts` only after Task 3 is integrated, or expose a helper consumed there.
- Modify if needed: `src/modules/chat/sse-mapper.ts`
- Test: `tests/unit/modules/agent/client.test.ts` and chat evidence tests.

**Required behavior:**

- WebSearch validates query type/length, not URL syntax.
- WebFetch allows only explicit hostname/path rules. `reddit.com` is allowed only under `/r/iRacing`; subdomain/port/trailing-dot and encoded-path handling are deterministic.
- File access uses `path.relative` containment, rejecting prefix siblings and traversal.
- Prompt and AgentDefinition use the same web max-turn value.
- Define one Zod evidence envelope shared by hook and consumer. Reject malformed/oversized evidence and persist valid evidence to source SSE/DB.

**TDD cases:** natural-language search allowed; disallowed fetch denied; Reddit path rule; Wiki prefix sibling denied; hook envelope is parsed and creates a source.

### Task 6: Safe Shared Markdown Rendering (F-09)

**Owned files:**

- Create a shared Markdown renderer/component under `src/components/chat/` or `src/lib/`.
- Modify: `src/components/chat/MessageBubble.tsx`
- Modify: `src/components/admin/SessionDetail.tsx`
- Modify: `package.json` and lockfile only if a sanitizer dependency is needed.
- Test: component/unit tests for both consumers; add browser coverage for link clicks where practical.

**Required behavior:**

- Both screens use one renderer and sanitizer.
- Allow normal Markdown but only safe tags/attributes.
- Link schemes are limited to `https:`, `http:` and explicitly supported relative paths; reject `javascript:`, `data:`, `vbscript:` and whitespace/entity/case variants.
- External links retain `noopener noreferrer`.

**TDD cases:** ordinary headings/code/table/link render; each dangerous URL corpus is absent or inert; raw HTML/event attributes cannot execute.

### Task 7: Runtime Dependency Security (F-10)

**Owned files:**

- Modify: `package.json`, `package-lock.json`
- Modify: spreadsheet extractor and its tests if replacing `xlsx`.
- Modify framework config/code only as required by a supported Next upgrade.

**Required behavior:**

- Re-run `npm audit --omit=dev` and record exact runtime advisories before changing versions.
- Upgrade Next/React on the smallest supported path that removes known high runtime advisories and keep `eslint-config-next` on the same major. Do not use an unreviewed force fix.
- Remove vulnerable `xlsx@0.18.5` from runtime. Replace it with a maintained parser or disable spreadsheet ingestion explicitly; preserve XLSX worksheet-to-text behavior, file/row/column limits, and errors through tests.
- Typecheck, build, unit/integration, and browser smoke must pass after the dependency change.

### Task 8: DNS-Pinned URL Fetching and Body Deadline (F-11 plus the inseparable timeout half of F-14)

**Owned files:**

- Modify: `src/modules/knowledge/extractors/url.ts`
- Modify caller to pass worker AbortSignal if required.
- Add only a maintained networking/IP dependency if Node APIs cannot express the pin safely.
- Test: `tests/unit/modules/knowledge/extractors/url.test.ts` or existing equivalent.

**Required behavior:**

- **Final user-approved variance:** URL 抓取采用 IPv4-only 出站策略。解析并校验全部 A 记录，任一 private/reserved A 即拒绝；AAAA 不参与连接，AAAA-only 明确失败。该决策避免双栈域名被误拒绝，同时不实现 IPv6 出站。
- Bind the validated public IPv4 address to the actual TLS connection while preserving hostname/SNI/certificate verification.
- Repeat validation and pinning for every redirect.
- One total deadline remains active through full body consumption; caller abort and deadline cancel the socket/reader.
- Keep HTTPS-only, user-info rejection, redirect limit, and byte limit.

**TDD cases:** rebinding lookup cannot change the connected IP; multiple A records containing a private address are rejected; public A + AAAA pins IPv4 successfully; AAAA-only fails before opening a socket; redirect to private is blocked; slow/infinite body times out; normal public HTTPS extraction succeeds with injected deterministic network fixtures.

## Integration and Review Gate

After each wave, an independent reviewer inspects only that wave's diff for specification compliance and code quality. Critical/Important review findings are fixed before the next wave. Final verification runs:

```bash
npm run typecheck
npm run lint
npm run test:unit
npm run test:integration
npx vitest run --project e2e
npm run test:contract
npm run build
npm run test:e2e
npx tsx scripts/validate-wiki.ts
npm audit --omit=dev
```

Known baseline exceptions are not silently accepted: the existing lint error, empty contract suite, and one browser test drift must be reported distinctly if still present because they are P3 and outside this implementation scope.
