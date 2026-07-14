# iRacing AI 助手

面向 iRacing 新手和中等水平玩家的智能问答助手，基于 Markdown Wiki 知识库 + 双后端 LLM 架构（LLM 直连 / Qoder Agent，可随时切换），帮助用户提升圈速、驾驶稳定性和比赛策略水平。

> **中文友好** · **幻觉可控** · **个性化追问** · **专业知识即时获取**

---

## 产品简介

iRacing AI 助手整合官方文档、权威社区、专业教程等知识源，以中文为主要服务语言，填补国内 iRacing 中文智能问答工具的空白。

### 核心能力

- **智能问答** — BM25 本地检索 + 流式生成，双后端可切换（LLM 直连[默认 LongCat-2.0，≤30s] / Qoder SDK[Qwen3.7-Plus]），含答案缓存
- **多轮对话** — 支持上下文追问，逐步细化用户需求
- **追问引导** — 问题过于宽泛时主动追问，获取赛道/车辆/天气等具体条件
- **幻觉控制** — 知识库中找不到答案时坦诚告知，引导至社区专家
- **图片理解** — 支持上传调校截图，Agent 具备视觉理解能力
- **知识管理** — 支持上传文件/URL → 异步清洗 → **知识评估（启发式+检索探针评分卡）** → 人工审核+反馈 → 带反馈重洗 → 自动发布到 Wiki
- **管理后台** — 用户审批、会话质检、使用统计、限流配置和审计日志

### 目标用户

| 用户类型     | 经验         | 核心诉求                     |
| ------------ | ------------ | ---------------------------- |
| 模拟器新手   | 0～50 小时   | 入门流程、购车建议、赛事体系 |
| 进阶提升玩家 | 50～500 小时 | 降低圈速、理解调校、赛道攻略 |

---

## 技术架构

```
Internet
   │
   ▼
Nginx :443 (HTTPS, Let's Encrypt)
   │
   ▼
PM2 Process Manager (shserver, Ubuntu 24.04)
   ├── iracing-ai-web (Next.js 14 App Router, 512M limit)
   │   ├── H5 + Admin UI (React + Tailwind CSS)
   │   ├── Route Handlers / SSE
   │   ├── Auth / RBAC / Rate Limit
   │   └── Qoder Chat Sessions
   ├── iracing-ai-worker (知识清洗 Worker, 256M limit)
   │   ├── SQLite Job Leasing
   │   ├── File & URL Extraction
   │   ├── Qoder Knowledge Cleaning (支持带反馈重洗)
   │   ├── Knowledge Evaluation (启发式+检索探针，清洗后自动评分)
   │   └── Draft Generation / Publish
   ├── SQLite (/srv/iracing-ai-assistant/data/db/app.sqlite)
   ├── Uploads (/srv/iracing-ai-assistant/data/uploads)
   ├── Drafts (/srv/iracing-ai-assistant/data/drafts)
   └── Wiki (/srv/iracing-ai-assistant/data/md-wiki)
```

### 技术栈

| 层级        | 技术                                  |
| ----------- | ------------------------------------- |
| 语言        | TypeScript（全栈，strict 模式）       |
| 框架        | Next.js 14+ (App Router)              |
| 前端        | React 18 + Tailwind CSS               |
| 校验        | Zod                                   |
| Agent SDK   | `@qoder-ai/qoder-agent-sdk`           |
| 数据库      | SQLite (better-sqlite3) + Drizzle ORM |
| 密码        | bcrypt (cost 12)                      |
| Token       | jose (JWT HS256)                      |
| 文档解析    | mammoth / pdf-parse / xlsx            |
| 本地检索    | minisearch（BM25 + CJK bigram）       |
| 缓存        | lru-cache（L1）+ SQLite（L2）         |
| LLM 直连    | LongCat-2.0（OpenAI 兼容流式）        |
| 测试        | Vitest + Testing Library + Playwright |
| 部署        | PM2 + Nginx + Let's Encrypt           |

### 对话与 Agent 架构

对话答案生成支持双后端，经 `CHAT_ANSWER_BACKEND` 环境变量切换（改值后重启 PM2 生效）：

