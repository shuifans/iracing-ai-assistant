# 工作包 A：基础工程与数据库 — 实施计划

> 日期：2026-07-11
> SPEC 基线：ab2e449
> 状态：Approved for Execution

---

## 0. 并行开发策略

### Worktree vs Branch

**推荐：独立 Git Branch**（`feat/B-auth`、`feat/C-chat` 等），不使用 worktree。

| 维度 | Branch（推荐） | Worktree |
|------|---------------|----------|
| 复杂度 | 低，标准 Git 流程 | 中等，需管理多个工作目录 |
| CI 集成 | 直接推送触发 | 需要额外配置 |
| IDE 支持 | 原生支持 | 多目录可能导致索引混乱 |
| PR 审查 | 标准 GitHub PR | 相同，但目录管理更复杂 |
| 磁盘占用 | 共享 `.git` | 每个 worktree 独立 checkout |

### Qoder Quest 专家团模式

**建议启用**。工作包 B–E 在 A 完成后可并行开发，专家团模式能同时调度多个编码代理分别处理不同模块，与 SPEC 第 23.1 节的依赖图吻合。

### 操作流程

1. 工作包 A 全部完成后合并到 `master`
2. B/C/D/E 各自从 `master` 创建分支
3. C 和 D 可完全并行；B 先行（C/D/E 均依赖 B 的 auth middleware）
4. E 可先基于 B 的接口 mock 开发，合并验收依赖 B/C/D
5. F 在所有模块合并后收口

---

## 1. 范围与边界

### 交付（SPEC 第 23.2 节）

- Next.js 14+ / TypeScript strict / Tailwind CSS 项目骨架
- 数据库完整 schema（16 张表）+ SQL 迁移 + 迁移运行器
- UUID v7、时间、错误码、统一响应格式工具
- 环境变量 Zod 校验
- Vitest 三层测试框架 + 测试 helper
- CI 管线基线（format → lint → typecheck → test → build）
- `/api/health/live` 最小健康端点

### 明确不做

- 不创建 `src/modules/**` 下任何业务模块代码
- 不创建任何 API Route Handler（`/api/health/live` 除外）
- 不创建任何 React 页面组件
- 不创建 `worker/` 业务逻辑
- 不创建 `prompts/` 目录
- 不创建 `scripts/bootstrap-admin.ts`（属于 B）
- 不创建 `docker/` 文件（属于 F）

---

## 2. 架构决策汇总

| 决策 | 选择 | 理由 |
|------|------|------|
| Schema 组织 | 按领域拆分为 `schema/*.ts` + barrel `schema/index.ts` | 后续工作包可各自维护对应领域 schema，减少共享文件冲突 |
| 时间存储 | ISO 8601 字符串（不用 Drizzle timestamp mode） | 忠实执行 SPEC 第 4.2 节，避免格式歧义 |
| 迁移方式 | 手写 SQL + 自定义运行器 | SPEC 要求纯 SQL 文件，命名 `<timestamp>_<WP>_<desc>.sql` |
| DB 连接 | 单实例单例（非连接池） | better-sqlite3 同步 API，WAL 模式下读写不互斥 |
| UUID | `uuid` 包 `v7()` | 时间有序、类型安全、社区成熟 |
| 额外 PRAGMA | `synchronous=NORMAL`、`cache_size=-20000`、`temp_store=MEMORY` | WAL 模式下性能与安全最佳平衡 |
| 健康端点 | `/api/health/live` 最小实现 | SPEC 第 21.2 节 Docker 健康检查必需 |
| 测试 DB | `:memory:` 为主 + 文件模式补充 | 集成测试 <1s，关键路径文件模式验证 |
| SDK 包名 | `@qoder-ai/qoder-agent-sdk` | 官方文档确认，与 SPEC.md 一致 |
| SDK 中断 | `abortController.abort()` | 官方文档未暴露 `interrupt()` 方法 |

---

## 3. 任务清单

### Task 1: 项目初始化与根配置

**职责**：建立 Next.js + TypeScript strict + Tailwind CSS 项目骨架，锁定依赖版本。

**新建文件**：

