# 知识清洗与知识库重建设计

**日期：** 2026-07-14

## 目标

围绕单一 OpenAI 兼容 LLM 调用链重建知识清洗子系统；从知识清洗中彻底移除 Qoder SDK，同时保留 Qoder 驱动的聊天与 Agent 能力；使用面向 iRacing 的专业分类体系；优化官方赛事、规则、新手知识、驾驶技巧和车辆调校等内容的清洗提示词；清空现有低质量知识数据，使后续知识必须经过管理员上传、修改、评估和审核发布。

新知识库采用 Andrej Karpathy LLM Wiki 思路的轻量文件优先版本：保留不可变来源，每个来源编译成一篇持久 Markdown 笔记，通过精简索引帮助 Agent 路由，并通过明确协议约束只读检索 Agent。

本设计明确不构建知识图谱，也不把一个来源拆分为多个概念页面。

## 范围

本次改造包括：

- 知识来源上传与不可变快照
- 异步知识清洗任务
- LLM 清洗提示词
- Front Matter 解析与校验
- iRacing 知识分类体系
- Markdown 笔记形态
- 面向 Agent 的索引与检索协议
- 候选稿自动评估
- 知识管理页面
- 一次性知识域数据重置

本次改造不包括：

- 删除 Qoder SDK 依赖
- 改动聊天回答链路
- 改动 Wiki 检索 Agent 或 Web 研究 Agent
- 自动发布 LLM 输出
- 绕过人工审核
- 实体页、概念页或一来源多笔记
- 反向链接或相关页面图谱
- 向量 Embedding 或知识图谱维护

## 总体架构

知识库分为三个轻量层次：

1. **来源层**：保存不可变上传文件和不可变规范化文本快照。URL 只抓取一次并保存快照；同一个来源记录不会在 Worker 中再次抓取可能已经变化的网页。
2. **笔记层**：每个知识来源严格对应一篇经过审核的 Markdown 笔记，包含用于检索路由的摘要和忠实于来源的正文。
3. **Agent 规范层**：`index.md` 用于定位候选笔记，`KNOWLEDGE.md` 规定只读检索顺序、证据使用方式和引用规则。

知识清洗链路固定为：

```text
不可变上传文件或 HTTPS URL 快照
  → 来源校验和重复检测
  → 异步知识任务
  → 确定性文本抽取
  → OpenAI 兼容 LLM 清洗
  → Front Matter 和输出长度校验
  → 保存候选稿
  → 启发式与可检索性评估
  → 管理员修改、反馈重洗、批准或驳回
  → 发布单篇 Wiki 笔记、重建索引并提交 Git
```

Worker 永远只调用 `cleanWithLlmDirect`。它不再读取清洗后端设置，不再创建 Qoder 清洗 Agent，也不回退到 Qoder。

仍然允许按照配置顺序尝试多个 OpenAI 兼容 Provider。Provider 限流或额度错误继续遵守现有 `STOP_ON_LLM_RATE_LIMIT` 配置。

## 从知识清洗中移除 Qoder

删除以下知识清洗能力：

- Worker 中的 Qoder 清洗分支
- Qoder SDK 消息收集和空闲超时辅助函数
- Agent Client 中的 `createCleaningQuery`
- Agent Prompt 中的 `KNOWLEDGE_CLEANER_PROMPT`
- `knowledge.cleaning_backend` 设置读取逻辑、类型和常量
- 带密码门禁的清洗后端切换 API
- 清洗后端切换组件及其知识页面入口
- 清洗专用 Qoder 环境变量说明和测试

保留以下能力：

- 供聊天和 Agent 工作流使用的 `@qoder-ai/qoder-agent-sdk`
- `CHAT_ANSWER_BACKEND`
- Qoder 聊天超时配置
- Wiki Search 和 Web Research Agent
- 其他仅用于聊天而非知识清洗的 Agent Prompt 和 Client 代码

知识管理页面不再展示“清洗模型”选择器。首次清洗和基于审核反馈的重新清洗都固定使用同一个 LLM 直连 Cleaner。

重新清洗只生成同一来源笔记的新候选版本，不创建额外的主题页或实体页。

## 知识分类体系

分类体系采用严格的父子映射。`subcategory` 只有属于所选 `category` 时才合法。

### `official-racing`：官方赛事

- `schedule-and-season`：赛程与赛季
- `series-and-events`：系列赛与赛事
- `sporting-code`：竞赛规则
- `race-procedures`：比赛程序
- `licenses-and-ratings`：执照与评分
- `protests-and-penalties`：申诉与处罚
- `special-events`：特别赛事

### `getting-started`：新手入门

