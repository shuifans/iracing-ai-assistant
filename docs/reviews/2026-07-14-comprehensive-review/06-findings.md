# 缺陷与风险清单

## 1. 分级与证据口径

- **P0 / Critical**：可直接导致远程代码执行、核心数据不可逆破坏或密钥泄露，需立即阻断。
- **P1 / High**：核心流程不可用、跨用户越权、显著成本/可用性风险或高概率数据不一致。
- **P2 / Medium**：局部功能失真、恢复性/可维护性不足或需要特定条件触发的安全风险。
- **P3 / Low**：测试、指标、配置和工程卫生问题。
- **已验证缺陷**：有可重复动态实验或确定性测试失败。
- **高可信风险**：静态调用链完整、触发条件明确，但本轮未对生产型外部副作用做利用验证。
- **设计债务**：实现与配置/产品语义不一致，短期不一定直接报错。

## 2. 总览

### 2.1 修复状态（2026-07-14）

- **已修复并复审通过**：F-01 至 F-11（P0/P1 全部）。
- **随 F-11 一并修复**：F-14 的响应体总超时与 worker AbortSignal 传递部分；F-14 仍按原始 P2 编号保留，便于追溯。
- **待后续处理**：F-12 至 F-29 中未被上述依赖升级必要适配覆盖的 P2/P3 项。
- 详细代码、测试、复审和残余风险见 [10-p0-p1-remediation-report.md](10-p0-p1-remediation-report.md)。

| ID | 严重度 | 类型 | 标题 |
|---|---|---|---|
| F-01 | P0 | 高可信风险 | 发布器把 LLM/管理员可控标题拼入 shell，存在命令注入 |
| F-02 | P1 | 已验证缺陷 | Git push 成功路径写入非法状态并破坏发布一致性 |
| F-03 | P1 | 已验证缺陷 | 待人工审核任务会在租约过期后重新入队 |
| F-04 | P1 | 已验证缺陷 | 聊天图片上传必然外键失败，且后续没有绑定/视觉输入链路 |
| F-05 | P1 | 高可信风险 | 限流未接入，普通用户可通过诊断接口放大模型调用成本 |
| F-06 | P1 | 高可信风险 | 停止生成接口未校验消息所有权 |
| F-07 | P1 | 已验证缺陷（静态确定） | Qoder WebSearch 被 URL allowlist 逻辑系统性拒绝 |
| F-08 | P1 | 已验证缺陷（静态确定） | Qoder evidence 生产与消费协议不一致，引用无法落库 |
| F-09 | P1 | 高可信风险 | Markdown 链接协议未过滤，存在持久化脚本 URL 风险 |
| F-10 | P1 | 已验证依赖风险 | 可达的 Next.js / xlsx 高危依赖漏洞 |
| F-11 | P1 | 高可信风险 | URL 抽取的 DNS 检查与实际连接分离，仍可 DNS rebinding |
| F-12 | P2 | 已验证缺陷 | `maxAttempts` 不限制重试次数 |
| F-13 | P2 | 已验证缺陷 | 有知识来源的用户无法删除 |
| F-14 | P2 | 高可信风险 | URL 下载总超时只覆盖响应头，不覆盖响应体 |
| F-15 | P2 | 已验证缺陷（静态确定） | “深度评估”是 no-op，但 API/UI 标记为已深度评估 |
| F-16 | P2 | 设计债务 | 缓存键没有模型、提示词和知识索引版本 |
| F-17 | P2 | 已验证缺陷（静态确定） | 候选稿对比页读取了错误的 extracted 路径 |
| F-18 | P2 | 设计债务 | worker concurrency 配置不生效 |
| F-19 | P2 | 高可信风险 | Qoder 清洗 Agent 配置和资源清理不完整 |
| F-20 | P2 | 设计债务 | 禁用/降权用户的 access token 最长 30 分钟仍保留旧权限 |
| F-21 | P2 | 设计债务 | 实际部署脚本绕开文档中的备份、dry-run 与 readiness 流程 |
| F-22 | P2 | 高可信风险 | 外部知识被提升为 system 指令，grounding 又没有引用校验 |
| F-23 | P2 | 设计债务 | 直连聊天的截断、历史和成本统计语义失真 |
| F-24 | P2 | 设计债务 | 聊天评测按 Qoder 工具名评分，无法正确评价默认 direct 后端 |
| F-25 | P3 | 已验证缺陷 | ESLint 失败且 Next 14 / eslint-config-next 16 版本错位 |
| F-26 | P3 | 已验证缺陷 | 浏览器 E2E 用例未点击 tab；standalone 启动方式也与配置不一致 |
| F-27 | P3 | 测试缺口 | contract 测试目录为空却返回成功 |
| F-28 | P3 | 已验证缺陷（静态确定） | 诊断最快响应始终为 0 |
| F-29 | P3 | 设计债务 | retry 实际复制 user message，与注释和 reply 语义不一致 |

