# 修复方案与实施路线

## 1. 决策原则

本项目不需要先做微服务化。建议优先修复可利用边界和跨模块不变量，再统一 Agent 协议，最后处理工程债务。所有修复都应先增加一个能在当前基线失败的测试，再改实现。

工作量口径：S ≤ 0.5 人日，M = 1–2 人日，L = 3–5 人日，XL > 5 人日。实际时间取决于外部 SDK 和部署环境。

## 1.1 实施状态（2026-07-14）

Phase 0/1 对应的 F-01 至 F-11 已完成并通过独立复审；F-14 的 URL 响应体总超时因与 DNS pinning 共用网络实现而提前完成。后续应从 F-12/P2 开始，不重复实施本轮已关闭项目。完整结果见 [10-p0-p1-remediation-report.md](10-p0-p1-remediation-report.md)。

## 2. Phase 0：立即止血（当天）

### R-01 消除发布器 shell 注入（F-01，S）

**最小修复**

- 用 `execFileSync('git', ['add', '--', wikiPath, 'index.md'])`、`execFileSync('git', ['commit', '-m', message])` 和 `execFileSync('git', ['push', remote, branch])` 取代所有 `execSync(string)`。
- `wikiPath` 必须是由服务端 category/subcategory/slug 生成的相对路径；使用 `path.relative` 再验证不以 `..` 开头且不是绝对路径。
- 标题可以保留原文本作为 argv，但限制控制字符和长度；不依赖“转义 shell”作为防线。

**推荐修复**

- 封装单一 `GitClient`，只暴露 `addFiles/commit/push/revParse` 的 argv API；发布器不得直接 import `child_process`。
- 记录结构化 Git 错误，不把命令/密钥写日志。

**先失败测试**

- 在临时 Git repo 发布标题 ``safe $(touch <sentinel>)`` 和含反引号标题；断言 commit message 保留字面值且 sentinel 不存在。
- mock child process 时断言调用是 executable + argv，而不是 shell string。

### R-02 临时关闭高成本诊断入口或加管理员守卫（F-05，S）

- 在完整限流接入前，将 diagnostic route 限制为 admin/knowledge_admin，并补 `validateOrigin`。
- 同时限制 questions 为 1–10 个非空字符串、单条长度、请求体大小；生产环境可用 feature flag 默认关闭。
- 这是止血措施，不能替代 Phase 1 的统一限流。

## 3. Phase 1：修复核心正确性与授权（1–3 天）

### R-03 重做发布状态与补偿边界（F-02，M/L）

**最小修复**

- spawn 前/后写合法的 `push_pending`，不要写 `pushed`；只有可确认远端成功的同步 push 才写 `synced`，失败写 `push_failed`。
- 把“可补偿的文件阶段”和“DB 已提交后的 Git 阶段”分成两个 try/catch；DB 进入 published 后不得再执行 `publishing → pending_review` 的旧补偿。
- 把 item upsert、draft approve、job publish、audit log 放进一个 SQLite transaction。

**推荐修复**

- 增加持久化 outbox / publish operation 表：`prepared → db_committed → git_committed → push_pending → synced/failed`，保存目标路径、备份、commit SHA 和 last error。
- worker/cron 执行 push 并确认退出码；启动时恢复未完成 operation。不要 detached spawn 后乐观宣称成功。
- 明确一致性优先级：DB 是发布编排事实源，Wiki/Git 是可重试投影。

**数据兼容**

- 现有 CHECK 无需新增 `pushed`；扫描 published item 中 null SHA、文件缺失和非合法 sync status（如果历史 DB 关闭过 CHECK）并生成修复报告。

**测试**

- 真实临时 SQLite + 临时 Git repo 覆盖：无 remote、commit 失败、push 失败、push 成功、状态更新失败、重复发布、覆盖已有条目。
- 每个注入故障点断言 DB/job/draft/file/commit 五项不变量。

### R-04 分离 worker lease 与业务状态（F-03，M）

**最小修复**

- `cleaning → pending_review` 成功时原子清空 `lease_owner/lease_expires_at/heartbeat_at`。
- `recoverExpiredLeases` 只处理 `extracting/cleaning`，更新条件同时包含目标 status 和 `lease_expires_at < now`，避免 select/update 间状态变化。
- publishing 不复用 worker lease；若需发布恢复，使用独立 publish operation/timeout 机制。

**测试**

- 将 EXP-01 固化为集成测试：pending_review 即使保存过期 lease 也不恢复；extracting/cleaning 会恢复。
- 添加并发 CAS 测试：恢复器选中后状态被另一流程推进时，update 不得回退它。

### R-05 重新设计附件两阶段模型（F-04，M/L）

**推荐方案**

- 增加 `uploaded_by`、`upload_token/status`，允许 `message_id` 暂时为 null；上传时写 owner 和过期时间。
- 发送消息的同一 transaction 内验证 attachment owner、未绑定、数量/总大小，然后绑定到新 user message。
- 定时清理过期未绑定文件；删除 DB 失败与文件清理应可重试。
- 文件根使用 `path.join(DATA_ROOT, 'uploads')`，不硬编码 `/data`。
- 若产品承诺视觉问答，在 direct/Qoder 两条模型请求中显式传 image content；不支持时应从 UI/API 移除图片能力，避免假功能。

