# iRacing AI 助手

面向 iRacing 新手和中等水平玩家的智能问答助手，基于 Markdown Wiki 知识库 + Qoder Agent 架构，帮助用户提升圈速、驾驶稳定性和比赛策略水平。

> **中文友好** · **幻觉可控** · **个性化追问** · **专业知识即时获取**

---

## 产品简介

iRacing AI 助手整合官方文档、权威社区、专业教程等知识源，以中文为主要服务语言，填补国内 iRacing 中文智能问答工具的空白。

### 核心能力

- **智能问答** — 基于本地 Markdown Wiki + 在线权威站点的混合检索，生成精准中文回答
- **多轮对话** — 支持上下文追问，逐步细化用户需求
- **追问引导** — 问题过于宽泛时主动追问，获取赛道/车辆/天气等具体条件
- **幻觉控制** — 知识库中找不到答案时坦诚告知，引导至社区专家
- **图片理解** — 支持上传调校截图，Agent 具备视觉理解能力
- **知识管理** — 支持上传文件/URL → 异步清洗 → 人工审核 → 自动发布到 Wiki
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
Nginx :443 (HTTPS)
   │
   ▼
Docker: iracing-ai-assistant
   ├── Web process (Next.js 14 App Router)
   │   ├── H5 + Admin UI (React + Tailwind CSS)
   │   ├── Route Handlers / SSE
   │   ├── Auth / RBAC / Rate Limit
   │   └── Qoder Chat Sessions
   ├── Worker process
   │   ├── SQLite Job Leasing
   │   ├── File & URL Extraction
   │   ├── Qoder Knowledge Cleaning
   │   └── Draft Generation / Publish
   ├── SQLite (/data/db/app.sqlite)
   ├── Uploads (/data/uploads)
   ├── Drafts (/data/drafts)
   └── Wiki Git Worktree (/data/md-wiki)
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
| 测试        | Vitest + Testing Library + Playwright |
| 部署        | Docker Compose + Nginx                |

### Agent 架构

```
主 Agent（对话管理 + 回答生成）
├── wiki-search Agent   → Glob/Grep/Read 本地知识检索
├── web-research Agent  → WebSearch/WebFetch 在线权威站点补充
└── knowledge-cleaner   → 原始文本 → 候选 Markdown（离线 Worker）
```

---

## 知识库

知识库按三大方向组织，存储为结构化 Markdown 文件：

```
md-wiki/
├── track-technique/    # 赛道技术（走线、刹车、轮胎、悬挂）
├── car-setup/          # 车辆调校（理论、实操、工具）
├── basics/             # 基础知识（入门、购车、赛事、硬件）
└── index.md            # 知识库索引
```

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
│   ├── jobs/               # 异步任务调度
│   ├── analytics/          # 使用统计
│   └── audit/              # 审计日志
├── components/             # UI 组件
├── db/                     # 数据库 schema 与迁移
├── config/                 # 环境变量与常量
└── lib/                    # 公共工具
worker/                     # 离线知识清洗 Worker
tests/                      # 单元 / 集成 / 契约 / E2E 测试
docker/                     # Dockerfile + Compose + Nginx
scripts/                    # 运维脚本（备份、恢复、引导管理员）
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

---

## 部署

| 项目   | 说明                         |
| ------ | ---------------------------- |
| 服务器 | hkserver (8.218.234.193)     |
| 域名   | `ai.iracing.club`            |
| HTTPS  | 复用 `iracing.club` SSL 证书 |
| 方式   | Docker Compose + Nginx       |

详细部署文档参见 [docs/deployment.md](./docs/deployment.md)。

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
- [x] 管理后台（用户管理、会话质检、统计、限流、审计日志）
- [x] 离线 Worker（知识清洗任务调度、租约、重试）
- [x] Docker 部署配置（Dockerfile、Compose、Nginx）
- [x] 运维脚本（备份、恢复、引导管理员）
- [ ] md-wiki 知识库内容初始化
- [ ] E2E 测试完善
- [ ] 生产部署上线与验收

---

## 许可证

Private
# iRacing AI 助手

面向 iRacing 新手和中等水平玩家的智能问答助手，基于 Markdown Wiki 知识库 + Agent 架构，帮助用户提升圈速、驾驶稳定性和比赛策略水平。

> **中文友好** · **幻觉可控** · **个性化追问** · **专业知识即时获取**

---

## 产品简介

iRacing AI 助手整合官方文档、权威社区、专业教程等知识源，以中文为主要服务语言，填补国内 iRacing 中文智能问答工具的空白。

### 核心能力

- **智能问答** — 基于本地 Markdown Wiki + 在线权威站点的混合检索，生成精准中文回答
- **多轮对话** — 支持上下文追问，逐步细化用户需求
- **追问引导** — 问题过于宽泛时主动追问，获取赛道/车辆/天气等具体条件
- **幻觉控制** — 知识库中找不到答案时坦诚告知，引导至社区专家
- **图片理解** — 支持上传调校截图，Agent 具备视觉理解能力

### 目标用户

| 用户类型     | 经验         | 核心诉求                     |
| ------------ | ------------ | ---------------------------- |
| 模拟器新手   | 0～50 小时   | 入门流程、购车建议、赛事体系 |
| 进阶提升玩家 | 50～500 小时 | 降低圈速、理解调校、赛道攻略 |

---

## 技术架构

```
┌─────────────┐
│   Nginx     │
│  (HTTPS)    │
└──────┬──────┘
       │
┌──────┴──────┐
│  Next.js 14 │
│  App Server │
└──────┬──────┘
       │
 ┌─────┼──────────┐
 │     │          │
┌┴────┐ ┌───┐ ┌──┴─────┐
│SQLite│ │md │ │ Qoder  │
│  DB  │ │wiki│ │ Agent  │
│      │ │   │ │  SDK   │
└─────┘ └───┘ └────────┘
```

### 技术栈

| 层级      | 技术                        |
| --------- | --------------------------- |
| 语言      | TypeScript（全栈）          |
| 框架      | Next.js 14+ (App Router)    |
| 前端      | React + Tailwind CSS        |
| Agent SDK | `@qoder-ai/qoder-agent-sdk` |
| 数据库    | SQLite (better-sqlite3)     |
| 部署      | Docker + Nginx              |

### Agent 架构

```
主 Agent（对话管理 + 回答生成）
├── md-wiki 检索 Agent  → Grep/Glob/Read 本地知识检索
└── 网页采集 Agent      → WebFetch 在线权威站点补充
```

---

## 知识库

知识库按三大方向组织，存储为结构化 Markdown 文件：

```
md-wiki/
├── track-technique/    # 赛道技术（走线、刹车、轮胎、悬挂）
├── car-setup/          # 车辆调校（理论、实操、工具）
├── basics/             # 基础知识（入门、购车、赛事、硬件）
└── index.md            # 知识库索引
```

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

## 部署

| 项目   | 说明                         |
| ------ | ---------------------------- |
| 服务器 | hkserver (8.218.234.193)     |
| 域名   | `ai.iracing.club`            |
| HTTPS  | 复用 `iracing.club` SSL 证书 |

---

## 项目状态

当前处于 **V1 MVP 开发阶段**，详细产品需求参见 [PRD.md](./PRD.md)。

### V1 核心功能

- [x] 产品需求文档 (PRD)
- [x] 知识源梳理
- [ ] 项目初始化与基础框架搭建
- [ ] md-wiki 知识库初始化
- [ ] 核心问答系统（Agent + 流式输出）
- [ ] 用户系统（注册/审批/登录）
- [ ] 管理后台
- [ ] Docker 部署上线

---

## 许可证

Private