- `account-and-membership`：账户与会员
- `content-and-purchasing`：内容与购买
- `installation-and-configuration`：安装与配置
- `first-race`：首次参赛
- `ui-and-registration`：界面与报名
- `leagues-and-hosted-racing`：联赛与自建比赛
- `troubleshooting`：问题排查

### `driving-technique`：驾驶技术

- `driving-fundamentals`：驾驶基础
- `racing-line`：赛车线
- `braking`：刹车
- `cornering`：过弯
- `racecraft`：比赛策略与对抗技巧
- `starts-and-restarts`：发车与重新发车
- `overtaking-and-defense`：超车与防守
- `tire-management`：轮胎管理
- `wet-weather`：湿地驾驶
- `telemetry-analysis`：遥测分析

### `car-setup`：车辆调校

- `setup-fundamentals`：调校基础
- `tires-and-pressures`：轮胎与胎压
- `suspension`：悬架
- `alignment`：定位参数
- `aerodynamics`：空气动力学
- `drivetrain-and-gearing`：传动与齿比
- `brakes`：制动设置
- `electronics`：电子设置
- `oval-setup`：椭圆赛道调校
- `presets-and-tools`：预设与工具

### `cars-and-tracks`：赛车与赛道

- `car-reference`：赛车参考资料
- `car-guide`：赛车指南
- `track-reference`：赛道参考资料
- `track-guide`：赛道指南

### `hardware-and-software`：硬件与软件

- `wheels-and-pedals`：方向盘与踏板
- `force-feedback`：力反馈
- `vr-and-displays`：VR 与显示设备
- `pc-and-performance`：电脑与性能
- `telemetry-tools`：遥测工具
- `third-party-apps`：第三方应用

由于知识域会被整体清空，旧分类和旧 Wiki 路径无需迁移。TypeScript 类型、数据库读写类型、校验、评估、筛选、发布和提示词必须统一使用新分类。

## Front Matter

每篇清洗后的文档必须从以下 YAML Front Matter 开始：

```yaml
---
id: <来自来源版本链的稳定笔记 ID>
title: <1～200 字符>
description: <用于检索路由的一句话摘要，最多 300 字符>
category: <六个顶级分类之一>
subcategory: <属于所选 category 的子分类>
tags: [<1～10 个来源可证实的标签>]
aliases: [<可选，用于精确搜索的其他名称>]
source_id: <不可变来源记录 ID>
source_name: <可选，来源发布者或文档名称>
source_url: <可选合法 URL；无 URL 的上传文件必须省略>
source_sha256: <不可变来源快照的 SHA-256>
content_type: <可选内容类型>
season: <可选，来源明确声明的 iRacing 赛季>
effective_date: <可选，来源明确声明的 ISO 日期>
expires_at: <可选，来源明确声明的 ISO 日期>
updated_at: <可选，来源明确声明的 ISO 日期>
---
```

`content_type` 只允许：

- `schedule`
- `sporting-rule`
- `series-guide`
- `beginner-guide`
- `driving-guide`
- `setup-guide`
- `car-reference`
- `track-reference`
- `hardware-guide`
- `software-guide`
- `other`

`id`、`source_id` 和 `source_sha256` 由应用注入，LLM 不得生成或修改。

日期、赛季、来源名称和 URL 只有在原文明确存在或由应用提供可信元数据时才能输出，LLM 不得推断。

`description`、`tags` 和 `aliases` 用于文件搜索和索引路由，但仍必须来自来源中真实存在的术语。

Front Matter 解析与序列化必须完整支持上述 schema，不再依赖行为含糊的手写 YAML 子集解析。

## 笔记正文形态

每个来源严格生成一篇 Markdown 笔记，正文使用以下结构：

```markdown
# <标题>

## 摘要

3～6 条简洁、可由来源支持的核心结论，用于帮助 Agent 判断笔记是否相关。

## 适用范围

原文明确说明的赛车、赛道、系列赛、赛季、天气、硬件、用户水平或其他限制。原文没有时省略。

## 详细内容

忠实且相对完整的专业正文，必要时使用 H3 分节。

## 关键数据、赛程、规则或操作步骤

根据内容选择合适形式：赛程和数据使用 Markdown 表格，操作流程使用有序列表，规则使用明确规则清单。可以换成更符合内容的 H2 标题。

## 限制与审核提示

记录原文明确说明的限制，以及可见冲突、缺页或截断等需要管理员确认的问题。没有内容时省略。

## 来源

原始来源名称和 URL，或上传文件名。
```

这些标题用于规定信息职责，不要求输出空章节。笔记可以省略不适用章节，也可以为数据章节使用更具体的名称，但必须包含：

- `摘要`
- `详细内容`
- `来源`

摘要只用于加速路由，详细内容才是最终回答引用的主要证据。Cleaner 不得只输出压缩摘要代替正文。

