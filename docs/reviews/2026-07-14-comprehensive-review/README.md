# 2026-07-14 项目全面 Review

本目录保存本次 `iracing-ai-assistant` 全面工程审计的过程记录、证据和最终结论。

## 审计状态

审计与 P0/P1 修复已完成。审计基线为 `master@b6bdc5869d5365c920a7c636a297a0c9572c1126`；共记录 29 项问题（P0 1 / P1 10 / P2 13 / P3 5）。F-01 至 F-11 已按 `09-p0-p1-implementation-plan.md` 实施并经过分波次独立复审；F-14 中与 F-11 不可分离的响应体总超时也一并修复。P2/P3 其余项目未纳入本轮。

开发约束：本机允许 `git pull`，但不得直接向 GitHub push。本项目后续 push 必须经 sgserver 的 `/home/admin/ai-projects/iracing-ai-assistant` 工作目录中转。

## 文档索引

- [00-review-plan.md](00-review-plan.md)：审计范围、方法、阶段和验收标准
- [01-inventory.md](01-inventory.md)：代码库、依赖、配置、运行入口和测试资产盘点
- [02-architecture.md](02-architecture.md)：系统架构、模块职责、依赖关系和部署拓扑
- [03-workflows.md](03-workflows.md)：用户、聊天、知识库、任务、评估和运维工作流
- [04-llm-agent-prompts.md](04-llm-agent-prompts.md)：LLM/Agent 调用链、提示词、模型配置和风险分析
- [05-verification-log.md](05-verification-log.md)：测试、构建、类型检查、静态检查和复现实验记录
- [06-findings.md](06-findings.md)：按严重度排序的问题、证据、根因和影响
- [07-remediation-plan.md](07-remediation-plan.md)：修复方案、权衡、优先级和验证策略
- [08-final-report.md](08-final-report.md)：管理摘要、总体评价和建议路线图
- [09-p0-p1-implementation-plan.md](09-p0-p1-implementation-plan.md)：P0/P1 测试先行实施任务与并行边界
- [10-p0-p1-remediation-report.md](10-p0-p1-remediation-report.md)：P0/P1 实施结果、复审结论、验证证据与剩余风险

审计阶段只修改本目录；随后经用户授权进入修复阶段并修改产品代码和测试。本轮没有 commit、push 或部署。