| 文件 | 职责 |
|------|------|
| `package.json` | 依赖声明 + 全部 npm scripts |
| `tsconfig.json` | TypeScript strict: true，paths alias `@/*` → `src/*` |
| `next.config.ts` | App Router + `output: 'standalone'` + Node.js runtime |
| `tailwind.config.ts` | 移动端优先，content 路径 `src/**` |
| `postcss.config.mjs` | Tailwind + autoprefixer |
| `.eslintrc.json` | next/core-web-vitals + typescript-eslint strict |
| `.prettierrc` | singleQuote: true, semi: true, trailingComma: 'all', printWidth: 100 |
| `.env.example` | SPEC 第 20 节全部变量（名称+用途+安全说明，无真实值） |
| `.gitignore` | 扩展：node_modules, .next, .env, data/*.sqlite, coverage 等 |
| `src/app/layout.tsx` | 最小根布局（Tailwind 全局样式导入） |
| `src/app/page.tsx` | 占位首页 |
| `data/.gitkeep` | 数据目录占位 |

**依赖安装**：

```
dependencies: next@14, react@18, react-dom@18, better-sqlite3@^11, drizzle-orm@^0.36,
  zod@^3, uuid@^11, tailwindcss@^3, postcss, autoprefixer
devDependencies: typescript@^5, @types/better-sqlite3, @types/node@^22, @types/react@^18,
  @types/uuid, drizzle-kit, vitest, @testing-library/react, eslint, eslint-config-next,
  prettier, tsx
```

**npm scripts**（覆盖 SPEC 第 22.3 节 CI 门禁）：

```json
{
  "dev": "next dev",
  "build": "next build",
  "start": "next start",
  "typecheck": "tsc --noEmit",
  "lint": "next lint",
  "format:check": "prettier --check .",
  "format": "prettier --write .",
  "test:unit": "vitest run --project unit",
  "test:integration": "vitest run --project integration",
  "test:contract": "vitest run --project contract",
  "db:migrate": "tsx src/db/migrate.ts",
  "db:studio": "drizzle-kit studio"
}
```

**TDD 步骤**：
1. 安装依赖后执行 `npx next build` → 预期：构建成功生成 `.next/standalone` 目录
2. 执行 `npm run typecheck` → 预期：无错误

**提交**：`feat(A): initialize Next.js project with TypeScript strict, Tailwind and locked dependencies`

---

### Task 2: Vitest 三层测试框架

**职责**：建立 unit / integration / contract 分层测试配置和目录结构。

**新建文件**：

| 文件 | 职责 |
|------|------|
| `vitest.config.ts` | 定义 unit/integration/contract 三个 project |
| `tests/unit/.gitkeep` | 单元测试目录 |
| `tests/integration/.gitkeep` | 集成测试目录 |
| `tests/contract/.gitkeep` | 契约测试目录 |
| `tests/e2e/.gitkeep` | E2E 测试目录（后续工作包使用） |
| `tests/fixtures/.gitkeep` | 测试 fixture 目录 |

**vitest.config.ts 关键配置**：

```typescript
import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  resolve: { alias: { '@': path.resolve(__dirname, 'src') } },
  test: {
    projects: [
      { test: { name: 'unit', include: ['tests/unit/**/*.test.ts'] } },
      { test: { name: 'integration', include: ['tests/integration/**/*.test.ts'] } },
      { test: { name: 'contract', include: ['tests/contract/**/*.test.ts'] } },
    ],
  },
});
```

**TDD 步骤**：
1. 创建 `tests/unit/smoke.test.ts`：`expect(true).toBe(true)`
2. 执行 `npm run test:unit` → 预期：1 passed
3. 执行 `npm run test:integration` → 预期：0 tests（pass）
4. 执行 `npm run test:contract` → 预期：0 tests（pass）

**提交**：`test(A): configure vitest with unit/integration/contract projects`

---

### Task 3: 环境变量校验 `src/config/env.ts`

**职责**：使用 Zod 校验 SPEC 第 20 节全部环境变量，生产缺少关键变量时拒绝启动。

**新建文件**：`src/config/env.ts`

**设计要点**：
- 生产必须变量：`JWT_ACCESS_SECRET`、`REFRESH_TOKEN_PEPPER`、`IP_HASH_PEPPER`、`QODER_PERSONAL_ACCESS_TOKEN`、`DATABASE_PATH`、`DATA_ROOT`、`WIKI_ROOT`
- 可选带默认值：`NODE_ENV`(development)、`PORT`(3000)、`TZ`(Asia/Shanghai)、`LOG_LEVEL`(info)、`KNOWLEDGE_WORKER_CONCURRENCY`(1)、各超时和上限
- 仅脚本使用：`BOOTSTRAP_ADMIN_USERNAME`、`BOOTSTRAP_ADMIN_PASSWORD`
- Zod parse 失败时输出结构化错误后 `process.exit(1)`
- 生产启动时校验 `DATA_ROOT` 目录写权限

**导出签名**：

```typescript
export const env: {
  readonly NODE_ENV: 'development' | 'test' | 'production';
  readonly APP_BASE_URL: string;
  readonly PORT: number;
  readonly TZ: string;
  readonly DATABASE_PATH: string;
  readonly DATA_ROOT: string;
  readonly WIKI_ROOT: string;
  readonly WIKI_GIT_REMOTE: string | undefined;
  readonly WIKI_GIT_BRANCH: string;
  readonly JWT_ACCESS_SECRET: string;
  readonly REFRESH_TOKEN_PEPPER: string;
  readonly IP_HASH_PEPPER: string;
  readonly QODER_PERSONAL_ACCESS_TOKEN: string;
  readonly QODER_MODEL: string | undefined;
  readonly QODER_CHAT_TIMEOUT_MS: number;
  readonly QODER_CLEAN_TIMEOUT_MS: number;
  readonly IQS_API_BASE_URL: string | undefined;
  readonly IQS_API_KEY: string | undefined;
  readonly KNOWLEDGE_WORKER_CONCURRENCY: number;
  readonly KNOWLEDGE_JOB_LEASE_SECONDS: number;
  readonly UPLOAD_IMAGE_MAX_BYTES: number;
  readonly UPLOAD_KNOWLEDGE_MAX_BYTES: number;
  readonly URL_FETCH_MAX_BYTES: number;
  readonly LOG_LEVEL: string;
  readonly BACKUP_ROOT: string;
}
```

**TDD 步骤**：
1. 失败测试 `tests/unit/config/env.test.ts`：
   - 全部必填变量存在 → `parseEnv()` 返回正确类型
   - 缺少 `JWT_ACCESS_SECRET` → 抛 ZodError
   - `PORT` 非数字 → 抛 ZodError
   - 默认值正确填充（`PORT=3000`、`LOG_LEVEL=info`）
   - Bootstrap 变量仅在显式设置时校验
2. 验证测试失败 → 实现 `env.ts` → 验证全部通过

**提交**：`feat(A): add Zod-validated environment configuration with fail-fast startup`

---

### Task 4: 全局常量与枚举 `src/config/constants.ts`

**职责**：集中定义角色、状态、错误码、分类枚举等全局常量。

**新建文件**：`src/config/constants.ts`

**内容覆盖**（详见计划主文件中完整代码块，含 21 个错误码映射、全部角色/状态/分类枚举）：

- `USER_ROLES` / `USER_STATUSES` / `SESSION_STATUSES`
- `MESSAGE_ROLES` / `MESSAGE_STATUSES`
- `KNOWLEDGE_SOURCE_STATUSES` / `JOB_STATUSES` / `DRAFT_STATUSES`
- `KNOWLEDGE_ITEM_STATUSES` / `WIKI_SYNC_STATUSES`
- `KNOWLEDGE_CATEGORIES`（含 subcategory 映射，SPEC 13.5）
- `RATE_LIMIT_SCOPES`
- `ERROR_CODES`（SPEC 14.6 全部 21 个业务错误码 + HTTP 映射）

**TDD 步骤**：
1. 失败测试 `tests/unit/config/constants.test.ts`
2. 实现 → 验证通过

**提交**：`feat(A): define global constants, enums, error codes and RBAC roles`

---

### Task 5: UUID v7 生成器 `src/lib/uuid.ts`

**新建文件**：`src/lib/uuid.ts`

**导出签名**：`export function generateId(): string;`

**TDD 步骤**：
1. 失败测试 `tests/unit/lib/uuid.test.ts`：36 字符、v7 格式、唯一性、时间有序
2. 实现：`import { v7 as uuidv7 } from 'uuid'; export const generateId = uuidv7;`
3. 验证通过

**提交**：`feat(A): add UUID v7 generator with time-ordering guarantee`

---

### Task 6: 时间工具 `src/lib/datetime.ts`

**新建文件**：`src/lib/datetime.ts`

**导出签名**：

```typescript
export function utcNow(): string;
export function formatForDisplay(isoUtc: string): string; // 预留
```

**TDD 步骤**：
1. 失败测试 `tests/unit/lib/datetime.test.ts`
2. 实现 → 验证通过

**提交**：`feat(A): add UTC datetime utilities`

---

### Task 7: 错误类与统一响应

**新建文件**：
- `src/lib/errors.ts` — `AppError` 类 + `isAppError` 类型守卫
- `src/lib/response.ts` — `successResponse` / `errorResponse` 信封函数

**导出签名**：

```typescript
// src/lib/errors.ts
export class AppError extends Error {
  readonly code: ErrorCode;
  readonly httpStatus: number;
  readonly fields?: Record<string, string>;
  constructor(code: ErrorCode, message?: string, fields?: Record<string, string>);
  static fromCode(code: ErrorCode, message?: string, fields?: Record<string, string>): AppError;
}
export function isAppError(err: unknown): err is AppError;