```
用户提问
   │  答案缓存查询 (query+history hash) ── HIT ──► 回放缓存答案
   │
   ▼ 缓存未命中
   ├── [llm-direct，默认] BM25 本地检索(minisearch) → OpenAI 兼容 LLM 直调流式
   │                        (LongCat-2.0，30s 预算；本地未命中则降级 SDK web-research 60s)
   └── [qoder-sdk] Qoder Agent SDK 全量循环 (Qwen3.7-Plus，120s 预算)
          ├── wiki-search Agent   → Glob/Grep/Read 本地知识检索
          └── web-research Agent  → WebSearch/WebFetch 在线权威站点补充

knowledge-cleaner → 原始文本 → 候选 Markdown（离线 Worker，可带管理员反馈重洗）
```

> 默认走 `llm-direct`（LongCat-2.0，均值 ~15s、≤30s）；`qoder-sdk` 为备选（较慢）。换 LLM 厂商只需改 `.env` 的 `LLM_API_BASE_URL` / `LLM_API_KEY` / `LLM_MODEL` 三项（OpenAI 兼容接口）+ restart。

---

## 知识库

知识库按三大方向组织，存储为结构化 Markdown 文件（含 YAML Front Matter）：

```
md-wiki/
├── track-technique/    # 赛道技术（走线、刹车、轮胎、悬挂）
│   ├── braking/        # 刹车技术
│   └── driving-line/   # 走线与赛车线
├── car-setup/          # 车辆调校（理论、预设、工具）
│   ├── presets/        # 调校预设
│   └── theory/         # 调校理论（轮胎模型、物理引擎）
├── basics/             # 基础知识（入门、购车、赛事、硬件）
│   ├── getting-started/# 新手入门
│   ├── buying-guide/   # 购车指南
│   ├── hardware/       # 硬件设备
│   └── series-and-league/ # 赛事与联赛
└── index.md            # 知识库索引（自动生成）
```

**当前状态**：已初始化 18 篇知识文档，覆盖官方新手指南、iRating 说明、驾照等级、赛车线基础、刹车曲线分析、NTM V7 轮胎模型等核心主题。

### 知识来源

**第一梯队（核心必采）：**

- iRacing 官方 — Support KB、New Racer Guide、Sporting Code
- r/iRacing Reddit — 全球最大 iRacing 社区
- HiPole 嗨跑赛车 — 国内最系统中文入门教程
- Coach Dave Academy — Setup 教学与遥测分析

**第二梯队（重要补充）：**

- Porsche × Max Benecke — 职业车手调校方法论
- iRacing 官方论坛 — 赛道攻略、调校分享、新手问答

详细知识源清单参见 [knowledge-sources.md](./notes/knowledge-sources.md)。

---

## 项目结构

```
src/
├── app/                    # Next.js App Router 页面与 API
│   ├── (public)/           # 登录、注册
│   ├── (app)/              # 聊天、知识库管理
│   ├── (admin)/            # 管理后台
│   └── api/                # 48 个 Route Handlers
├── modules/                # 业务模块（模块化单体）
│   ├── auth/               # 认证与权限
│   ├── users/              # 用户管理
│   ├── chat/               # 聊天与 SSE
│   ├── agent/              # Qoder Agent 集成
│   ├── knowledge/          # 知识处理与发布
│   ├── knowledge-evaluation/ # 知识评估（启发式+检索探针+反馈→重洗回路）
│   ├── jobs/               # 异步任务调度
│   ├── analytics/          # 使用统计
│   └── audit/              # 审计日志
├── components/             # UI 组件
├── db/                     # 数据库 schema 与迁移
├── config/                 # 环境变量与常量
└── lib/                    # 公共工具
worker/                     # 离线知识清洗 Worker（清洗后自动评估）
tests/                      # 单元 / 集成 / 契约 / E2E 测试
config/nginx/                # Nginx 站点配置
scripts/                    # 运维脚本
├── deploy.sh             # 生产部署（git pull + build + PM2 restart）
├── backup.sh             # 数据库备份
├── restore.sh            # 数据库恢复
├── bootstrap-admin.ts    # 初始化管理员
├── seed-wiki.ts          # 知识库种子清洗（LLM API 优先，Qoder SDK 兜底）
├── validate-wiki.ts      # Wiki 文件 Front Matter 验证
├── rebuild-index.ts      # 重建 index.md 索引
├── test-model.ts         # LLM 模型可用性测试
└── smoke-eval.ts         # 知识评估仓库层端到端 smoke（真实 DB）
```

---

## 快速开始

### 环境要求

- Node.js 22+
- npm

### 安装与开发

