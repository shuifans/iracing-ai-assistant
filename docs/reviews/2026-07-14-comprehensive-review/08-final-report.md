# 项目全面 Review 最终报告

## 1. 结论摘要

`iracing-ai-assistant` 已具备一个单机生产型 MVP 的完整骨架：认证/RBAC、流式聊天、双 LLM/Agent 后端、本地知识检索、知识清洗审核发布、SQLite 任务租约、评估、管理后台和部署资产都已形成模块。代码命名清楚、TypeScript strict，单元与集成测试数量充足，Wiki 内容格式也健康。

但当前不适合在未修复的情况下扩大公网流量或知识发布权限。最高风险集中在三个系统边界：

1. **发布边界**：LLM/审核稿标题进入 shell，可导致命令注入；发布状态与 DB CHECK 不一致，失败补偿会造成 DB/Git/文件分裂。
2. **任务边界**：worker lease 遗留会把待审核任务重新排队，`maxAttempts` 又不生效，可能重复调用模型并覆盖审核上下文。
3. **聊天/Agent 边界**：限流没有接线，图片功能不可用，停止接口缺少所有权校验；Qoder WebSearch/evidence 协议存在确定性错误，来源与 grounding 失真。

综合判断：**架构方向合理，核心业务覆盖较完整；安全边界和跨资源一致性成熟度低于功能成熟度。** 最优路线不是重构成微服务，而是先修复 P0/P1 不变量、建立真实 DB+Git+文件集成测试，再统一 Agent 协议和提示词数据边界。

### 2026-07-14 修复更新

上述审计结论描述的是基线。随后 F-01 至 F-11 已全部实施并通过独立复审，F-14 的响应体总超时也随 URL 网络层一并修复。项目已从“需先完成 P0/P1 才能扩大使用”进入“可继续处理 P2/P3 与部署验收”的阶段；具体变更和证据见 `10-p0-p1-remediation-report.md`。

## 2. 审计范围与证据

- 基线：`master@b6bdc5869d5365c920a7c636a297a0c9572c1126`。
- 规模：约 42,532 行 TS/TSX；14 页面、58 API route、20 张表、Web+worker 两进程。
- 覆盖：架构、认证、聊天/SSE、缓存、知识上传/抽取/清洗/评估/发布、任务租约、全部 LLM/Agent 提示词、部署与测试资产。
- 动态验证：依赖安装、typecheck、lint、unit/integration/e2e Vitest、Next build、Playwright、npm audit、Wiki validator、4 组 SQLite 复现实验。
- 安全限制：没有执行命令注入 payload、DNS rebinding 利用或真实付费 LLM/Qoder 调用；相应结论按“高可信风险”标注。

## 3. 系统如何工作

系统是一个共享 SQLite 与文件系统的模块化单体：Nginx → Next.js Web 负责认证、页面、API 和 SSE；独立 worker 从 SQLite claim 知识任务并抽取/清洗；聊天默认走 BM25 + OpenAI-compatible direct LLM，本地未命中或显式配置时走 Qoder 主 Agent 与 Wiki/Web 子 Agent；知识审核通过后写 Markdown Wiki、重建索引、提交并推送 Git。

关键状态源不止一个：SQLite 保存业务状态，`DATA_ROOT` 保存来源/抽取/草稿，`WIKI_ROOT` 保存发布内容并由 Git 版本化，Qoder 还保存 resume session。当前最主要的可靠性问题，正是这些状态源之间没有统一 transaction/outbox，而补偿逻辑只覆盖部分阶段。

详图和状态流见 `02-architecture.md` 与 `03-workflows.md`。

## 4. LLM / Agent 评价

项目存在 6 类实际模型/Agent 用途：direct 聊天、Qoder 聊天主 Agent、Wiki 搜索子 Agent、Web 研究子 Agent、direct 知识清洗、Qoder 知识清洗，另有 seed/test 脚本。深度知识评估目前没有 LLM judge，虽接受 `deep=true`，实际仍是启发式评估。

提示词的优点是范围、证据、不确定性、单位和输出格式约束较完整；主要缺口是：

- direct 与 Qoder 共用一段“Wiki 已预检索”的 system prompt，但 Qoder 实际需自主搜索。
- Wiki excerpt 被拼进 system role，外部内容与硬规则处于同一权限层。
- 清洗的原始文档/反馈没有一致的“不可信数据”边界。
- evidence 仅靠自然语言 JSON 和多套手写解析器，没有共享 schema。
- grounding 只根据 evidence 是否存在，而不是答案是否有效引用。

完整提示词、动态插值和信任分析见 `04-llm-agent-prompts.md`。

## 5. 发现统计

共记录 **29 项**：