// src/lib/response.ts
export interface SuccessEnvelope<T> {
  data: T;
  meta: { requestId: string; nextCursor: string | null };
}
export interface ErrorEnvelope {
  error: { code: string; message: string; fields?: Record<string, string> };
  requestId: string;
}
export function successResponse<T>(data: T, meta?: { nextCursor?: string | null }, requestId?: string): SuccessEnvelope<T>;
export function errorResponse(error: AppError, requestId?: string): ErrorEnvelope;
export interface PaginationParams { limit?: number; cursor?: string; }
```

**TDD 步骤**：
1. 失败测试 `tests/unit/lib/errors.test.ts` + `tests/unit/lib/response.test.ts`
2. 实现 → 验证通过

**提交**：`feat(A): add AppError class and standardized response envelopes`

---

### Task 8: Drizzle ORM Schema 定义（按领域拆分）

**新建文件**：

| 文件 | 职责 | 表 |
|------|------|---|
| `src/db/schema/users.ts` | 用户与认证表 | `users`, `refresh_tokens` |
| `src/db/schema/chat.ts` | 聊天相关表 | `chat_sessions`, `messages`, `message_attachments`, `message_sources`, `message_feedback` |
| `src/db/schema/knowledge.ts` | 知识处理表 | `knowledge_sources`, `knowledge_jobs`, `knowledge_drafts`, `knowledge_items` |
| `src/db/schema/admin.ts` | 管理统计表 | `usage_events`, `rate_limit_configs`, `rate_limit_buckets`, `audit_logs`, `system_settings` |
| `src/db/schema/index.ts` | Barrel 导出 | 全部表 + Insert/Select 类型 |

**Schema 设计原则**：
- 所有 ID：`text("id").primaryKey()` — 应用层生成 UUID v7
- 所有时间：`text("xxx_at")` — UTC ISO 8601 字符串
- 金额：`integer("cost_microusd").notNull().default(0)` — 整数微美元
- JSON 列：`text("xxx_json")` — 应用层 Zod 序列化
- CHECK 约束：Drizzle `text("col", { enum: [...] })` + 自定义 `check()` for 数值范围

**索引策略**：

| 表 | 索引 |
|---|---|
| `users` | `username` UNIQUE NOCASE; `status` 索引 |
| `refresh_tokens` | `token_hash` UNIQUE; `user_id` FK; `family_id`; `expires_at` |
| `chat_sessions` | `(user_id, last_message_at)` 复合; `qoder_session_id` |
| `messages` | `(session_id, created_at)` 复合 |
| `message_attachments` | `message_id` FK |
| `message_sources` | `(message_id, ordinal)` 复合 |
| `message_feedback` | `(message_id, user_id)` UNIQUE 复合 |
| `knowledge_sources` | `sha256`; `status`; `submitted_by` FK |
| `knowledge_jobs` | `(status, available_at)` 复合; `source_id` FK; `lease_owner` |
| `knowledge_drafts` | `job_id` UNIQUE FK; `status` |
| `knowledge_items` | `wiki_path` UNIQUE; `(category, subcategory)` 复合; `status` |
| `usage_events` | `(created_at, event_type)` 复合; `user_id`; `session_id` |
| `rate_limit_configs` | `(scope, scope_key)` UNIQUE |
| `rate_limit_buckets` | `(scope_key, window_type, window_start)` UNIQUE |
| `audit_logs` | `(resource, resource_id)` 复合; `created_at`; `actor_id` |
| `system_settings` | `key` UNIQUE |

**TDD 步骤**：
1. 失败测试 `tests/unit/db/schema.test.ts`：16 张表存在、约束正确、类型导出
2. 实现 → 验证通过

**提交**：`feat(A): define complete Drizzle schema for all 16 V1 tables with indexes`

---

### Task 9: SQL 迁移文件与迁移运行器

**新建文件**：
- `src/db/migrations/20260711000000_A_initial_schema.sql` — 全部 16 张表 + 索引 + CHECK 约束 DDL
- `src/db/migrate.ts` — 迁移运行器：扫描、排序、幂等执行、事务包裹
- `drizzle.config.ts` — Drizzle Kit 配置（studio 用）

**迁移运行器设计**：
1. 打开 DB 连接，执行 PRAGMA
2. 创建 `__migrations` 元数据表（IF NOT EXISTS）
3. 扫描 `src/db/migrations/*.sql`，按文件名排序
4. 对比 `__migrations` 已记录，只执行新增的
5. 每个迁移在独立事务中执行
6. 失败时回滚当前事务，终止后续，输出错误

**TDD 步骤**：
1. 失败测试 `tests/integration/db/migrate.test.ts`：空 DB 迁移、幂等、约束验证、级联删除
2. 实现 → 验证通过

**提交**：`feat(A): add initial database migration with all tables, indexes and migration runner`

---

### Task 10: 数据库客户端 `src/db/client.ts`

**新建文件**：`src/db/client.ts`

**PRAGMA 配置**：
- `journal_mode = WAL`
- `foreign_keys = ON`（每连接必须设置）
- `busy_timeout = 5000`
- `synchronous = NORMAL`
- `cache_size = -20000`（20MB 页缓存）
- `temp_store = MEMORY`
- `wal_autocheckpoint = 1000`

**导出签名**：

```typescript
export function getDb(): DrizzleDB<Database>;
export type Db = ReturnType<typeof getDb>;
export function resetDbForTesting(): void;
```

**TDD 步骤**：
1. 失败测试 `tests/integration/db/client.test.ts`
2. 实现 → 验证通过

**提交**：`feat(A): add database client with PRAGMA config, singleton and graceful shutdown`

---

### Task 11: 测试 Helpers

**新建文件**：
- `tests/helpers/test-db.ts` — 内存 SQLite 工厂 + 迁移执行 + 清理
- `tests/helpers/fixtures.ts` — 通用数据生成器

**导出签名**：

```typescript
export function createTestDb(): { db: Db; cleanup: () => void };
export function makeUser(overrides?: Partial<NewUser>): NewUser;
export function makeSession(userId: string, overrides?: Partial<NewChatSession>): NewChatSession;
export function makeMessage(sessionId: string, role: MessageRole, overrides?: Partial<NewMessage>): NewMessage;
```

**提交**：`test(A): add reusable test database factory and fixture generators`

---

### Task 12: 健康端点 + instrumentation

**新建文件**：
- `src/app/api/health/live/route.ts` — `GET` 返回 `{ status: "ok" }`，runtime = 'nodejs'
- `src/instrumentation.ts` — Next.js 启动时自动执行数据库迁移

**提交**：`feat(A): add health live endpoint and auto-migration instrumentation`

---

### Task 13: CI 管线全量验证

```bash
npm run format:check        # 预期：无格式问题
npm run lint                # 预期：无 lint 错误
npm run typecheck           # 预期：strict 类型检查通过
npm run test:unit           # 预期：全部单元测试通过
npm run test:integration    # 预期：全部集成测试通过
npm run test:contract       # 预期：0 tests（pass）
npm run build               # 预期：standalone 构建成功
```

**提交**：`ci(A): verify full CI pipeline passes on greenfield project`

---

## 4. 依赖关系与执行顺序

```
Task 1 (项目初始化)
  ├─→ Task 2 (测试框架)
  ├─→ Task 3 (env.ts)
  ├─→ Task 4 (constants)
  ├─→ Task 5 (uuid)
  └─→ Task 6 (datetime)

Task 3 + Task 4 ──→ Task 7 (errors + response)
Task 1 + Task 4 ──→ Task 8 (schema)
Task 8 ──→ Task 9 (migration SQL + runner)
Task 3 + Task 9 ──→ Task 10 (db client)
Task 8 + Task 9 + Task 10 ──→ Task 11 (test helpers)
Task 10 ──→ Task 12 (health + instrumentation)
All ──→ Task 13 (CI pipeline)
```

**建议并行窗口**：
- Task 2/3/4/5/6 可并行（互不依赖）
- Task 7 可与 Task 8 并行
- Task 11/12 可并行

---

## 5. Git 提交策略

| 序号 | 提交信息 |
|------|---------|
| 1 | `feat(A): initialize Next.js project with TypeScript strict, Tailwind and locked dependencies` |
| 2 | `test(A): configure vitest with unit/integration/contract projects` |
| 3 | `feat(A): add Zod-validated environment configuration with fail-fast startup` |
| 4 | `feat(A): define global constants, enums, error codes and RBAC roles` |
| 5 | `feat(A): add UUID v7 generator with time-ordering guarantee` |
| 6 | `feat(A): add UTC datetime utilities` |
| 7 | `feat(A): add AppError class and standardized response envelopes` |
| 8 | `feat(A): define complete Drizzle schema for all 16 V1 tables with indexes` |
| 9 | `feat(A): add initial database migration with all tables, indexes and migration runner` |
| 10 | `feat(A): add database client with PRAGMA config, singleton and graceful shutdown` |
| 11 | `test(A): add reusable test database factory and fixture generators` |
| 12 | `feat(A): add health live endpoint and auto-migration instrumentation` |
| 13 | `ci(A): verify full CI pipeline passes on greenfield project` |

---

## 6. 工作包 A 完成定义

| 验收条件 | 验证方式 |
|---------|---------|
| 空数据库可迁移到最新版本 | `npm run db:migrate` 从空 DB 执行成功，16 张表全部创建 |
| Schema 约束测试通过 | CHECK、UNIQUE、FK CASCADE、COLLATE NOCASE 全部验证 |
| 开发/测试/生产配置可校验启动 | `npm run build` 成功 + env.ts 校验正确 |
| CI 管线全绿 | format:check → lint → typecheck → test:unit → test:integration → test:contract → build |
| 后续工作包可直接 import 使用 | B/C/D/E 所需的 schema、client、env、errors、uuid、response 全部导出且类型安全 |
| 健康端点可用 | `GET /api/health/live` 返回 `{ status: "ok" }` |

---

## 7. 风险与缓解

| 风险 | 缓解 |
|------|------|
| Node.js 24 vs 22 LTS 兼容性 | Task 1 安装时验证 better-sqlite3 编译；问题则锁定 v22 |
| schema.ts 与 SQL 迁移不同步 | Task 9 集成测试同时验证 schema 类型和实际表结构 |
| SQLite 双进程 BUSY | `busy_timeout=5000` + WAL + Worker 默认单并发 |
| B-F 需要新 npm 依赖 | 各分支自行添加，合并时以 A 的 lockfile 为基准 |
| Drizzle ORM 版本升级 | 锁定精确版本到 package-lock.json |

---

## 8. Rejected Alternatives

| 方案 | 拒绝原因 |
|------|---------|
| Drizzle Kit generate 自动迁移 | SPEC 要求纯 SQL + 自定义命名 |
| 连接池 | better-sqlite3 同步 API 无需连接池 |
| Schema 单文件 | 16 张表单文件过长，后续冲突概率高 |
| Drizzle timestamp mode | 与 SPEC "UTC ISO 8601 存储"冲突 |
| Worktree 并行 | IDE 支持差，branch 方案更简单 |
| `interrupt()` SDK 方法 | 官方文档未暴露，应用 `abortController.abort()` |
