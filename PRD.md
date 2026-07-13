# iRacing AI 助手 — 产品需求文档 (PRD)

> **版本**：V1.0  
> **更新日期**：2026-07-11  
> **状态**：Draft

---

## 目录

1. [产品概述](#1-产品概述)
2. [产品形态与发布渠道](#2-产品形态与发布渠道)
3. [功能需求](#3-功能需求)
4. [技术架构](#4-技术架构)
5. [非功能需求](#5-非功能需求)
6. [产品路线图](#6-产品路线图)
7. [风险与注意事项](#7-风险与注意事项)
8. [附录](#8-附录)

---

## 1. 产品概述

### 1.1 产品名称

**iRacing AI 助手**

### 1.2 产品定位

面向 iRacing 新手和中等水平玩家的智能问答助手，基于 Markdown Wiki 知识库 + Agent 架构，帮助用户提升圈速、驾驶稳定性和比赛策略水平。产品以中文为主要服务语言，填补国内 iRacing 中文智能问答工具的空白。

### 1.3 目标用户画像

#### 用户画像 A：模拟器新手玩家

| 维度         | 描述                                                                                                            |
| ------------ | --------------------------------------------------------------------------------------------------------------- |
| **背景**     | 刚入坑或正在观望是否入坑 iRacing 的赛车模拟器新手                                                               |
| **经验**     | 0～50 小时模拟器经验，可能玩过 Assetto Corsa、F1 系列等其他赛车游戏                                             |
| **痛点**     | iRacing 订阅费用高、车辆/赛道购买策略不明确；不熟悉赛事规则和安全评级（SR/iRating）体系；不知如何开始第一场比赛 |
| **核心诉求** | 快速了解 iRacing 入门流程、性价比购车/购赛道建议、赛事体系介绍                                                  |
| **典型问题** | "新手应该先买哪些车？""Rookie 系列怎么升 D 级？""iRacing 一个月多少钱？"                                        |

#### 用户画像 B：进阶提升玩家

| 维度         | 描述                                                                                             |
| ------------ | ------------------------------------------------------------------------------------------------ |
| **背景**     | 已有数百小时 iRacing 经验，有一定赛车游戏基础                                                    |
| **经验**     | 50～500 小时，已完成 Rookie 晋级，正在参加 D/C 级赛事                                            |
| **痛点**     | 圈速卡在瓶颈期无法突破；不理解调校参数含义，只会用别人的 Setup；不同赛道刹车点、走线缺乏系统参考 |
| **核心诉求** | 降低单圈圈速、提高比赛稳定性、理解调校逻辑、学习赛道攻略                                         |
| **典型问题** | "Spa 赛道 Eau Rouge 怎么过？""GT3 车辆胎压应该设多少？""刹车太重怎么调？"                        |

### 1.4 核心价值主张

1. **专业知识即时获取**：整合官方文档、权威社区、专业教程等知识源，用户无需翻阅大量英文资料即可获得精准回答
2. **个性化追问引导**：通过多轮对话和追问细化，根据用户的赛道、车辆、天气等具体条件给出针对性建议
3. **幻觉可控**：知识库中找不到答案时坦诚告知，并引导用户至社区专家，避免错误调校建议误导玩家
4. **中文友好**：填补 iRacing 中文智能问答的空白，降低语言门槛

---

## 2. 产品形态与发布渠道

### 2.1 V1 产品形态

| 项目         | 说明                                                        |
| ------------ | ----------------------------------------------------------- |
| **形态**     | H5 移动端页面（响应式 Web 应用）                            |
| **使用场景** | 配套社区游戏群（QQ/微信群），群内玩家随时查阅，无实时性要求 |
| **访问方式** | 通过群内链接或二维码直接访问                                |

### 2.2 部署环境

| 项目       | 说明                                                                                     |
| ---------- | ---------------------------------------------------------------------------------------- |
| **服务器** | shserver（IP: 106.14.113.247, 上海阿里云）                                               |
| **域名**   | `ai.iracing.club`（与已有 `iracing.club` 社区网站区分）                                  |
| **HTTPS**  | Let's Encrypt (Certbot, 自动续期)，配置到 `ai.iracing.club` 子域名                       |
| **独立性** | V1 作为独立应用开发和部署，拥有独立代码仓库和部署服务器，后续可视需求对接 `iracing.club` |

### 2.3 后续发布渠道（Phase 2+）

- 微信小程序版本
- 对接 `iracing.club` 社区网站（嵌入式入口）
- 独立桌面端（视用户需求评估）

---

## 3. 功能需求

### 3.1 智能问答系统（核心功能）

#### 3.1.1 交互设计

- **界面风格**：类 ChatGPT 简洁对话页面，移动端优先适配
- **会话模式**：支持多轮会话，用户可在上下文基础上追问
- **流式输出**：回答以流式方式逐步呈现（逐字/逐段），提升用户体验
- **图片上传**：支持用户上传图片（如游戏截图、调校界面截图），Agent 需具备视觉理解能力

#### 3.1.2 问答流程

```
用户提问 → H5 服务后端 → Qoder Agent SDK → [md-wiki 本地检索（Grep/Glob/Read）] + [在线知识源 WebFetch] → 综合生成回答
```

详细流程说明：

1. **用户提问**：用户通过 H5 页面提交问题，后端接收并传入 Qoder Agent SDK
2. **md-wiki 本地检索**：Agent 使用内置工具（Grep 内容搜索、Glob 文件名匹配、Read 文件读取）在本地 Markdown Wiki 目录中快速定位和提取相关知识片段
3. **在线知识源补充**：当本地 Wiki 中信息不足时，Agent 通过 WebFetch 工具实时访问 knowledge-sources.md 中列出的权威站点（IQS 作为 fallback）
4. **综合回答生成**：Agent 综合本地 Wiki 和在线检索结果，生成精准、结构化的中文回答
5. **流式输出**：以 Server-Sent Events (SSE) 方式逐步返回回答内容

#### 3.1.3 追问细化能力

当用户的提问过于宽泛时，系统需主动追问以获取更多上下文信息：

**用户故事示例：**

| 用户提问       | 系统追问                                                 | 说明                         |
| -------------- | -------------------------------------------------------- | ---------------------------- |
| "刹车太重了"   | "请问是哪条赛道、什么车辆、什么天气条件下感觉刹车太重？" | 需要具体场景才能给出有效建议 |
| "怎么提高圈速" | "请问你目前在跑什么车、什么赛道？当前最佳圈速是多少？"   | 需了解当前水平才能针对性建议 |
| "推荐个调校"   | "请问是 GT3 还是 Formula 系列？在哪条赛道使用？"         | 调校高度依赖车辆和赛道组合   |

#### 3.1.4 幻觉控制

- **严格基于知识库回答**：当知识库中无法找到可靠答案时，Agent 必须明确告知用户"目前我的知识库中没有找到关于这个问题的确切信息"
- **引导至人工专家**：在无法回答时，建议用户联系群内指定用户（如 `@Lucifinil`）获取帮助
- **引用来源**：回答中尽量标注信息来源（如"根据 iRacing 官方知识库…"、"根据 Coach Dave Academy 教程…"）
- **置信度标识**：对于基于推理而非直接知识库内容得出的回答，添加"此建议仅供参考，建议在游戏中实际测试验证"的提示

#### 3.1.5 用例场景

| 场景         | 用户行为                                  | 系统响应                                                          |
| ------------ | ----------------------------------------- | ----------------------------------------------------------------- |
| 新手入门     | "iRacing 新手应该先做什么？"              | 基于官方 New Racer Guide 和 HiPole 教程，给出系统化的入门步骤建议 |
| 赛道攻略     | "Spa 赛道 Eau Rouge 弯道怎么过？"         | 检索赛道攻略知识，结合车辆类型给出走线、刹车点、档位建议          |
| 调校咨询     | "GT3 保时捷在 Silverstone 用什么胎压？"   | 检索调校知识库，给出推荐胎压范围和调校思路                        |
| 购车建议     | "新手 D 级应该先买什么车？"               | 基于性价比数据和社区推荐，给出分级别的购车优先级建议              |
| 图片问答     | [上传调校界面截图] "这个调校参数合理吗？" | 通过视觉理解识别截图内容，结合知识库给出分析                      |
| 超出知识范围 | "iRacing 下个赛季会出什么新车？"          | 坦诚告知无法预测，建议关注官方公告或联系社区管理员                |

### 3.2 知识库系统

#### 3.2.1 知识来源与优先级

**V1 阶段包含：**

| 优先级 | 来源类型            | 说明                                                                                                                                                              |
| ------ | ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P0     | 本地 md-wiki 知识库 | 由知识库管理员将采集的信息清洗为结构化 Markdown 文件，存储在项目 md-wiki 目录中，Agent 通过 Grep/Glob/Read 直接检索                                               |
| P0     | 权威站点实时查询    | 本地 Wiki 信息不足时，Agent 通过 WebFetch 工具实时访问 knowledge-sources.md 中列出的权威站点（IQS 作为 fallback）                                                 |
| P1     | 视频简介搜索        | 基于视频简介（标题、描述）内容进行搜索，返回视频链接（不含时间戳）                                                                                                |
| P1     | iRacing 官方论坛    | forums.iracing.com — 官方社区讨论区，含赛道攻略、调校分享、新手问答等高质量内容。支持游客浏览大部分帖子，无需登录即可通过 WebFetch 采集。作为在线查询的重要补充源 |

**Phase 2 待做：**

- [ ] 带时间戳的视频片段引用（需字幕提取/语音转写）
- [ ] 用户 UGC 内容入库

详细知识源清单参见 [knowledge-sources.md](./knowledge-sources.md)。

#### 3.2.2 知识分类体系与 md-wiki 目录结构

知识库按三大方向组织，映射为 md-wiki 目录结构：

```
md-wiki/
├── track-technique/           # 赛道技术
│   ├── driving-line/          # 走线技巧（逐弯攻略、理想线路）
│   ├── braking/               # 刹车技术（刹车点、循迹刹车、刹车压力）
│   ├── tire-management/       # 轮胎管理（胎压设定、胎温监控、磨损策略）
│   └── suspension/            # 悬挂与力学（悬挂参数、车辆动态、力反馈）
├── car-setup/                 # 车辆调校
│   ├── theory/                # 调校理论（车辆力学、参数含义、调校方法论）
│   ├── presets/               # 调校实操（具体车辆/赛道 Setup 推荐）
│   └── tools/                 # 调校工具（Garage 61、SimHub 等工具使用指南）
├── basics/                    # 基础知识
│   ├── getting-started/       # 新手入门（安装、界面、首场比赛流程）
│   ├── buying-guide/          # 购车/赛道建议（性价比方案、分级别推荐）
│   ├── series-and-league/     # 赛事体系（系列赛、联赛、安全评级、iRating）
│   └── hardware/              # 硬件配置（方向盘、踏板、显示器、PC 配置建议）
└── index.md                   # 知识库索引文件（各分类概述和快速导航）
```

**md-wiki 文件命名与内容规范：**

| 规范项       | 要求                                                                                                                |
| ------------ | ------------------------------------------------------------------------------------------------------------------- |
| **文件命名** | 使用小写英文 + 短横线分隔，如 `spa-eau-rouge-guide.md`、`gt3-tire-pressure-basics.md`                               |
| **文件格式** | 标准 Markdown 格式，必须包含 YAML Front Matter 头（title、category、subcategory、tags、source、season、updated_at） |
| **内容长度** | 单个文件建议 500～3000 字，过大则拆分为多个文件                                                                     |
| **来源标注** | 在 Front Matter 的 source 字段标注信息来源 URL 或来源名称                                                           |

**Markdown 文件示例：**

```markdown
---
title: Spa 赛道 Eau Rouge 弯道攻略
category: track-technique
subcategory: driving-line
tags: [spa, eau-rouge, gt3, 走线]
source: https://coachdaveacademy.com/...
season: 2026S3
updated_at: 2026-07-11
---

# Spa 赛道 Eau Rouge 弯道攻略

## 弯道概述

Eau Rouge 是 Spa 赛道最具标志性的弯道...

## 推荐走线

...

## 刹车点参考

...
```

#### 3.2.3 知识更新机制

**增量更新流程（日常）：**

```
管理员发现/采集新知识（包括浏览 forums.iracing.com 发现有价值的新知识） → 清洗整理为结构化 Markdown → 放入 md-wiki 对应分类目录 → 更新 index.md 索引 → Git 提交变更 → 部署生效
```

**全量刷新流程（每赛季大更新）：**

```
赛季更新公告 → 管理员审查现有 md-wiki 内容时效性 → 标记过时文件并更新/归档 → 重新采集权威站点最新内容 → 清洗为 md 文件 → 更新 index.md → Git 提交变更 → 部署生效
```

**更新策略：**

| 类型       | 触发方式         | 频率                | 说明                                         |
| ---------- | ---------------- | ------------------- | -------------------------------------------- |
| 增量更新   | 管理员手动触发   | 每周或按需          | 仅更新变更的知识条目，清洗为新 md 文件后入库 |
| 全量刷新   | 管理员手动触发   | 每赛季（约 3 个月） | iRacing 赛季大更新时全面审查并重建 md-wiki   |
| 自动化定时 | 定时任务（cron） | 后续迭代            | 前期由管理员手动触发，后续改为定时自动执行   |

#### 3.2.4 md-wiki 本地检索方案

- **存储方式**：结构化 Markdown 文件，按知识分类组织为目录树（见 3.2.2）
- **检索工具**：Qoder Agent SDK 内置工具
  - `Grep`：按正则/关键词搜索 md 文件内容，支持上下文行数、大小写等选项
  - `Glob`：按文件名模式匹配，快速定位特定分类或主题的文件
  - `Read`：读取完整 md 文件内容，提取详细信息
- **检索策略**：Agent 自主决定检索路径——先用 Glob 缩小文件范围，再用 Grep 精确定位相关内容，最后用 Read 读取完整上下文
- **优势**：无需 Embedding 模型、无需向量数据库、无需分块策略，知识以人类可读的 Markdown 格式存储，便于维护和审查
- **局限**：依赖 Agent 的检索推理能力，知识量过大时（>1000 文件）检索效率可能下降（V1 阶段知识量远小于此阈值）

### 3.3 用户系统

#### 3.3.1 注册与登录

- **注册流程**：用户填写用户名、密码、注册理由（可选）→ 提交注册申请 → 等待管理员审批
- **审批机制**：不对所有人开放注册，需管理员在后台审批通过后才能使用
- **登录方式**：用户名 + 密码登录，支持"记住登录状态"
- **认证方案**：JWT Token 认证，Access Token + Refresh Token 双 Token 机制

#### 3.3.2 用户权限

| 角色         | 权限                                                       |
| ------------ | ---------------------------------------------------------- |
| **游客**     | 仅可查看登录/注册页面                                      |
| **普通用户** | 使用问答功能、查看历史会话                                 |
| **管理员**   | 普通用户权限 + 用户审批 + 知识库管理 + 使用统计 + 系统配置 |

**后续可扩展角色：**

- **知识管理员**：专业玩家角色，可编辑和审核知识条目，无系统管理权限

#### 3.3.3 会话管理

- 每次问答为一个独立会话（Session），包含多轮对话消息
- 用户可查看历史会话列表，点击恢复/继续对话
- 会话支持自定义标题（默认取第一条消息摘要）
- 支持删除历史会话

### 3.4 管理后台

#### 3.4.1 用户审批与管理

| 功能         | 说明                                                 |
| ------------ | ---------------------------------------------------- |
| 注册申请列表 | 展示待审批的注册申请，包含用户名、注册时间、注册理由 |
| 批准/拒绝    | 管理员可批准或拒绝注册申请，拒绝时可选填拒绝原因     |
| 用户列表     | 展示所有已注册用户，支持搜索和筛选                   |
| 禁用用户     | 临时禁用某用户的访问权限，保留数据                   |
| 删除用户     | 永久删除用户及其所有数据                             |

#### 3.4.2 会话历史查看

- 管理员可查看任意用户的历史会话内容
- 支持按用户、时间范围、关键词筛选
- 用于质量抽查和问题排查

#### 3.4.3 知识库管理

| 功能             | 说明                                               |
| ---------------- | -------------------------------------------------- |
| md-wiki 文件列表 | 展示所有 md 文件，支持分类目录浏览和关键词搜索     |
| 查看知识文件     | 查看 Markdown 文件的完整内容和 Front Matter 元数据 |
| 编辑知识文件     | 在 Web 编辑器中修改 Markdown 内容和 Front Matter   |
| 新增知识文件     | 创建新的 Markdown 文件（提供模板、选择分类目录）   |
| 删除知识文件     | 删除不再适用的知识文件（移入归档目录，可恢复）     |
| 知识变更审核     | 审查 Git 提交中的知识文件变更，确认发布或回滚      |

#### 3.4.4 使用统计

| 指标         | 说明                             |
| ------------ | -------------------------------- |
| 总调用次数   | 系统总问答调用次数（按日/周/月） |
| 活跃用户数   | 每日/每周活跃用户数              |
| 热门问题     | 高频提问 Top-N 列表              |
| 平均响应时间 | LLM 回答的平均耗时               |
| 知识命中率   | 知识库检索命中 vs 未命中的比例   |
| 用户满意度   | 回答质量反馈（点赞/点踩）统计    |

#### 3.4.5 限流配置

| 配置项               | 默认值 | 说明                              |
| -------------------- | ------ | --------------------------------- |
| 单用户每分钟请求上限 | 10 次  | 防止单用户短时间大量请求          |
| 单用户每日请求上限   | 100 次 | 控制日常使用量                    |
| 全局每分钟请求上限   | 60 次  | 系统整体保护                      |
| 单次对话最大轮数     | 30 轮  | 防止无限循环对话                  |
| 自定义限流规则       | 可配置 | 管理员可按用户/角色设置差异化限额 |

**限流超限处理**：返回友好提示"当前使用人数较多，请稍后再试"，不暴露技术细节。

---

## 4. 技术架构

### 4.1 技术栈

| 层级          | 技术选型                             | 说明                                                    |
| ------------- | ------------------------------------ | ------------------------------------------------------- |
| **语言**      | TypeScript（全栈）                   | 前后端统一语言，降低维护成本                            |
| **框架**      | Next.js 14+ (App Router)             | 全栈框架，支持 SSR/SSG、API Routes、流式输出            |
| **前端**      | React + Tailwind CSS                 | 移动端优先的响应式 UI                                   |
| **后端**      | Next.js API Routes + Qoder Agent SDK | API 层 + Agent 编排层                                   |
| **Agent SDK** | `@qoder-ai/qoder-agent-sdk`          | 核心 Agent 编排能力                                     |
| **LLM**       | 兼容 OpenAI/Anthropic 协议的模型     | 如阿里云百炼 qwen3.6-plus、小米 MIMO 等，需支持视觉理解 |
| **认证**      | JWT（jose 库）                       | Access Token + Refresh Token                            |
| **数据库**    | SQLite (better-sqlite3)              | 用户、会话、知识条目等结构化数据存储                    |
| **部署**      | PM2 + Nginx                        | PM2 进程管理，Nginx 反向代理 + HTTPS                    |

### 4.2 Agent 架构设计

#### 4.2.1 Qoder Agent SDK 核心能力

SDK 包名：`@qoder-ai/qoder-agent-sdk`

**认证方式**：使用 Personal Access Token (PAT) 进行认证。

**核心 API**：

```typescript
import { query } from '@qoder-ai/qoder-agent-sdk';

// 基本用法
const result = await query({
  prompt: '用户的问题内容',
  options: {
    // 模型配置（BYOK 模式）
    model: {
      provider: 'custom-provider', // 匹配 BYOK 目录中的 provider
      model: 'qwen3.6-plus',
      style: 'openai', // OpenAI 兼容协议
      baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
      apiKey: process.env.LLM_API_KEY,
    },
    // 流式输出
    includePartialMessages: true,
    // 内置工具
    allowedTools: ['WebFetch', 'WebSearch', 'Read', 'Glob', 'Grep'],
    // 子 Agent 注册
    agents: { 'wiki-search': wikiSearchAgent, 'web-fetch': webFetchAgent },
    // 会话恢复
    resume: sessionId, // 传入 session ID 恢复历史会话
  },
});

// 流式消费
for await (const message of result) {
  if (message.type === 'assistant') {
    // 推送给前端 SSE
    sendSSE(message.content);
  }
}
```

#### 4.2.2 BYOK 模型配置

通过 `resolveModel` 回调 + `CustomModel` 对象实现自有模型接入：

```typescript
import { query, type CustomModel } from '@qoder-ai/qoder-agent-sdk';

const customModel: CustomModel = {
  provider: 'aliyun-bailian',
  model: 'qwen3.6-plus',
  style: 'openai', // 使用 OpenAI 兼容协议
  baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
  apiKey: process.env.ALIYUN_BAILIAN_API_KEY,
};

const result = await query({
  prompt: userMessage,
  options: {
    resolveModel: () => customModel,
    // ... 其他选项
  },
});
```

#### 4.2.3 多轮对话支持

通过 `prompt` 参数传入 AsyncGenerator 实现多消息会话：

```typescript
async function* messageGenerator() {
  yield '第一轮用户消息';
  // 等待 Agent 响应后继续
  yield '第二轮追问消息';
}

const result = await query({
  prompt: messageGenerator(),
  options: {
    resume: existingSessionId, // 恢复之前的会话
    // ...
  },
});
```

#### 4.2.4 MCP 扩展

支持四种 MCP Server 接入方式：

| 类型           | 说明               | 适用场景         |
| -------------- | ------------------ | ---------------- |
| stdio          | 标准输入输出       | 本地工具集成     |
| SSE            | Server-Sent Events | 远程服务         |
| HTTP           | HTTP 协议          | RESTful API 工具 |
| SDK In-Process | SDK 内嵌           | 自定义工具逻辑   |

#### 4.2.5 Hooks 生命周期

SDK 支持 15 种生命周期事件，V1 重点使用以下 Hooks：

```typescript
const result = await query({
  prompt: userMessage,
  options: {
    hooks: {
      // 工具调用前拦截：用于权限检查和日志记录
      PreToolUse: async (tool, input) => {
        console.log(`[Hook] Calling tool: ${tool}, input:`, input);
        // 可在此拦截危险操作
        return input;
      },
      // 工具调用后处理：用于结果后处理和统计
      PostToolUse: async (tool, input, output) => {
        console.log(`[Hook] Tool ${tool} completed`);
        return output;
      },
    },
  },
});
```

### 4.3 子 Agent 设计

#### 4.3.1 Agent 编排架构

```
主 Agent（对话管理 + 回答生成）
├── md-wiki 检索 Agent  → 通过 Grep/Glob/Read 在本地 md-wiki 目录中检索知识
└── 网页采集 Agent      → 通过 WebFetch 从权威站点实时获取信息（本地不足时补充）
```

#### 4.3.2 md-wiki 检索 Agent

```typescript
const wikiSearchAgent = {
  description: '从本地 md-wiki 知识库中检索与用户问题相关的 Markdown 文件和知识片段',
  prompt: `你是一个 iRacing 知识库检索专家。你的任务是从本地 md-wiki 目录中检索与用户问题最相关的知识。

    md-wiki 目录结构：
    - md-wiki/track-technique/  → 赛道技术（走线、刹车、轮胎、悬挂）
    - md-wiki/car-setup/       → 车辆调校（理论、实操、工具）
    - md-wiki/basics/          → 基础知识（入门、购车、赛事、硬件）

    工作流程：
    1. 分析用户问题的核心意图，判断属于哪个知识分类
    2. 使用 Glob 工具匹配对应分类目录下的相关文件（如 *braking*.md）
    3. 使用 Grep 工具在匹配的文件中搜索关键词，定位具体段落
    4. 使用 Read 工具读取相关文件的关键内容
    5. 整理并返回检索结果（包含文件路径、相关内容片段、来源信息）

    检索技巧：
    - 如果问题涉及特定赛道，优先用赛道名作为搜索关键词
    - 如果问题涉及特定车辆，优先用车辆名 + 分类作为搜索关键词
    - 中英文关键词都要尝试（md 文件可能使用英文文件名）
    - 如果初次搜索结果不足，扩大搜索范围或尝试同义词`,
  tools: ['Read', 'Grep', 'Glob'],
  maxTurns: 5,
  effort: 'medium',
};
```

#### 4.3.3 网页采集 Agent

```typescript
const webFetchAgent = {
  name: 'web-fetch',
  description: '当本地知识库无法满足用户需求时，从权威网站实时获取信息',
  prompt: `你是一个网页信息采集专家。当本地知识库中没有足够信息回答用户问题时，你需要从权威网站获取相关信息。
    
    优先访问的站点：
    - iRacing 官方知识库: https://support.iracing.com/
    - iRacing 官方: https://www.iracing.com/
    - iRacing 官方论坛: https://forums.iracing.com/（游客可浏览，含赛道攻略、调校分享、新手问答）
    - r/iRacing Reddit: https://www.reddit.com/r/iRacing/
    
    工作流程：
    1. 判断是否需要外部查询（本地知识不足时）
    2. 选择最合适的权威站点
    3. 使用 WebFetch 工具获取页面内容
    4. 提取与用户问题相关的关键信息
    5. 如果 WebFetch 失败，使用 IQS 作为 fallback
    6. 返回采集到的信息和来源 URL`,
  tools: ['WebFetch', 'WebSearch'],
  maxTurns: 5,
  effort: 'medium',
};
```

#### 4.3.4 子 Agent 编排注意事项

- 回答生成由**主 Agent** 完成，综合子 Agent 的检索结果后直接输出回答
- 子 Agent 使用**独立上下文**，不共享主 Agent 的对话历史
- 子 Agent **不能再创建子 Agent**（仅一层深度限制）
- 通过 `options.agents` 对象注册，每个 Agent 可指定 `description`、`prompt`、`tools`、`model`、`maxTurns`、`effort` 等参数
- 主 Agent 负责协调子 Agent 的执行顺序和结果整合

### 4.4 部署架构

```
                    ┌─────────────┐
                    │   Nginx     │
                    │  (反向代理)  │
                    │  HTTPS:443  │
                    └──────┬──────┘
                           │
                    ┌──────┴──────┐
                    │  Next.js    │
                    │  App Server │
                    │  :3000      │
                    └──────┬──────┘
                           │
              ┌────────────┼────────────┐
              │            │            │
       ┌──────┴─────┐ ┌───┴────┐ ┌────┴─────┐
       │  SQLite DB  │ │md-wiki │ │ Qoder    │
       │  (用户/会话  │ │ 目录   │ │ Agent    │
       │   /消息)    │ │ (.md)  │ │ SDK      │
       └────────────┘ └────────┘ └──────────┘
```

| 组件                | 说明                                                                     |
| ------------------- | ------------------------------------------------------------------------ |
| **Nginx**           | 反向代理，处理 HTTPS 终止（复用 iracing.club 证书），静态资源缓存        |
| **Next.js App**     | 前端页面 + API Routes，运行在 :3000 端口                                 |
| **SQLite DB**       | 存储用户、会话、消息、使用统计等结构化数据                               |
| **md-wiki 目录**    | Markdown Wiki 知识库文件，按分类目录组织，Agent 通过 Grep/Glob/Read 检索 |
| **Qoder Agent SDK** | Agent 编排层，需确保部署环境已安装 `qodercli`                            |

**与 iracing.club 隔离措施**：

- 使用独立 PM2 进程组
- 独立 Nginx server block
- 独立数据库文件
- 独立进程端口

---

## 5. 非功能需求

### 5.1 性能

| 指标              | 要求                                         |
| ----------------- | -------------------------------------------- |
| 首字节时间 (TTFB) | < 500ms（API 接口首次流式输出）              |
| 流式输出延迟      | 每 token 输出间隔 < 100ms                    |
| 页面加载时间      | < 2s（首屏完整加载，移动端 4G 网络）         |
| md-wiki 本地检索  | < 2s（Glob + Grep 定位 + Read 读取相关文件） |
| 并发支持          | 10 个并发用户（V1 规模，小范围使用）         |

### 5.2 安全

| 方面         | 措施                                                            |
| ------------ | --------------------------------------------------------------- |
| 用户认证     | JWT Token，Access Token 30 分钟过期，Refresh Token 7 天         |
| API Key 管理 | LLM API Key 存储在环境变量中，不硬编码                          |
| PAT 安全存储 | Qoder Agent SDK 的 Personal Access Token 存储在服务器环境变量中 |
| 密码存储     | bcrypt 哈希，不存储明文密码                                     |
| HTTPS        | 全站强制 HTTPS，HSTS 头                                         |
| 输入校验     | 所有用户输入做 XSS 过滤和长度限制                               |
| 速率限制     | 见 3.4.5 限流配置                                               |

### 5.3 限流与成本控制

- **LLM 调用成本**：通过限流机制控制每日 LLM 调用总量，设置成本预警阈值
- **模型选择策略**：简单问题使用轻量模型（如 qwen-turbo），复杂问题使用高质量模型（如 qwen-plus）
- **缓存机制**：对高频相同问题缓存回答结果，减少重复 LLM 调用
- **成本监控**：管理后台展示每日/每月 LLM 调用成本和趋势

### 5.4 可用性

| 方面     | 措施                                             |
| -------- | ------------------------------------------------ |
| 服务监控 | PM2 进程监控 + max_restarts 策略，异常自动重启 |
| 日志     | 结构化日志（请求日志、错误日志、Agent 执行日志） |
| 数据备份 | SQLite 数据库每日自动备份                        |
| 降级策略 | LLM 服务不可用时，返回预设常见问题回答           |

### 5.5 数据隐私

- 用户对话数据仅存储在服务器本地 SQLite 中，不上传至第三方
- LLM 调用时仅传输当前对话必要内容，不附带用户个人信息
- 用户可随时删除自己的历史会话
- 管理员查看用户会话需在操作日志中留痕

---

## 6. 产品路线图

### 6.1 V1（MVP）— 核心功能上线

**目标**：完成核心问答功能闭环，小范围内测使用。

| 模块           | 功能项                                               | 优先级 |
| -------------- | ---------------------------------------------------- | ------ |
| **问答系统**   | 类 ChatGPT 对话界面（H5 移动端）                     | P0     |
|                | 多轮会话支持                                         | P0     |
|                | 流式输出                                             | P0     |
|                | 追问细化能力                                         | P0     |
|                | 幻觉控制（不知道就说不知道）                         | P0     |
|                | 图片上传与视觉理解                                   | P1     |
| **Agent 后端** | 主 Agent + 子 Agent 编排                             | P0     |
|                | Query 改写                                           | P0     |
|                | md-wiki 检索集成                                     | P0     |
| **知识库**     | md-wiki 知识库初始化（第一梯队数据源清洗为 md 文件） | P0     |
|                | 权威站点 WebFetch 采集                               | P0     |
|                | 视频简介搜索 + 链接返回                              | P1     |
|                | 知识文件变更与 Git 管理流程                          | P1     |
| **用户系统**   | 注册 + 审批机制                                      | P0     |
|                | JWT 登录认证                                         | P0     |
|                | 历史会话保存                                         | P0     |
| **管理后台**   | 用户审批管理                                         | P0     |
|                | 用户禁用/删除                                        | P0     |
|                | 会话历史查看                                         | P1     |
|                | 知识库条目管理（CRUD）                               | P0     |
|                | 使用统计面板                                         | P1     |
|                | 限流配置                                             | P0     |
| **部署**       | PM2 部署配置                                       | P0     |
|                | Nginx + HTTPS 配置                                   | P0     |
|                | 域名 ai.iracing.club 解析                            | P0     |

### 6.2 V2 TODO — 功能增强

| 功能项                 | 说明                                                    |
| ---------------------- | ------------------------------------------------------- |
| 带时间戳的视频片段引用 | Phase 2 视频源字幕提取/转写后，回答中可引用具体视频片段 |
| 调校文件下载           | 对接 Garage 61 等平台，支持直接下载 Setup 文件          |
| 对接 iracing.club      | 与已有社区网站集成，共享用户体系                        |
| 微信小程序             | 新增微信小程序端，扩大用户触达渠道                      |
| 完整 Agent 架构升级    | 更精细的子 Agent 编排、引入更多工具能力                 |
| 社区化 UGC             | 用户贡献走线心得、调校分享，优质内容入知识库            |
| 知识管理员角色         | 专业玩家可参与知识库维护和内容审核                      |
| 自动化知识更新         | 定时任务自动爬取和增量更新，减少人工操作                |

---

## 7. 风险与注意事项

### 7.1 技术风险

| 风险                              | 影响                                                               | 缓解措施                                                                       |
| --------------------------------- | ------------------------------------------------------------------ | ------------------------------------------------------------------------------ |
| **Qoder Agent SDK 依赖 qodercli** | SDK 需要本地安装 `qodercli` 可执行文件，部署服务器需确保环境已安装 | 部署脚本中增加 qodercli 安装检查，服务器环境中预装                            |
| **BYOK 可用性**                   | 自有模型接入依赖 provider 目录匹配，可能因 provider 变更导致不可用 | 准备多个备选 LLM provider，定期验证连通性                                      |
| **DeepSeek API 并发限制**         | DeepSeek API 存在账号级并发限制，高并发时可能触发限流              | 实现请求队列和退避重试机制，监控并发数                                         |
| **子 Agent 嵌套限制**             | 子 Agent 仅支持一层深度，复杂任务无法多层分解                      | 合理设计子 Agent 职责粒度，避免需要多层嵌套的场景                              |
| **md-wiki 知识量增长后检索效率**  | 当 md 文件数量超过数百个时，Grep/Glob 检索可能变慢                 | 合理设计目录层级和文件命名规范，控制单目录文件数量；后续可引入向量检索作为补充 |
| **md 文件维护成本**               | 知识清洗为结构化 Markdown 需要人工投入，管理员负担较重             | 提供 md 文件模板和编辑工具降低门槛；后续引入自动化采集+AI辅助清洗流程          |

### 7.2 产品风险

| 风险               | 影响                                                                   | 缓解措施                                                                 |
| ------------------ | ---------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| **LLM 幻觉**       | 赛车调校建议错误可能误导玩家，影响驾驶体验甚至导致事故（游戏中）       | 严格幻觉控制策略：不确定的回答明确标注，调校建议附带"请在游戏中测试"提示 |
| **知识库时效性**   | iRacing 每赛季（约 3 个月）更新车辆、赛道、物理引擎，旧知识可能失效    | 每赛季全量刷新知识库，平时增量更新，知识条目标注适用赛季                 |
| **滥用风险**       | 用户可能通过 Prompt 注入将系统当作通用 ChatBot 使用，浪费 LLM 调用成本 | 系统 Prompt 严格限定 iRacing 领域，限流机制控制用量，异常使用模式告警    |
| **用户增长超预期** | V1 设计为小范围使用，若用户量快速增长可能遇到性能瓶颈                  | 架构设计预留扩展空间，SQLite 后续可迁移至 PostgreSQL                     |

---

## 8. 附录

### 8.1 数据模型设计

#### users 表

| 字段                | 类型        | 说明                                    |
| ------------------- | ----------- | --------------------------------------- |
| id                  | TEXT (UUID) | 主键                                    |
| username            | TEXT        | 用户名（唯一）                          |
| password_hash       | TEXT        | bcrypt 哈希密码                         |
| role                | TEXT        | 角色：`user` / `admin`                  |
| status              | TEXT        | 状态：`pending` / `active` / `disabled` |
| registration_reason | TEXT        | 注册理由（可选）                        |
| rejection_reason    | TEXT        | 拒绝原因（可选）                        |
| created_at          | DATETIME    | 注册时间                                |
| updated_at          | DATETIME    | 更新时间                                |
| last_login_at       | DATETIME    | 最后登录时间                            |

#### sessions 表（对话会话）

| 字段             | 类型        | 说明                                   |
| ---------------- | ----------- | -------------------------------------- |
| id               | TEXT (UUID) | 主键                                   |
| user_id          | TEXT (FK)   | 关联用户                               |
| title            | TEXT        | 会话标题（默认取首条消息摘要）         |
| agent_session_id | TEXT        | Qoder Agent SDK 会话 ID（用于 resume） |
| created_at       | DATETIME    | 创建时间                               |
| updated_at       | DATETIME    | 最后更新时间                           |

#### messages 表

| 字段        | 类型        | 说明                                      |
| ----------- | ----------- | ----------------------------------------- |
| id          | TEXT (UUID) | 主键                                      |
| session_id  | TEXT (FK)   | 关联会话                                  |
| role        | TEXT        | 消息角色：`user` / `assistant` / `system` |
| content     | TEXT        | 消息内容                                  |
| image_urls  | TEXT (JSON) | 用户上传的图片 URL 列表（可选）           |
| sources     | TEXT (JSON) | 引用的知识来源列表（可选）                |
| token_count | INTEGER     | Token 消耗数                              |
| created_at  | DATETIME    | 创建时间                                  |

#### knowledge_items 表

| 字段        | 类型        | 说明                                                                   |
| ----------- | ----------- | ---------------------------------------------------------------------- |
| id          | TEXT (UUID) | 主键                                                                   |
| title       | TEXT        | 知识条目标题                                                           |
| content     | TEXT        | 知识内容                                                               |
| category    | TEXT        | 分类：`track_technique` / `car_setup` / `basics`                       |
| subcategory | TEXT        | 子分类                                                                 |
| source_url  | TEXT        | 来源 URL                                                               |
| source_name | TEXT        | 来源名称                                                               |
| file_path   | TEXT        | md-wiki 中的文件路径（如 track-technique/braking/spa-brake-points.md） |
| tags        | TEXT (JSON) | 标签列表                                                               |
| season      | TEXT        | 适用赛季（如 "2026S3"）                                                |
| status      | TEXT        | 状态：`draft` / `published` / `archived`                               |
| created_at  | DATETIME    | 创建时间                                                               |
| updated_at  | DATETIME    | 更新时间                                                               |

#### usage_stats 表

| 字段        | 类型        | 说明            |
| ----------- | ----------- | --------------- |
| id          | TEXT (UUID) | 主键            |
| user_id     | TEXT (FK)   | 关联用户        |
| date        | DATE        | 统计日期        |
| query_count | INTEGER     | 当日提问次数    |
| token_used  | INTEGER     | 当日 Token 消耗 |
| created_at  | DATETIME    | 创建时间        |

#### rate_limit_configs 表

| 字段                  | 类型        | 说明                                         |
| --------------------- | ----------- | -------------------------------------------- |
| id                    | TEXT (UUID) | 主键                                         |
| scope                 | TEXT        | 作用域：`global` / `user` / `role`           |
| scope_id              | TEXT        | 作用域 ID（用户 ID 或角色名，global 时为空） |
| per_minute_limit      | INTEGER     | 每分钟请求上限                               |
| per_day_limit         | INTEGER     | 每日请求上限                                 |
| max_turns_per_session | INTEGER     | 单次对话最大轮数                             |
| created_at            | DATETIME    | 创建时间                                     |
| updated_at            | DATETIME    | 更新时间                                     |

### 8.2 API 接口设计

#### 认证相关

| 方法 | 路径                 | 说明              |
| ---- | -------------------- | ----------------- |
| POST | `/api/auth/register` | 用户注册申请      |
| POST | `/api/auth/login`    | 用户登录          |
| POST | `/api/auth/refresh`  | 刷新 Access Token |
| POST | `/api/auth/logout`   | 用户登出          |
| GET  | `/api/auth/me`       | 获取当前用户信息  |

#### 问答相关

| 方法   | 路径                     | 说明                         |
| ------ | ------------------------ | ---------------------------- |
| POST   | `/api/chat/send`         | 发送消息（SSE 流式返回）     |
| GET    | `/api/chat/sessions`     | 获取当前用户的会话列表       |
| GET    | `/api/chat/sessions/:id` | 获取指定会话的详情和消息历史 |
| DELETE | `/api/chat/sessions/:id` | 删除指定会话                 |
| PATCH  | `/api/chat/sessions/:id` | 更新会话标题                 |

#### 管理后台 - 用户管理

| 方法   | 路径                           | 说明                                     |
| ------ | ------------------------------ | ---------------------------------------- |
| GET    | `/api/admin/users`             | 获取用户列表（支持分页、搜索、状态筛选） |
| GET    | `/api/admin/users/pending`     | 获取待审批注册申请列表                   |
| POST   | `/api/admin/users/:id/approve` | 批准注册申请                             |
| POST   | `/api/admin/users/:id/reject`  | 拒绝注册申请                             |
| PATCH  | `/api/admin/users/:id/disable` | 禁用用户                                 |
| PATCH  | `/api/admin/users/:id/enable`  | 启用用户                                 |
| DELETE | `/api/admin/users/:id`         | 删除用户                                 |

#### 管理后台 - 知识库管理

| 方法   | 路径                                  | 说明                                     |
| ------ | ------------------------------------- | ---------------------------------------- |
| GET    | `/api/admin/knowledge`                | 获取知识条目列表（分页、分类筛选、搜索） |
| GET    | `/api/admin/knowledge/:id`            | 获取知识条目详情                         |
| POST   | `/api/admin/knowledge`                | 新增知识条目                             |
| PATCH  | `/api/admin/knowledge/:id`            | 编辑知识条目                             |
| DELETE | `/api/admin/knowledge/:id`            | 删除知识条目（软删除）                   |
| POST   | `/api/admin/knowledge/:id/restore`    | 恢复已删除的知识条目                     |
| POST   | `/api/admin/knowledge/sync`           | 触发知识库同步更新                       |
| GET    | `/api/admin/knowledge/pending-review` | 获取待审核的知识更新列表                 |
| POST   | `/api/admin/knowledge/review/:id`     | 审核知识更新（通过/拒绝）                |

#### 管理后台 - 统计与配置

| 方法  | 路径                                 | 说明                         |
| ----- | ------------------------------------ | ---------------------------- |
| GET   | `/api/admin/stats/overview`          | 获取使用统计概览             |
| GET   | `/api/admin/stats/usage`             | 获取使用量趋势（按日/周/月） |
| GET   | `/api/admin/stats/popular-questions` | 获取热门问题 Top-N           |
| GET   | `/api/admin/sessions`                | 查看所有用户的会话历史       |
| GET   | `/api/admin/sessions/:id`            | 查看指定会话详情             |
| GET   | `/api/admin/rate-limits`             | 获取限流配置列表             |
| PATCH | `/api/admin/rate-limits/:id`         | 更新限流配置                 |

### 8.3 项目目录结构建议

```
iracing-ai-assistant/
├── src/
│   ├── app/                    # Next.js App Router
│   │   ├── (auth)/             # 登录/注册页面
│   │   ├── (chat)/             # 问答对话页面
│   │   ├── (admin)/            # 管理后台页面
│   │   ├── api/                # API Routes
│   │   │   ├── auth/           # 认证接口
│   │   │   ├── chat/           # 问答接口
│   │   │   └── admin/          # 管理后台接口
│   │   └── layout.tsx          # 根布局
│   ├── components/             # React 组件
│   │   ├── chat/               # 对话相关组件
│   │   ├── admin/              # 管理后台组件
│   │   └── common/             # 通用组件
│   ├── lib/                    # 工具库
│   │   ├── agent/              # Qoder Agent SDK 封装
│   │   ├── db/                 # 数据库操作
│   │   ├── wiki/               # md-wiki 检索工具封装
│   │   ├── auth/               # 认证工具
│   │   └── utils/              # 通用工具
│   ├── hooks/                  # 自定义 React Hooks
│   ├── types/                  # TypeScript 类型定义
│   └── config/                 # 配置文件
├── scripts/                    # 脚本（数据采集、知识库同步等）
├── data/                       # 本地数据文件
│   ├── db.sqlite               # SQLite 数据库（用户/会话/消息）
├── md-wiki/                    # Markdown Wiki 知识库文件（按 3.2.2 目录结构）
├── public/                     # 静态资源
├── ecosystem.config.cjs        # PM2 进程配置
├── config/
│   └── nginx/                  # Nginx 配置
│       └── ai.iracing.club.conf
├── .env.local                  # 环境变量
├── next.config.ts              # Next.js 配置
├── tailwind.config.ts          # Tailwind CSS 配置
├── tsconfig.json               # TypeScript 配置
├── package.json
├── knowledge-sources.md        # 知识源梳理文档
└── PRD.md                      # 本文档
```
