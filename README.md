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
- **知识管理** — 上传文件/URL → 异步清洗（默认 LongCat，可经后台密码门禁切换 Qwen3.7-Plus）→ **知识评估（启发式+检索探针评分卡）** → 人工审核+反馈 → 带反馈重洗 → 原子发布到 Wiki。管理后台含**概览仪表盘**（待审核/已发布/已归档/重洗用量统计卡片 + 分类/等级/审核队列/重洗版本分布图）、**候选稿列表**（待审核草稿按等级/状态过滤）、**已发布条目正文查看**、**派生修订草稿**（已发布条目→派生新草稿→review/编辑/重洗→批准原地覆盖旧条目，保留 wikiPath 唯一约束与 git 历史）、**LLM 重洗软上限提示**（从首次重洗起提示 token 消耗、引导一次性描述清楚修改要求，随次数递进、不硬禁）
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
   ├── iracing-ai-web (Next.js 15 App Router, 512M limit)
   │   ├── H5 + Admin UI (React + Tailwind CSS)
   │   ├── Route Handlers / SSE
   │   ├── Auth / RBAC / Rate Limit
   │   └── Qoder Chat Sessions
   ├── iracing-ai-worker (知识清洗 Worker, 256M limit)
   │   ├── SQLite Job Leasing
   │   ├── File & URL Extraction
   │   ├── Knowledge Cleaning (默认 LongCat LLM 直连；可经后台密码门禁切换 Qoder SDK)
   │   ├── Knowledge Evaluation (启发式+检索探针，清洗后自动评分)
   │   └── Draft Generation / Publish
   ├── SQLite (/srv/iracing-ai-assistant/data/db/app.sqlite)
   ├── Uploads (/srv/iracing-ai-assistant/data/uploads)
   ├── Drafts (/srv/iracing-ai-assistant/data/drafts)
   └── Wiki (/srv/iracing-ai-assistant/data/md-wiki)
```

### 技术栈

| 层级      | 技术                                                |
| --------- | --------------------------------------------------- |
| 语言      | TypeScript（全栈，strict 模式）                     |
| 框架      | Next.js 15.5.20 (App Router)                        |
| 前端      | React 19.2.7 + Tailwind CSS                         |
| 校验      | Zod                                                 |
| Agent SDK | `@qoder-ai/qoder-agent-sdk`                         |
| 数据库    | SQLite (better-sqlite3) + Drizzle ORM               |
| 密码      | bcrypt (cost 12)                                    |
| Token     | jose (JWT HS256)                                    |
| 文档解析  | mammoth / pdf-parse / read-excel-file（仅 `.xlsx`） |
| 本地检索  | minisearch（BM25 + CJK bigram）                     |
| 缓存      | lru-cache（L1）+ SQLite（L2）                       |
| LLM 直连  | LongCat-2.0（OpenAI 兼容流式）                      |
| 测试      | Vitest + Testing Library + Playwright               |
| 部署      | PM2 + Nginx + Let's Encrypt                         |

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
   清洗后端默认走 LLM 直连(LongCat-2.0)；可在知识管理后台经"清洗模型"按钮
   密码门禁切换为 Qoder SDK(Qwen3.7-Plus)。切换写入 system_settings(knowledge.cleaning_backend)，
   Worker 按任务读取，对下一个清洗任务生效（无需重启 PM2）。严格二选一不降级：
   选中后端失败即失败该任务，不跨后端回退。
```

> **对话答案**默认走 `llm-direct`（LongCat-2.0，均值 ~15s、≤30s）；`qoder-sdk` 为备选（较慢）。换 LLM 厂商只需改 `.env` 的 `LLM_API_BASE_URL` / `LLM_API_KEY` / `LLM_MODEL` 三项（OpenAI 兼容接口）+ restart。
>
> **知识清洗**默认 LongCat（llm-direct），经管理后台密码门禁运行时切换 Qoder SDK。切换密码存 `MODEL_SWITCH_PASSWORD_HASH`（bcrypt 哈希，cost 12），明文不入仓库；其它管理员无密码故只能用默认 LongCat。

### 安全与可靠性边界

- **发布一致性**：知识发布使用 argv 形式调用 Git；SQLite 发布状态在事务内提交，异步 push 通过 commit SHA + 状态 CAS 防止旧回调覆盖新发布。
- **聊天保护**：global / role / user 限流在共享聊天入口原子执行；诊断接口仅管理员可用并验证 Origin；停止生成会校验消息所属会话。
- **图片附件**：上传记录带 owner 和过期时间，发送时与 user message 原子绑定；最多 4 张、总计 20 MiB，Direct 与 Qoder 均接收真实图片输入，图片回答不进入共享文本缓存。
- **Agent 工具边界**：WebSearch、WebFetch 与 Wiki 文件访问分别验证；Qoder hook 和聊天消费端共用 Zod evidence envelope。
- **渲染安全**：聊天与管理员会话共用 Markdown sanitizer，只允许安全标签、属性和 HTTP(S)/站内相对链接。
- **URL 抽取**：采用 IPv4-only 出站策略；校验全部 A 记录并把通过验证的 IP 固定到实际 TLS socket，每次重定向重新校验，总 deadline 覆盖完整响应体。

完整审计、架构、提示词与修复证据见 [2026-07-14 全面 Review](./docs/reviews/2026-07-14-comprehensive-review/README.md)。

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
│   └── api/                # 58 个 Route Handlers
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