## 清洗提示词设计

System Prompt 将模型定义为“iRacing 模拟赛车专业知识编辑”，并明确以下优先级：

1. 事实忠实
2. 重要事实完整
3. 信息结构清晰
4. 表达简洁

通用规则：

- 使用与来源相同的语言。
- 不得添加来源中不存在的事实、建议、日期、数值、因果关系或结论。
- 保留专业术语、数字、单位、限制、条件、例外、警告、备注和引用。
- 删除导航、广告、Cookie 提示、重复页眉页脚、无关推荐和评论噪声。
- 保留有意义的表格、操作顺序和警告内容。
- 使用清晰 H1 和合理 H2/H3 层级。
- 一个来源只生成一篇笔记，不拆成实体页或概念页。
- 遵循固定笔记形态；摘要保持简短，详细内容必须足以支持引用。
- 使用来源中实际存在的术语生成便于精确检索的 `description`、`tags` 和 `aliases`。
- 严格遵守 category→subcategory 映射。
- 只返回清洗后的 Markdown，不输出说明或代码围栏。
- 审核反馈可以调整结构、分类和表达，但不能覆盖来源事实。

不同内容类型的专门规则：

- **官方赛程**：完整保留赛季、Week、日期、系列赛、赛车、赛道、Session 时间和原始时区；不得自行换算时区。
- **Sporting Code 与规则**：完整保留适用范围、阈值、例外、处罚和强制程度；不得混淆 `may`、`should` 和 `must`。
- **新手资料**：保留前置条件、操作顺序、界面名称和失败条件。
- **驾驶与调校**：保留适用赛车、赛道、天气、轮胎状态、测量单位和使用条件；不得把局部经验写成普遍规律。
- **来源异常**：原文冲突、不完整或明显截断时，在候选稿中标记需要管理员审核，不得自行编造修复。

回答前，模型在内部检查：

- 是否忠实于来源
- 是否保持一来源一笔记
- 分类是否有效
- 元数据是否合法
- 路由字段是否准确
- 章节是否清晰
- 表格是否保留
- 是否混入 Markdown 之外的解释

内部检查结果不输出。

## Qoder Agent 检索协议

正式 Wiki 根目录包含 `KNOWLEDGE.md`，用于指导后续 Qoder SDK 检索 Agent：

1. 保持只读，只允许使用 `Read`、`Grep`、`Glob` 等检索工具访问 Wiki。
2. 先读取 `index.md`，根据分类、description、aliases、赛季和有效期筛选候选笔记。
3. 使用准确术语、别名、系列赛名称、赛车名称、赛道名称和标签进一步缩小候选集合。
4. 只读取回答问题所需的少量候选笔记正文。
5. 精确问题必须使用详细内容、原始表格或规则作为证据，不能只依赖短摘要。
6. 回答同时引用 Wiki 笔记标题/路径和原始来源元数据。
7. 明确区分来源事实与 Agent 综合推理；证据不足时直接说明。
8. 使用赛季、effective_date 和 expires_at 优先选择当前适用内容；发现冲突或过期内容时明确指出，不得静默合并。

`index.md` 是路由目录，不是正文集合。每篇已发布笔记只生成一条精简索引，包含：

- 笔记链接
- 一句话 description
- category/subcategory
- 重要 aliases 或 tags
- 可选 season
- 可选生效日期和失效日期

发布、归档和恢复时确定性地重新生成索引。

系统继续使用数据库审计记录和 Git 历史，不额外引入 append-only `log.md`。

## 输入和输出限制

- 清洗后整篇 Markdown 硬上限：12,000 字符
- LLM 输出预算：约 6,000 tokens
- 普通知识笔记建议长度：2,000～8,000 字符
- 密集的官方赛程表或规则文档可以接近 12,000 字符

2,000～8,000 字符是提示词目标，不作为硬性校验范围。

Cleaner 不得静默截断输入。调用 LLM 前检查可配置的最大输入长度；超过上限时任务失败，并提示管理员按系列赛、赛季或文档章节拆分来源。

本设计不实现自动分块后生成多篇候选稿。

## 校验与自动评估

创建候选稿前执行结构校验：

- 文档必须从 Front Matter 分隔符开始。
- 必填字段和字段长度必须通过 Zod 校验。
- category 和 subcategory 必须是合法父子组合。
- `id`、`source_id`、`source_sha256` 必须与应用提供的来源元数据一致。
- description、tags 和 aliases 必须满足数量和长度要求。
- content_type 和日期字段必须符合 schema。
- 整篇输出不得超过 12,000 字符。

结构校验失败时不得创建候选稿。

Provider 未配置、超时、限流、空响应或非法输出都使任务进入 `failed`，并保存经过脱敏且可操作的错误说明。