## 3. P0 — 必须立即处理

### F-01 发布器命令注入

- **位置**：`src/modules/knowledge/publisher.ts:224-229,290`。
- **证据**：`title` 来自清洗模型输出/审核稿，随后进入 ``execSync(`git commit -m "knowledge: ${title} ..."`)``；`$()`、反引号等在双引号内仍会被 shell 执行。retry push 也把 remote/branch 拼进 shell。
- **触发**：提交恶意知识内容使模型或审核稿标题包含 shell substitution，知识管理员点击发布；或部署环境中的 Git remote/branch 被污染。
- **影响**：以 Web 进程权限执行任意命令，可读取应用密钥、数据库和 Wiki，严重度为 P0。
- **置信度**：高。为避免产生真实副作用，本轮未执行 payload；Node `execSync(string)` 的 shell 语义和污点链均确定。
- **根因**：把数据参数与命令文本拼接，发布边界没有二次安全规范化。

## 4. P1 — 高优先级

### F-02 Git 同步状态非法并破坏发布一致性

- **位置**：`publisher.ts:221-253,283-295`；合法常量在 `config/constants.ts:58-60`；数据库 CHECK 在初始 migration。
- **证据**：remote 存在时立即赋值 `pushed`，但合法值只有 `committed/push_pending/synced/push_failed`。EXP-04 真实 SQLite 更新返回 `CHECK constraint failed`。
- **影响**：第 7 步已经把 item/draft/job 标为 published，Git commit 也可能已完成；随后状态更新抛错，外层补偿只能尝试 `publishing → pending_review`（必然 CAS 失败），还可能删除/恢复 Wiki 文件，形成 DB、Git、文件三方不一致。
- **根因**：异步 push 被当作同步成功；“八步原子发布”没有真实 DB transaction 或可恢复操作日志；catch 范围覆盖了提交后的不可回滚阶段。

### F-03 待审核任务被过期租约恢复

- **位置**：`worker/processors/knowledge.ts:184-188`；`modules/jobs/repository.ts:426-455`。
- **证据**：EXP-01 中 job 从 `pending_review` 被恢复为 `queued`；lease owner/expiry 是 worker claim 时留下的值。
- **影响**：同一来源重复抽取、再次调用 LLM、旧稿被 supersede，人工正在审核的稿件会被替换；还会增加模型成本。
- **根因**：worker lease 生命周期没有在离开执行态时结束，恢复查询又错误包含人工审核/发布态。

### F-04 图片上传和视觉问答链路不可用

- **位置**：`api/uploads/images/route.ts:75-99`；`db/schema/chat.ts:61-65`；`chat/service.ts:305-319`。
- **证据**：EXP-02 对与 route 相同的 `createAttachment('', ...)` 返回 `FOREIGN KEY constraint failed`。
- **额外问题**：路径硬编码 `/data/uploads`，不使用 `DATA_ROOT`；发送只校验附件 ID 存在，不校验归属、不绑定到新 user message，也不把图像传给任何模型。
- **影响**：UI 上传必然 500；即使移除外键，任意已知 attachment ID 可被复用且模型看不到图片。
- **根因**：设计采用“两阶段上传”，schema 却要求附件创建时已有 message；第二阶段从未实现。

### F-05 限流未接入与诊断接口成本放大