**较小替代方案**

- 上传接口同时创建一条 draft user message，再在 send 时完成内容；实现较快，但会产生废弃消息且会话事务更复杂，不推荐。

**测试**

- 上传成功、跨用户复用失败、重复绑定失败、过期清理、删除级联、模型 payload 含图像、硬编码路径消失。

### R-06 把限流置于模型调用唯一入口（F-05、F-12，M）

- 在 `streamChatMessage` 开始且创建消息/调用模型前执行 `checkRateLimit`，保证普通聊天、retry、diagnostic 都复用同一守卫。
- 同时执行 max session turns、并发 active query 数、请求字符数和 attachment 配额。
- diagnostic 额外使用更严格 scope；失败轮次同样消耗合理额度，防止反复失败绕过。
- retry job 在 repository CAS 中加入 `attempt < max_attempts`；达到上限返回明确业务错误并保留 failed。

**测试**

- API 集成测试断言超限时没有创建 assistant 消息、没有调用 LLM mock。
- 固化 EXP-03，第三次之后 retry 失败；并发 retry 只能一个 CAS 成功。

### R-07 修复 stop 所有权（F-06，S）

- 从 message join session，以 `(messageId, session.userId=userId)` 查询；无权访问统一返回 NOT_FOUND，避免枚举。
- 仅允许停止 assistant 且 pending/streaming 的消息；activeQueries 不存在时返回幂等成功或明确状态冲突。
- 集成测试创建两个用户，断言 B 无法停止 A，A 可以停止自己的请求。

### R-08 修复 Markdown 输出安全（F-09，M）

- 替换两套 regex renderer 为一套成熟 Markdown parser + HTML sanitizer。
- sanitizer 使用标签/属性 allowlist；URL scheme 仅允许 `https:`, `http:`，必要时 `mailto:`，相对 Wiki 路径单独处理；拒绝 `javascript:`, `data:`, `vbscript:` 和控制字符混淆。
- 外链继续加 `rel="noopener noreferrer"`，最好也加统一跳转/提示。
- 用相同组件渲染聊天和管理员会话，消除双实现。

**测试**

- XSS corpus：原始 HTML、事件属性、大小写/空白混淆 scheme、编码后的 javascript、破坏属性引号、SVG/data URI；在 Playwright 中点击后断言无脚本执行。

### R-09 修复 Qoder Web 与 evidence 协议（F-07/F-08，M）

- WebSearch 只校验 query 类型/长度，不把它当 URL；WebFetch 严格解析 URL。
- allowlist 结构改为 `{hostname, pathPrefix?}`，官方域和 Reddit path 分别判断；解析 punycode、端口和尾点。
- prompt 和 AgentDefinition 使用同一 maxTurns 常量。
- 定义 Zod `EvidenceEnvelope = {evidence: Evidence[]}`（或统一根数组，二选一），hook、service、SSE mapper、DB 共用；移除 regex 抓第一个数组的方式。
- file boundary 改为 `relative = path.relative(root, target); !relative.startsWith('..') && !path.isAbsolute(relative)`。

**测试**

- hook unit：自然语言 WebSearch 放行；非 allowlist fetch 拒绝；Reddit 仅 `/r/iRacing` 放行；prefix sibling 文件拒绝。
- service integration：模拟 tool result，断言 source SSE 和 `message_sources` 都有 evidence。

### R-10 依赖安全升级（F-10，M/L）

- Next 先升级到仍受支持、包含 advisory 修复的版本；由于当前日期和 advisory 会变化，实施时重新以官方 release/security notes 与 `npm audit` 核验，不盲目执行 major auto-fix。
- `eslint-config-next` 与 Next 使用同一 major。
- `xlsx`：优先迁移到维护中的解析库或安全发行版；过渡期把 Excel 解析隔离到受限 worker，严格限制文件大小、行列数、CPU/超时，并只接受知识管理员上传。
- 升级后运行完整 unit/integration/e2e/build，以及恶意/超大 spreadsheet fixture。

### R-11 强化 URL 抽取网络边界（F-11/F-14，L）

- 使用可控制 DNS lookup/dispatcher 的 HTTP 客户端，把经过验证的具体 IP 固定到本次 TLS 连接，同时保留原 hostname 做 SNI/Host 校验。
- `lookup(all:true)` 检查全部地址，拒绝任何 private/reserved；每次 redirect 重做并 pin。
- 单一 AbortController 的总 deadline 必须持续到 body 完全读取；把 worker hard signal 合并传入 fetch。
- 私网集合补全 IPv6 ULA、更多 RFC 保留段和特殊 IPv4；优先采用维护良好的 IP 分类库。
- 测试包含慢响应体、无限 body、双 A 记录、DNS 重绑定模拟、redirect 到私网、IPv4-mapped IPv6。

## 4. Phase 2：功能语义与可靠性（第 1 周）

