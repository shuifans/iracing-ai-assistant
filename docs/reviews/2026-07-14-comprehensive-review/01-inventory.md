# 代码库与运行资产清单

## 1. 审计基线

| 项目 | 值 |
|---|---|
| 审计日期 | 2026-07-14（Asia/Shanghai） |
| Git 分支 | `master`，跟踪 `origin/master` |
| 基线提交 | `b6bdc5869d5365c920a7c636a297a0c9572c1126` |
| 基线提交说明 | `fix(knowledge): 对齐 qoder-sdk 清洗提示词与 llm-direct（补 Front Matter 格式）` |
| 产品阶段 | README 标注为 V1 MVP，已有生产部署配置 |
| 审计改动范围 | 仅 `docs/reviews/2026-07-14-comprehensive-review/` |

基线代码约 42,532 行 TypeScript/TSX：`src/modules` 约 10,579 行、`src/app` 约 7,236 行、`src/components` 约 4,558 行、`worker` 约 622 行、`scripts` 约 1,742 行、`tests` 约 16,372 行。

## 2. 技术栈与版本

| 层 | 主要组件 |
|---|---|
| Web | Next.js `14.2.35` App Router、React `18.3.1`、Tailwind CSS 3 |
| 语言/校验 | TypeScript 5.9 strict、Zod 4 |
| 数据 | SQLite、better-sqlite3、Drizzle ORM/Kit |
| Agent | `@qoder-ai/qoder-agent-sdk` 1.0.13 |
| LLM 直连 | OpenAI-compatible `/v1/chat/completions`；默认模型名 LongCat-2.0 |
| 检索/缓存 | MiniSearch BM25 + CJK bigram；进程内 LRU + SQLite L2 |
| 文档处理 | mammoth、pdf-parse、SheetJS `xlsx`、Readability/JSDOM |
| 认证 | jose JWT HS256、随机不透明 Refresh Token、bcrypt |
| 测试 | Vitest 4、Testing Library、Playwright |
| 生产运行 | PM2 双进程、Nginx、Next standalone |

依赖存在明显版本错位：运行时 Next.js 为 14.2.35，但 `eslint-config-next` 为 16.2.10。生产依赖中 Next.js 和 `xlsx` 均被 `npm audit` 标为高危，详见 `05-verification-log.md`。

## 3. 进程与入口

| 进程/入口 | 文件 | 职责 |
|---|---|---|
| Next Web | `src/app/**` | 页面、Route Handlers、SSE、认证、管理后台 |
| Instrumentation | `src/instrumentation.ts` | Web 启动期数据库迁移 |
| Knowledge Worker | `worker/index.ts` | 轮询 SQLite 队列、租约/心跳、知识抽取清洗与评估 |
| PM2 | `ecosystem.config.cjs` | 启动 Web 与 worker，各 1 实例 |
| Nginx | `config/nginx/ai.iracing.club.conf` | HTTPS 反代与 SSE 配置 |
| DB migration | `src/db/migrate.ts` | SQL 文件迁移、校验与回滚入口 |
| 运维 | `scripts/*.sh`、`scripts/*.ts` | 部署、备份、恢复、初始化、索引、评测 |

## 4. 目录与模块

- `src/app/`：14 个页面，58 个 API route 文件。
- `src/modules/auth`：登录、注册、JWT、Refresh Token 轮换、RBAC/Origin 守卫。
- `src/modules/chat`：会话/消息持久化、SSE 编排、双层缓存、历史上下文。
- `src/modules/agent`：Qoder Agent 工厂、OpenAI-compatible 流式客户端、静态提示词。
- `src/modules/knowledge`：上传、URL 抽取、Front Matter、Wiki 检索/索引、发布。
- `src/modules/knowledge-evaluation`：启发式/检索探针评估、反馈与重洗版本链。
- `src/modules/jobs`：知识任务状态机、CAS 租约、重试/恢复。
- `src/modules/users`：用户审批、禁用、角色、删除。
- `src/modules/rate-limit`：限流配置与计数器；当前未接入任何业务入口。
- `src/modules/analytics`、`audit`：用量统计与管理操作审计。
- `worker/`：单个顺序 lease loop 与知识处理器。
- `data/md-wiki/`：18 篇 Markdown 知识文档及 `index.md`。

## 5. API 面

58 个 Route Handlers 可分为：

- 认证 5 个：login/register/logout/refresh/me。
- 聊天 10 个：会话、消息发送、停止、重试、反馈、诊断、图片上传。
- 管理后台 18 个：用户、会话质检、统计、限流、审计、健康。
- 知识管理 23 个：来源、任务、草稿、评估、反馈、重洗、发布、归档、Git 重试。
- 公共健康检查 2 个：live/ready。

绝大多数状态修改接口调用 `validateOrigin`；`POST /api/chat/diagnostic` 是例外，且仅要求普通 active 用户。

## 6. 数据模型

SQLite 共 20 张表：

- 身份：`users`、`refresh_tokens`。
- 聊天：`chat_sessions`、`messages`、`message_attachments`、`message_sources`、`message_feedback`。
- 知识：`knowledge_sources`、`knowledge_jobs`、`knowledge_drafts`、`knowledge_items`。
- 评估：`knowledge_evaluations`、`evaluation_dimensions`、`evaluation_feedback`。
- 运维：`usage_events`、`rate_limit_configs`、`rate_limit_buckets`、`audit_logs`、`system_settings`。
- 缓存：`retrieval_cache`。

迁移顺序：A 初始 16 表 → B 检索缓存 → C 评估三表及 job/draft 版本字段。

## 7. 持久化与外部依赖

| 资产 | 配置/默认 |
|---|---|
| SQLite | `DATABASE_PATH`；生产示例 `/srv/iracing-ai-assistant/data/db/app.sqlite` |
| 数据根 | `DATA_ROOT`；上传、抽取结果、草稿、备份 |
| Wiki | `WIKI_ROOT`；独立 Git 工作区 |
| Git remote | `WIKI_GIT_REMOTE` + `WIKI_GIT_BRANCH` |
| Qoder | PAT、可选模型、聊天/清洗超时 |
| LLM direct | `LLM_*`，聊天可回退 `LONGCAT_*`；清洗按 provider 列表解析 |
| IQS | 环境变量存在，但代码中未发现实际调用 |

## 8. 测试资产

| 分层 | 文件/结果 |
|---|---|
| Unit | 68 文件；857 项通过 |
| Integration | 7 文件；59 项通过 |
| Contract | 配置存在，但 `tests/contract` 无测试；因 `passWithNoTests` 返回成功 |
| Vitest e2e project | `tests/e2e` 4 文件，未配置 npm script |
| Browser E2E | Playwright 2 个 spec（admin/knowledge） |

高测试数量主要覆盖模块内正常路径；当前缺少跨模块不变量测试，例如“任务进入人工审核后不得被租约恢复”“附件先上传后绑定消息”“发布状态必须匹配 DB CHECK”“限流必须在生成前执行”。

## 9. 运维资产一致性

- README/部署文档要求先备份、dry-run migration、再迁移；`scripts/deploy.sh` 实际直接 `git pull → npm ci → build → migrate → restart`，没有调用安全迁移脚本。
- `pre-deploy-migrate.sh` 默认数据库路径为 `/data/db/app.sqlite`，而 `.env.example`/正式部署文档为 `/srv/iracing-ai-assistant/data/db/app.sqlite`；未导出 `.env` 时可能操作错误数据库。
- Next standalone 需要手工复制静态资源、SQL migration 和 bcrypt prebuild，部署脚本已处理；worker 仍以源码 + `tsx` 运行。
