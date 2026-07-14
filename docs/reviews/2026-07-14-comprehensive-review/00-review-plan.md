# Comprehensive Project Review Implementation Plan

> **For agentic workers:** Execute this audit task-by-task. Do not modify product code; record evidence and remediation plans only.

**Goal:** 全面梳理项目架构、业务与运维工作流、LLM/Agent 调用及提示词，并通过可复核证据识别缺陷、分析根因和制定修复方案。

**Architecture:** 审计采用“静态盘点 → 调用链追踪 → 动态验证 → 根因分析 → 修复规划”的证据链。所有中间结果和最终报告统一保存在 `docs/reviews/2026-07-14-comprehensive-review/`，结论引用精确文件位置、命令输出或可重复实验。

**Tech Stack:** Next.js、React、TypeScript、Drizzle ORM、SQLite（better-sqlite3）、Vitest、Playwright、Node.js worker、OpenAI-compatible LLM API、Qoder SDK。

## Global Constraints

- 本轮目标是 review 和修复评估，不直接修改产品代码或测试。
- 不读取、输出或写入真实密钥；环境分析仅基于变量名与示例配置。
- 缺陷结论必须包含证据、根因、触发条件、影响范围和置信度。
- 测试或构建失败必须区分代码缺陷、缺少外部依赖、环境问题和测试夹具问题。
- 提示词分析必须覆盖系统提示词、动态上下文、历史消息、工具/SDK指令、知识清洗和评估提示词。
- 最终修复方案按 P0/P1/P2/P3 排序，并说明改动面、回归风险和验证方法。

---

### Task 1: 建立审计基线与代码库清单

**Files:**
- Create: `docs/reviews/2026-07-14-comprehensive-review/01-inventory.md`
- Update: `docs/reviews/2026-07-14-comprehensive-review/05-verification-log.md`

- [x] 记录当前提交、分支、工作区状态、目录树、代码规模和最近变更。
- [x] 解析 `package.json`、TypeScript/Next/Vitest/Playwright/Drizzle/PM2 配置和 `.env.example`。
- [x] 列出所有 Web 路由、API 路由、worker、脚本、数据库表/迁移及测试分层。
- [x] 标注生成文件、持久化数据、部署文件和外部系统依赖。

### Task 2: 构建系统架构图

**Files:**
- Create: `docs/reviews/2026-07-14-comprehensive-review/02-architecture.md`

- [x] 从入口层追踪到服务、仓储、数据库、LLM、文件系统和 Git 的依赖方向。
- [x] 说明进程边界：Next.js Web、后台 worker、SQLite、LLM/Qoder、Git/文件系统和 Nginx/PM2。
- [x] 绘制模块关系、部署拓扑和关键数据模型。
- [x] 评价分层、耦合、事务边界、并发控制、错误处理和可观测性。

### Task 3: 还原端到端工作流

**Files:**
- Create: `docs/reviews/2026-07-14-comprehensive-review/03-workflows.md`

- [x] 追踪认证、会话和权限校验流程。
- [x] 追踪聊天请求、SSE 输出、历史上下文、诊断事件、缓存、限流和用量统计流程。
- [x] 追踪知识上传、抽取、LLM 清洗、草稿审核、发布、索引和 Git 同步流程。
- [x] 追踪后台任务租约、重试、失败恢复、评估和运维脚本流程。
- [x] 为每条流程记录正常路径、失败路径、状态变化和外部副作用。

### Task 4: 审计 LLM、Agent 和提示词

**Files:**
- Create: `docs/reviews/2026-07-14-comprehensive-review/04-llm-agent-prompts.md`

- [x] 使用全文检索枚举所有 SDK/API 调用、模型名、参数、消息组装和流式事件处理。
- [x] 原样定位每段静态提示词，并说明动态插值来源和信任级别。
- [x] 追踪聊天 Agent、知识清洗、检索评估和脚本评测的完整输入输出链。
- [x] 分析提示词注入、数据外泄、上下文污染、token/成本、模型兼容性、结构化输出和降级策略。
- [x] 对每段提示词给出目标、优点、缺口和改进方向，但不直接改写产品代码。

### Task 5: 执行动态验证与静态审计

**Files:**
- Update: `docs/reviews/2026-07-14-comprehensive-review/05-verification-log.md`
- Create: `docs/reviews/2026-07-14-comprehensive-review/06-findings.md`

- [x] 安装/确认依赖后运行 lint、类型检查、单元/集成测试、构建和可执行的端到端检查。
- [x] 记录每条命令、时间、退出码、通过/失败数量和完整关键错误。
- [x] 静态检查认证授权、输入验证、文件处理、SQL/事务、竞态、租约、缓存、SSE、资源释放和密钥边界。
- [x] 对失败从调用点反向追踪到数据来源，比较同库正常实现，形成单一根因假设。
- [x] 仅将稳定复现且根因明确的问题标为“已验证缺陷”。

### Task 6: 评估修复方案

**Files:**
- Create: `docs/reviews/2026-07-14-comprehensive-review/07-remediation-plan.md`

- [x] 为每个问题列出最小修复、推荐修复和必要时的架构性方案。
- [x] 评估兼容性、数据迁移、安全、性能、成本、开发量和回归面。
- [x] 为已验证缺陷给出先失败后通过的测试策略和精确验证命令。
- [x] 按依赖关系和风险形成 P0/P1/P2/P3 实施顺序。

### Task 7: 汇总、自检与交付

**Files:**
- Create: `docs/reviews/2026-07-14-comprehensive-review/08-final-report.md`
- Update: `docs/reviews/2026-07-14-comprehensive-review/README.md`

- [x] 汇总架构成熟度、主要优势、最高风险和建议路线图。
- [x] 确认每个重要结论都能追溯到源文件、测试输出或复现实验。
- [x] 检查各文档间的严重度、编号、文件路径和建议一致性。
- [x] 检查 Git diff，确保没有意外修改产品代码。
- [x] 运行最终文档完整性检查并记录结果。

## Completion Criteria

- `README.md` 中列出的 9 份文档全部存在且不含未解释的占位符。
- 架构和工作流覆盖所有核心模块、API 路由、worker 与外部依赖。
- 所有 LLM/Agent 调用点和提示词均有来源、组装方式和风险说明。
- 每个已验证缺陷有可复核证据与根因；每个修复方案有验证策略。
- 最终报告能独立回答“系统如何工作、哪里有风险、先修什么、如何验证”。