| 修复 | 对应 | 推荐方案 | 工作量 | 关键验证 |
|---|---|---|---:|---|
| R-12 用户删除策略 | F-13 | 不伪造空 FK；推荐“软删除/匿名化用户”保留审计主体。若必须硬删，为所有 actor FK 明确 `SET NULL/RESTRICT` 并 migration | M/L | 有 source/draft/item/audit/chat 的用户删除矩阵 |
| R-13 深度评估诚实化 | F-15 | LLM judge 未实现前拒绝 `deep=true` 或标 `not_implemented`；实现后用结构化 schema、独立状态和失败降级 | M/L | deep 与 heuristic 维度/状态确实不同 |
| R-14 缓存版本化 | F-16 | key 加 backend/model/promptVersion/indexVersion；发布后 bump index generation 并清 L1/L2 | M | 改 prompt/Wiki 后旧 key miss；不同 backend 不串答 |
| R-15 修复 extracted 路径 | F-17 | 抽取文件路径封装为单一 helper，以 source ID 计算；service/worker 共用 | S | file/url draft diff 都返回抽取文本 |
| R-16 worker 并发 | F-18 | 若需要并发，实现固定大小任务池和每 job 独立 heartbeat；否则删除配置并明确单并发 | M | concurrency=2 可同时处理两项且安全停机 |
| R-17 Qoder cleaner 收敛 | F-19 | direct/Qoder 共用 system/user builder；顶层明确 systemPrompt/tools；finally 关闭 generator；每次 race 清 timer/listener | M | 注入样本文本、abort、idle、长任务资源测试 |
| R-18 权限即时撤销 | F-20 | access token 加 `tokenVersion`，敏感请求查轻量 user state；禁用/改角色时递增版本 | M | 旧 token 在变更后立即 401/403 |
| R-19 部署事务化 | F-21 | deploy 编排 backup→dry-run→build→migrate→restart→ready；失败自动保留旧 release/DB 备份 | M/L | staging 故障注入和恢复演练 |
| R-20 提示词数据隔离 | F-22 | evidence 用 tool/data role + 稳定 `[W1]` ID；声明所有检索内容不可信；发布前清洗但不依赖 prompt 防护 | M | 间接注入 corpus；引用只允许 evidence ID |
| R-21 聊天语义修复 | F-23 | token-aware history；Qoder resume 失败用 DB history；partial 标 interrupted 且不缓存；配置 provider 单价 | M | 30 秒 abort、长历史、成本对账 |
| R-22 评测重构 | F-24 | 评分按 retrieval channel/citation/grounding contract，不按内部工具名；direct/Qoder 各有 baseline | M | 同一正确答案跨后端得到一致行为分 |

## 5. Phase 3：工程基线（第 2 周）

- **R-23（F-25）**：对齐 Next/ESLint major，修复 effect 状态模式，使 lint 成为 CI 必过项。
- **R-24（F-26）**：E2E 先点击来源 tab；Playwright 对 standalone 使用 `node .next/standalone/server.js` 并复制/验证 migration 资产；把当前 8 项全部跑绿。
- **R-25（F-27）**：移除 contract 的 `passWithNoTests`，增加 SSE envelope、evidence、错误 envelope、鉴权和 Agent hook contract tests。
- **R-26（F-28）**：空集合显式返回 0，否则 `Math.min(...values)`；API 与前端复用 summary helper。
- **R-27（F-29）**：把“生成 assistant reply”抽成不新增 user message 的内部函数，retry 设置 `reply_to_message_id`；迁移不必回填旧数据，但需明确展示兼容。

## 6. 建议 PR 拆分与依赖

1. **security/git-argv**：R-01，独立、最先合并。
2. **security/chat-guards**：R-02/R-06/R-07，先收紧入口。
3. **knowledge/publish-state-machine**：R-03/R-04，单独大 PR，要求真实 DB+Git 集成测试。
4. **chat/attachments**：R-05，包含 migration 和文件清理。
5. **agent/contracts**：R-09/R-17/R-20，统一 schema 与 prompt builder。
6. **security/render-url-deps**：R-08/R-10/R-11，可分别提交但同一安全里程碑发布。
7. **reliability-and-semantics**：R-12–R-22。
8. **ci-baseline**：R-23–R-27，最后把所有 gate 设为强制。

R-03 与 R-04 应在重新批量处理知识任务前完成；R-09 在依赖 Qoder Web fallback 前完成；R-05 若短期不开发视觉能力，应直接隐藏入口而非留下半成品。

## 7. 发布门禁建议

修复完成后的最低门禁：

```bash
npm ci
npm run typecheck
npm run lint
npm run test:unit
npm run test:integration
npx vitest run --project e2e
npm run test:contract
npm run build
npm run test:e2e
npx tsx scripts/validate-wiki.ts
npm audit --omit=dev
```

此外必须新增三类故障注入测试：发布步骤逐点失败、worker lease 过期竞态、模型/URL 流在 header 后或部分输出后超时。仅有 mock 单测不足以证明 SQLite CHECK/FK、文件和 Git 的跨边界一致性。