自动评估保持非阻塞，检查：

- Front Matter 合法性
- 内容长度
- 分类和标签合理性
- 与已有笔记的重复程度
- 内容时效性
- 可检索性

可检索性评估必须包含 description、tags 和 aliases，因为这些是 Agent 路由的关键字段。

现有可选发布评分门禁保持不变，人工审核仍然是发布前置条件。

基础 Wiki lint 检查：

- 非法 Front Matter
- index.md 失效链接
- 重复 source_id 或 source_sha256
- 缺少来源信息
- 已过期笔记
- 非法分类组合

明确不检查图谱孤儿节点、入链覆盖率或 backlink 一致性。

## 知识域数据重置

知识重置通过显式一次性命令执行，必须带确认参数。它不是数据库迁移，也不会在应用启动时自动运行。

数据库事务内按照外键安全顺序删除：

1. `evaluation_dimensions`
2. `knowledge_feedback`
3. `knowledge_evaluations`
4. `knowledge_items`
5. `knowledge_drafts`
6. `knowledge_jobs`
7. `knowledge_sources`
8. `system_settings` 中废弃的 `knowledge.cleaning_backend` 记录

只有数据库事务成功后，才删除 `DATA_ROOT` 下的固定知识目录：

- `uploads/knowledge`
- `extracted`
- `drafts`
- `md-wiki` 下的已发布 Markdown
- `search-index.json`

然后重新创建：

- 空的 `md-wiki/index.md`
- 已审核的 `md-wiki/KNOWLEDGE.md`

所有文件目标必须经过路径包含校验，确保位于 `DATA_ROOT` 内。数据库失败时不删除文件。对已经为空的知识域重复执行应成功。

保留以下数据：

- 用户
- 会话
- 审计日志
- 其他系统设置

历史审计记录可以继续保留已经不存在的知识资源 ID。

## 管理员工作流

Web 管理页面是知识质量的主要边界：

1. 知识管理员上传支持的文件或提交 HTTPS URL。
2. 系统保存不可变来源和规范化文本快照。
3. 系统把该来源清洗为一篇候选笔记。
4. 管理员对比、修改并查看自动评估结果。
5. 管理员可以提交反馈，为同一来源笔记生成带版本的新候选稿。
6. 只有明确批准后，系统才发布文档并重建精简 Wiki 索引。

任何 LLM 输出都不会自动发布。

## 测试策略

实现遵循测试驱动开发：

- Worker 测试证明首次清洗和反馈重洗只调用 `cleanWithLlmDirect`，使用新限制，并且不导入或调用 Qoder 清洗接口。
- 来源测试证明上传原文件和 URL 规范化快照不可变，Worker 不会重新抓取已有快照的来源。
- Prompt 测试覆盖一来源一笔记、固定笔记形态、路由元数据、六类 taxonomy、事实忠实优先级、官方赛程、Sporting Code、新手知识、驾驶与调校、反馈重洗和禁止静默截断。
- Front Matter 测试覆盖稳定 ID、哈希、description、aliases、全部父分类、代表性子分类、非法跨分类组合、content_type 和日期字段。
- Index 测试证明索引精简、确定性生成、适合路由且不包含笔记正文。
- Agent 协议测试验证 `KNOWLEDGE.md` 中先索引、再缩小范围、最后读取正文和引用来源的规则。
- Evaluation 与 lint 测试覆盖路由字段、新 taxonomy 和 12,000 字符上限，同时确认不要求知识图谱。
- UI 和 API 测试验证清洗后端切换入口已移除。
- Reset 测试验证删除顺序、数据库事务先于文件删除、路径保护、幂等性和无关数据保留。
- 最后执行相关单测、全量测试、TypeScript 类型检查和 lint。

## 成功标准

- 知识清洗运行时不再导入、调用或配置任何 Qoder SDK 清洗能力。
- 聊天与 Agent 使用 Qoder 的能力保持可用且行为不变。
- 知识管理页面不再存在清洗后端切换入口和 API。
- 新候选稿使用六类严格 taxonomy 和增强元数据。
- 每个不可变来源严格生成一篇候选笔记和一篇已发布笔记。
- 不引入知识图谱、多页面编译、实体页或反向链接。
- 笔记同时包含面向 Agent 路由的摘要和相对完整、忠实于来源的正文。
- 清洗提示词包含 iRacing 各专业内容类型的事实保真规则。
- `index.md` 和 `KNOWLEDGE.md` 支持 Qoder 进行索引优先、只读文件检索和来源引用。
- 超大输入明确失败，不发生静默截断。
- 现有知识域记录和文件被清空，不影响用户、会话、审计日志和其他设置。
- 完成前所有针对性测试、全量测试、类型检查和 lint 均通过。