- **位置**：唯一实现 `modules/rate-limit/service.ts:21`；业务代码没有调用；`api/chat/diagnostic/route.ts:44-85`。
- **证据**：全库 `checkRateLimit(` 仅出现在该服务及单测。诊断 POST 只要求 active 普通用户，无 `validateOrigin`/角色守卫，可接受最多 10 个问题并顺序调用完整聊天流水线。
- **影响**：单用户可绕过后台配置持续产生模型调用、写入会话/消息/用量，导致成本和可用性 DoS；`maxSessionTurns` 等限制配置也未执行。
- **根因**：限流模块只实现了管理面和计数器，未成为聊天入口的强制前置守卫。

### F-06 停止生成缺少所有权校验

- **位置**：`chat/service.ts:958-968`；route 传入 `user.id`，但 service 完全未使用。
- **触发**：已认证用户获知另一个正在生成的 assistant message ID。
- **影响**：可 abort 其他用户的活跃请求；当前 ID 为高熵值降低可猜性，但不构成授权控制。
- **根因**：注释宣称“through session ownership”，实现只调用了不带 user 条件的 `getMessage`。

### F-07 Qoder WebSearch 被错误拒绝

- **位置**：`agent/client.ts:77-86,114-126,197-203`；prompt `prompts.ts:99-133`。
- **证据**：PreToolUse 对 WebSearch 取自然语言 `query`，随后调用 `new URL(query)`；正常查询解析失败并 deny。allowlist 中 `reddit.com/r/iRacing` 含路径，但比较对象只有 hostname，所以该条也永远不匹配。prompt 要求 5 turns，实际为 2。
- **影响**：默认 direct 本地未命中时声称“联网检索”的 Qoder fallback 很可能无法执行搜索，回答可用性和证据链下降。
- **根因**：WebSearch query 和 WebFetch URL 被同一个验证器处理，没有按工具输入协议建模。

### F-08 Qoder evidence 协议错位

- **位置**：producer `agent/client.ts:141-161`；consumer `chat/service.ts:589-611`。
- **证据**：hook 把结果改写为 `{"evidence":[...]}`，service 只在 `Array.isArray(parsed)` 时消费；确定性地忽略该对象。
- **影响**：SDK 路径的引用不会进入 `message_sources`，前端缺少来源；grounding/knowledgeHit/评测指标失真。
- **根因**：缺少共享的 evidence schema，hook、SSE mapper 和 service 各自解析。

### F-09 Markdown 链接协议未过滤

- **位置**：`components/chat/MessageBubble.tsx:17-54,157`；`components/admin/SessionDetail.tsx:58-81,162`。
- **证据**：原始 HTML 字符会先 escape，但 Markdown URL 被原样放入 `href`；未限制为 `https/http`，随后用 `dangerouslySetInnerHTML` 渲染。
- **触发**：模型返回或持久化 assistant 内容包含 `[点击](javascript:...)` / 其他危险 scheme，用户点击链接。
- **影响**：可能在应用 origin 执行脚本，且管理员会话质检页也会渲染历史内容，形成持久化攻击面。
- **根因**：自制 regex renderer 不等于 allowlist sanitizer；只处理标签注入，没有处理 URL 协议。

### F-10 高危依赖漏洞位于可达路径

- **证据**：`npm audit --json` 返回 2 high / 5 moderate。
- **影响**：Next 14.2.35 涉及多个服务端 advisory；`xlsx@0.18.5` 的 prototype pollution/ReDoS 位于管理员 Excel 上传抽取路径，不能按“未使用依赖”忽略。
- **约束**：npm 对 Next 给出的自动升级跨到 major；SheetJS registry 包没有直接自动修复，需迁移库或使用经核实的安全发行渠道。

### F-11 DNS 检查与实际连接不绑定

- **位置**：`knowledge/extractors/url.ts:165-180,198-222`。
- **证据**：代码先 `dns.lookup(hostname)` 检查一个地址，随后让全局 `fetch` 独立再次解析；没有把已验证 IP 固定给连接，也没有校验所有 A/AAAA 记录。
- **影响**：攻击者控制 DNS 时可在检查与连接之间改变结果，访问内网/metadata 服务。HTTPS-only、redirect 重验和私网段检查是有效的纵深措施，但没有消除 TOCTOU。
- **根因**：把“DNS 预检”误认为“连接目标约束”。