| 命令                         | 说明                                         |
| ---------------------------- | -------------------------------------------- |
| `npm run dev`                | 启动开发服务器                               |
| `npm run build`              | 生产构建                                     |
| `npm run typecheck`          | TypeScript 类型检查                          |
| `npm run lint`               | ESLint 检查                                  |
| `npm run format`             | Prettier 格式化                              |
| `npm run test:unit`          | 运行单元测试                                 |
| `npm run test:integration`   | 运行集成测试                                 |
| `npm run db:migrate`         | 执行数据库迁移                               |
| `npm run db:studio`          | Drizzle 数据库管理台                         |
| `npm run build:search-index` | 重建 BM25 搜索索引（data/search-index.json） |
| `npm run eval:chat`          | 多轮对话 AI 测评（eval-chat.ts）             |

### 知识库脚本

| 命令                                     | 说明                          |
| ---------------------------------------- | ----------------------------- |
| `npx tsx scripts/seed-wiki.ts`           | 抓取 URL 并清洗为 Wiki 文档   |
| `npx tsx scripts/seed-wiki.ts --dry-run` | 仅抓取不清洗，验证 URL 可用性 |
| `npx tsx scripts/seed-wiki.ts --force`   | 强制重刷已有内容              |
| `npx tsx scripts/validate-wiki.ts`       | 验证所有 Wiki 文件格式        |
| `npx tsx scripts/rebuild-index.ts`       | 重建 index.md                 |
| `npx tsx scripts/test-model.ts`          | 测试 LLM 模型连通性           |
| `npx tsx scripts/smoke-eval.ts`          | 知识评估仓库层端到端 smoke    |

---

## 部署

| 项目 | 说明                        |
| ---- | --------------------------- |
| 部署 | PM2 + Nginx + Let's Encrypt |

详细部署文档参见 [docs/deployment.md](./docs/deployment.md)。

### 开发、推送与生产部署

| 节点     | 目录                                                | 职责                                                  |
| -------- | --------------------------------------------------- | ----------------------------------------------------- |
| 本机     | `/Users/judehuang/ai-projects/iracing-ai-assistant` | 日常开发和验证；允许 `git pull`，不得直接 push GitHub |
| sgserver | `/home/admin/ai-projects/iracing-ai-assistant`      | GitHub push 中转与远端开发工作区                      |
| shserver | `/opt/iracing-ai-assistant`                         | `ai.iracing.club` 生产运行目录                        |

发布顺序：本机完成测试和 reviewed commit → 同步到 sgserver 并由 sgserver push GitHub → shserver 备份、拉取该 commit、migration dry-run、构建、迁移、PM2 restart → readiness 与公网 smoke 检查。本机禁止直接执行 `git push`。

---

### 生产服务器

| 项目   | 说明                                  |
| ------ | ------------------------------------- |
| 服务器 | shserver (106.14.113.247, 上海阿里云) |
| 域名   | `ai.iracing.club`                     |
| HTTPS  | Let's Encrypt (Certbot, 自动续期)     |
| 部署   | PM2 (`ecosystem.config.cjs`) + Nginx  |
| 系统   | Ubuntu 24.04 + Node.js 22 + 2G Swap   |

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
- [x] 聊天气泡排版优化（AI/用户消息行高统一为 1.65 倍，段落/标题/列表间距收紧，单换行行高不再跳变）
- [x] Qoder Agent SDK 集成（wiki-search / web-research / knowledge-cleaner）
- [x] 知识管理（文件/URL 上传 → 异步清洗 → 审核 → 发布 → Git 版本化）
- [x] 知识评估与反馈回路（9 维评分卡：Front Matter/长度/标签/查重/时效/可检索性；管理员反馈 → 带反馈重洗 → 版本链；可选发布门禁）
- [x] 管理后台（用户管理、会话质检、统计、限流、审计日志）
- [x] 离线 Worker（知识清洗任务调度、租约、重试）
- [x] PM2 部署配置（ecosystem.config.cjs、Nginx）
- [x] 运维脚本（备份、恢复、引导管理员）
- [x] md-wiki 知识库内容初始化（18 篇，覆盖官方指南、驾驶技术、调校理论）
- [x] 对话双后端（LLM 直连 / Qoder SDK 可切换，默认 LongCat-2.0）+ BM25 本地检索 + 双层缓存
- [x] 知识清洗模型密码门禁切换（默认 LongCat LLM 直连，后台可经密码切换 Qwen3.7-Plus；DB 驱动运行时生效）
- [x] 知识清洗双后端提示词对齐（qoder-sdk 的 KNOWLEDGE_CLEANER_PROMPT 与 llm-direct 的 buildCleanerSystemPrompt 统一要求 Front Matter 输出格式，消除切换后端时 parseFrontMatter 失败隐患）
- [x] 知识库管理后台增强（概览仪表盘 + 候选稿列表 + 已发布条目正文查看 + 派生修订草稿流 + LLM 重洗软上限提示）
- [x] 知识修订闭环（已发布条目→派生修订草稿→审核/编辑/重洗→原子发布原地覆盖旧条目，保留 wikiPath 唯一约束与 git 历史；复用未接线的原子 publisher）
- [x] E2E 测试完善
- [x] 生产部署上线与验收（shserver，PM2 + Nginx）
- [x] P0/P1 全面安全修复（发布、租约、附件、限流、Agent evidence、Markdown、依赖与 DNS pinning）及多代理复审

---

## 许可证

Private
