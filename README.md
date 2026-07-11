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

| 用户类型 | 经验 | 核心诉求 |
|---------|------|---------|
| 模拟器新手 | 0～50 小时 | 入门流程、购车建议、赛事体系 |
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

| 层级 | 技术 |
|------|------|
| 语言 | TypeScript（全栈） |
| 框架 | Next.js 14+ (App Router) |
| 前端 | React + Tailwind CSS |
| Agent SDK | `@qoder-ai/qoder-agent-sdk` |
| 数据库 | SQLite (better-sqlite3) |
| 部署 | Docker + Nginx |

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

| 项目 | 说明 |
|------|------|
| 服务器 | hkserver (8.218.234.193) |
| 域名 | `ai.iracing.club` |
| HTTPS | 复用 `iracing.club` SSL 证书 |

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