| 严重度 | 数量 | 代表问题 |
|---|---:|---|
| P0 | 1 | Git commit/push shell 命令注入 |
| P1 | 10 | 发布状态崩坏、租约回收、图片外键、限流、停止越权、Qoder Web/evidence、Markdown scheme、依赖、DNS rebinding |
| P2 | 13 | 重试上限、用户删除、body timeout、深度评估、缓存版本、worker 并发、部署、提示词/历史/评测等 |
| P3 | 5 | lint、E2E 漂移、contract 空跑、诊断指标、retry 语义 |

按证据类型：13 项为动态验证或静态确定缺陷，8 项为高可信风险，7 项为设计债务，1 项为明确测试缺口。逐项触发条件、根因和影响见 `06-findings.md`。

## 6. 最重要的修复顺序

### 当天

1. 把发布器所有 Git 调用改成 executable + argv，禁止 shell string。
2. 临时把 diagnostic 限制到管理员并加 Origin/输入限制。
3. 若不能马上修图片两阶段模型，先隐藏/关闭图片入口。

### 1–3 天

1. 发布状态只使用合法值，DB 步骤进 transaction，Git push 改为可确认/可重试 operation。
2. lease 只覆盖 extracting/cleaning，进入 pending_review 原子清 lease。
3. 限流接入 `streamChatMessage` 唯一入口，stop 增加 session ownership。
4. 统一 evidence schema，分别处理 WebSearch query 与 WebFetch URL。
5. 替换自制 Markdown renderer，过滤危险 URL scheme。

### 第一周

完成 attachment owner/bind/cleanup/vision 链路，修 URL pinning 和 response body deadline，升级/替换高危依赖，处理用户删除策略、缓存版本和 Qoder cleaner 生命周期。

### 第二周

对齐 Next/ESLint，补真实 contract 测试与发布故障注入；重构 direct/Qoder 评测协议；把部署脚本与备份/dry-run/readiness/rollback 串成一个可演练流程。

逐项最小方案、推荐方案、工作量、迁移和测试见 `07-remediation-plan.md`。

## 7. 验证结果

| 检查 | 结果 |
|---|---|
| TypeScript | 通过 |
| Unit | 79 files / 949 tests 通过 |
| Integration | 11 files / 90 tests 通过 |
| Vitest e2e | 4 files / 16 tests 通过 |
| Next production build | Next.js 15.5.20，通过 |
| Wiki validator | 18/18 通过 |
| ESLint | 通过 |
| Browser E2E | 7/8；唯一失败是未点击 tab 的测试脚本 |
| Contract | 0 tests，当前因配置返回成功 |
| npm audit | 0 high / 2 moderate（同一 Next 内置 PostCSS 链） |

修复阶段新增了真实 SQLite、临时 Git、上传、SDK wire contract 和确定性 HTTPS/DNS fixture，覆盖 publisher、lease、附件、限流、evidence 与 URL 跨模块不变量。仍为空的 contract 套件和浏览器测试漂移属于待处理 P3。

## 8. 项目优势

- 功能模块边界、状态枚举和 API 命名清晰，追踪调用链成本较低。
- strict TypeScript、SQLite 外键/WAL、CAS claim、refresh token rotation、Origin/RBAC 等基础工程意识较好。
- 聊天 SSE 有较丰富的 timing/workflow/usage 事件，知识流程有人审门禁。
- direct + Agent 双后端和本地 BM25 快路径是合理的成本/延迟设计方向。
- Wiki 18 篇全部通过格式校验，已有较完整测试资产和生产部署文档。

这些基础足以支持渐进修复，不需要推倒重写。

## 9. 验收标准

下一轮可将以下条件作为“允许扩大生产使用”的最低门槛：

- F-01 至 F-11 均关闭或有明确的临时阻断措施。
- publisher 真实 SQLite + 临时 Git 故障注入测试覆盖每个阶段。
- lease、附件、stop、rate limit、evidence 均有跨模块集成测试。
- lint、contract、browser E2E 全绿，不能 `passWithNoTests`。
- runtime 高危依赖完成升级/隔离，`npm audit --omit=dev` 无未接受的 high。
- 部署在 staging 完成一次迁移失败和 readiness 失败的回滚演练。

## 10. 文档导航

- `01-inventory.md`：代码、依赖、路由、表与运维资产
- `02-architecture.md`：模块、进程、数据与部署架构
- `03-workflows.md`：8 条端到端业务/运维流程
- `04-llm-agent-prompts.md`：调用点、提示词与 Agent 协议
- `05-verification-log.md`：命令结果与复现实验
- `06-findings.md`：29 项问题的证据、根因和影响
- `07-remediation-plan.md`：修复方案、工作量、测试与 PR 顺序
- `09-p0-p1-implementation-plan.md`：P0/P1 实施任务与边界
- `10-p0-p1-remediation-report.md`：实施结果、复审和最终验证