## 5. P2 — 中优先级

### F-12 `maxAttempts` 不限制重试

- **位置**：`jobs/repository.ts:358-390`。
- **证据**：EXP-03 中 `maxAttempts=3` 的 job 连续 5 次重试成功，attempt 达到 5。
- **影响**：失败任务可无限消耗抽取/LLM 资源，UI 的 `attempt/maxAttempts` 语义失真。

### F-13 有知识来源的用户无法删除

- **位置**：`users/service.ts:121-146`；`knowledge_sources.submitted_by` 是 NOT NULL FK。
- **证据**：EXP-04 执行 service 同构的 `submitted_by=''` 更新返回 `FOREIGN KEY constraint failed`。
- **影响**：任何提交过知识的普通用户都无法通过管理员接口删除；其他 reviewed/published/evaluated actor FK 也缺少完整保留策略。

### F-14 URL 响应体没有总下载超时

- **位置**：`knowledge/extractors/url.ts:203-235,271-306,375-376`。
- **证据**：connect/download 两个 timer 都在 `fetch()` 返回响应头后清除，之后 `reader.read()` 可无限等待慢速或永不结束的 body。
- **影响**：单个恶意 URL 可长期占住唯一 worker；15 分钟 worker hard abort signal没有传入 fetchUrl，因此也不能终止该 reader。

### F-15 深度评估是 no-op

- **位置**：`knowledge-evaluation/service.ts:51-125`。
- **证据**：`deep=true` 只写 `deepEval` 标志；accuracy/completeness/clarity 的 block 只有注释，状态始终 `heuristic_done`。
- **影响**：API/UI 显示“深度”，但分数与普通评估完全相同；若以后把它用于发布门禁，会产生错误信任。

### F-16 缓存没有版本维度

- **位置**：`chat/cache.ts:82-85`；调用处 `chat/service.ts:374-438`。
- **证据**：answer key 只有规范化问题和最近 3 个 message ID；retrieval key 只有问题。模型、backend、system prompt、索引版本都不在 key 中，L2 TTL 24 小时。
- **影响**：提示词、模型或 Wiki 更新后仍可能回放旧答案/旧检索；发布流程不主动失效缓存。

### F-17 候选稿对比读取错误 extracted 路径

- **位置**：worker 写 `DATA_ROOT/extracted/<source-id>.txt`（`worker/processors/knowledge.ts:93-99`）；service 读 `DATA_ROOT/<source.relativePath>/../extracted.txt`（`knowledge/service.ts:401-412`）。
- **影响**：文件来源通常读不到原始抽取文本，URL 来源因 relativePath 为空必定没有对比文本，审核质量下降。

### F-18 worker concurrency 配置不生效

- **位置**：`worker/index.ts:21-45`；`worker/lease-loop.ts:47-54,119-133`。
- **证据**：配置被记录但循环每轮只 claim 一项，并 `await processingPromise` 后才进入下一轮。
- **影响**：把并发设置为大于 1 不会增加吞吐，排队时间和运维预期不符。

### F-19 Qoder 清洗配置与生命周期不完整

- **位置**：`agent/client.ts:259-300`；`worker/processors/knowledge.ts:236-345`。
- **证据**：静态 cleaner prompt 只注册为子 Agent，顶层 query 没有 systemPrompt/allowed tools；子 Agent声明 Write，但全局禁用 Write；原始文档没有不可执行数据边界。每次 `Promise.race` 新建 timer 和 abort listener，胜出后不清理；异常也未显式 `generator.return()`。
- **影响**：模型可能不调用 cleaner 子 Agent、输出协议漂移；长任务积累 timer/listener，超时后底层 SDK 工作可能继续。

### F-20 access token 使用陈旧角色/状态

- **位置**：认证中间件信任 JWT 内 role/status，access token 有效期 30 分钟。
- **影响**：管理员禁用或降权后，已签发 token 最长 30 分钟仍可使用旧权限。对单机 MVP 可接受，但需要明确安全 SLA；敏感管理员路由更适合查 DB 或使用 token version。