```bash
# 克隆仓库
git clone https://github.com/shuifans/iracing-ai-assistant.git
cd iracing-ai-assistant

# 安装依赖
npm install

# 复制环境变量
cp .env.example .env

# 运行数据库迁移
npm run db:migrate

# 启动开发服务器
npm run dev
```

### 常用命令

| 命令                   | 说明                 |
| ---------------------- | -------------------- |
| `npm run dev`          | 启动开发服务器       |
| `npm run build`        | 生产构建             |
| `npm run typecheck`    | TypeScript 类型检查  |
| `npm run lint`         | ESLint 检查          |
| `npm run format`       | Prettier 格式化      |
| `npm run test:unit`    | 运行单元测试         |
| `npm run test:integration` | 运行集成测试     |
| `npm run db:migrate`   | 执行数据库迁移       |
| `npm run db:studio`    | Drizzle 数据库管理台 |
| `npm run build:search-index` | 重建 BM25 搜索索引（data/search-index.json） |
| `npm run eval:chat`    | 多轮对话 AI 测评（eval-chat.ts） |

### 知识库脚本

| 命令                                          | 说明                           |
| --------------------------------------------- | ------------------------------ |
| `npx tsx scripts/seed-wiki.ts`                | 抓取 URL 并清洗为 Wiki 文档    |
| `npx tsx scripts/seed-wiki.ts --dry-run`     | 仅抓取不清洗，验证 URL 可用性  |
| `npx tsx scripts/seed-wiki.ts --force`       | 强制重刷已有内容               |
| `npx tsx scripts/validate-wiki.ts`           | 验证所有 Wiki 文件格式         |
| `npx tsx scripts/rebuild-index.ts`           | 重建 index.md                  |
| `npx tsx scripts/test-model.ts`              | 测试 LLM 模型连通性            |
| `npx tsx scripts/smoke-eval.ts`               | 知识评估仓库层端到端 smoke     |

---

## 部署

| 项目   | 说明                         |
| ------ | ---------------------------- |
| 部署        | PM2 + Nginx + Let's Encrypt   |

详细部署文档参见 [docs/deployment.md](./docs/deployment.md)。

---

### 生产服务器

| 项目   | 说明                                      |
| ------ | ----------------------------------------- |
| 服务器 | shserver (106.14.113.247, 上海阿里云)     |
| 域名   | `ai.iracing.club`                         |
| HTTPS  | Let's Encrypt (Certbot, 自动续期)         |
| 部署   | PM2 (`ecosystem.config.cjs`) + Nginx      |
| 系统   | Ubuntu 24.04 + Node.js 22 + 2G Swap       |

> 2026-07-13 从 hkserver 迁移至 shserver（独立服务器），解决 Docker 容器资源竞争影响主站的问题。

---

## 项目状态

当前处于 **V1 MVP 开发阶段**，详细产品需求参见 [PRD.md](./PRD.md)，技术规范参见 [SPEC.md](./SPEC.md)。

### V1 核心功能

- [x] 产品需求文档 (PRD) 与技术规范 (SPEC)
- [x] 知识源梳理
- [x] 项目初始化与基础框架搭建
- [x] 数据库 schema 与迁移（用户、聊天、知识、审计、统计）
- [x] 认证系统（注册/审批/登录/JWT/Refresh Token 轮换）
- [x] RBAC 三角色权限（user / knowledge_admin / admin）
- [x] 聊天系统（多轮对话、SSE 流式输出、停止/重试、图片上传）
- [x] Qoder Agent SDK 集成（wiki-search / web-research / knowledge-cleaner）
- [x] 知识管理（文件/URL 上传 → 异步清洗 → 审核 → 发布 → Git 版本化）
- [x] 知识评估与反馈回路（9 维评分卡：Front Matter/长度/标签/查重/时效/可检索性；管理员反馈 → 带反馈重洗 → 版本链；可选发布门禁）
- [x] 管理后台（用户管理、会话质检、统计、限流、审计日志）
- [x] 离线 Worker（知识清洗任务调度、租约、重试）
- [x] PM2 部署配置（ecosystem.config.cjs、Nginx）
- [x] 运维脚本（备份、恢复、引导管理员）
- [x] md-wiki 知识库内容初始化（18 篇，覆盖官方指南、驾驶技术、调校理论）
- [x] 对话双后端（LLM 直连 / Qoder SDK 可切换，默认 LongCat-2.0）+ BM25 本地检索 + 双层缓存
- [x] E2E 测试完善
- [x] 生产部署上线与验收（shserver，PM2 + Nginx）

---

## 许可证

Private