### F-21 部署实现绕过安全流程

- **位置**：`scripts/deploy.sh`、`scripts/pre-deploy-migrate.sh`、部署文档。
- **证据**：实际脚本直接 pull/install/build/migrate/restart，没有自动 backup、migration dry-run、readiness gate 或 rollback；pre-deploy 默认 `/data/db/app.sqlite`，正式示例为 `/srv/.../app.sqlite`。
- **影响**：迁移或启动失败时恢复依赖人工；未加载环境时可能检查/迁移错误数据库。

### F-22 间接 prompt injection 与伪 grounding

- **位置**：`agent/llm-client.ts:71-86`；`prompts.ts:28-36,47-50`；`chat/service.ts:512`。
- **证据**：Wiki excerpt 直接拼进 system message，获得与硬规则相同的角色优先级；prompt 只防 user injection。代码只要 evidence 非空就标 grounded，不检查答案是否引用或忠于 evidence。
- **影响**：被污染的知识内容可以影响高权限指令；来源卡片存在并不代表回答受证据支持。

### F-23 直连聊天语义和统计失真

- **位置**：`chat/service.ts:477-528`，`session-context.ts`。
- **问题**：只取最近 6 条消息，已实现的 20 轮/40K history loader 未使用；30 秒超时有部分文本就按 complete 保存并可能进入缓存；direct 成本固定为 0。
- **影响**：长对话上下文突降、截断答案看似正常完结、成本面板低估实际费用。

### F-24 评测脚本与默认后端不对齐

- **位置**：`scripts/eval-chat.ts`、`scripts/eval-cases.json`。
- **证据**：行为期望绑定 `wiki-search` 等 Qoder 工具事件，而默认 llm-direct 的本地 BM25 不产生该事件；脚本即使跑 direct 仍要求 Qoder PAT。
- **影响**：正确的 direct 回答也可能被评为行为失败，指标无法用于发布门禁或后端比较。

## 6. P3 — 工程与测试问题

### F-25 Lint 基线失败

`npm run lint` 在 `app/(admin)/admin/sessions/page.tsx:115` 因 effect 内同步 setState 失败。运行时 Next 14.2.35 与 `eslint-config-next` 16.2.10 也明显错位，使 build 通过、独立 lint 失败。

### F-26 浏览器 E2E 测试漂移与启动方式不一致

Playwright 7/8 通过；失败用例 `tests/e2e-browser/knowledge.smoke.spec.ts:16-23` 只检查“来源管理”tab 可见，却未点击，页面默认 `overview`，所以“下一页”不在 DOM。另 `playwright.config.ts` 用 `next start` 启动 `output:'standalone'` 构建，Next 明确警告应运行 standalone server；instrumentation 还报告 standalone chunks 中 migration 路径缺失。

### F-27 contract 测试空跑

`npm run test:contract` 退出 0，但没有 `tests/contract` 用例，`passWithNoTests` 掩盖了 API/SSE/Agent 协议缺口。

### F-28 诊断最快响应恒为 0

`api/chat/diagnostic/route.ts:171-174` 和前端同类逻辑都执行 `Math.min(...positiveValues, 0)`，因此非负耗时下结果必为 0。

### F-29 retry 的消息模型与注释不一致

`retryMessage` 注释要求“只创建新的 assistant 并 reply_to 原 user”，实际复用 `streamChatMessage`，从原 user content 再创建一条 user message；普通发送也没有设置 `reply_to_message_id`。这会污染会话历史和缓存上下文。

## 7. 已排除或重新分类

- Browser E2E 的分页失败不是后端分页回归：同文件 API 用例验证 `meta.nextCursor` 通过；根因是 UI 测试没点击 tab。
- Wiki 内容格式不是当前缺陷：`npx tsx scripts/validate-wiki.ts` 验证 18/18 篇通过。
- TypeScript/build/单元/集成测试当前均通过；这不能覆盖上述跨模块不变量，因为相应测试不存在或 mock 掉了 SQLite CHECK/FK。
- 第一次 EXP-01 的 SQL 引号错误属于审计脚本错误，已在 `05-verification-log.md` 保留并排除。
