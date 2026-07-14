# LLM、Agent 与提示词审计

## 1. 调用点总览

| ID | 调用 | 位置 | 模型/参数 | 输入来源 |
|---|---|---|---|---|
| LLM-1 | 聊天直连 | `src/modules/agent/llm-client.ts` | OpenAI-compatible；temperature 0.3；max_tokens 1000；stream | system prompt + BM25 evidence + 最近 6 条消息 + 当前问题 |
| AG-1 | Qoder 聊天主 Agent | `src/modules/agent/client.ts:createChatQuery` | 默认 Qwen3.7-Plus；reasoning high；maxTurns 6 | 当前问题 + 可选 resume session |
| AG-2 | wiki-search 子 Agent | 同上 | effort medium；maxTurns 5 | 主 Agent 派发问题；Read/Glob/Grep |
| AG-3 | web-research 子 Agent | 同上 | effort medium；实际 maxTurns 2 | 主 Agent 派发问题；WebSearch/WebFetch |
| LLM-2 | 知识清洗直连 | `src/modules/knowledge/llm-cleaner.ts` | temperature 0.2；worker max_tokens 2500；seed 6000 | 原始文本≤40K + URL/hint + reviewer feedback |
| AG-4 | Qoder 知识清洗 | `createCleaningQuery` / worker | reasoning high；maxTurns 8 | 原始文本 + draft ID + feedback |
| AG-5 | seed-wiki Qoder fallback | `scripts/seed-wiki.ts` | maxTurns 3 | 与 direct cleaner 共用 system/user builder |
| AG-6 | 模型连通性测试 | `scripts/test-model.ts` | maxTurns 2，无工具 | 固定句“只回复 Model is working.” |

知识评估的 LLM judge 仅有注释和 3 个预留维度，没有实际调用或提示词。

## 2. CHAT_SYSTEM_PROMPT

位置：`src/modules/agent/prompts.ts:14`。

目标：限定 iRacing 范围、宽泛问题先澄清、优先 Wiki、要求事实引用、区分推理和事实、数字带上下文、抵抗用户 prompt injection、复杂争议升级真人专家；输出 Markdown，原则上 <400 words。

优点：目标和拒答边界明确，明确要求证据、单位和不确定性，约束比普通客服 prompt 完整。

问题：

- 同一个 prompt 同时服务 direct 与 Qoder，但规则写死“Wiki 已预检索、不要声称搜索”。Qoder 路径实际需要自主调用搜索 Agent，语义冲突。
- direct 路径把检索内容直接追加到 system message，知识内容获得与硬规则同等优先级。恶意/污染 Wiki 可以进行间接 prompt injection。
- 仅说忽略用户注入，没有说明 Retrieved Wiki Context、网页结果、历史 assistant 文本同样是不可信数据。
- “每个事实必须引用”没有机器可验证的引用格式，后端也没有验证答案中的引用确实对应 evidence。
- “insufficient” grounding 是代码启发式，不是模型结构化输出；有文本无 evidence 就被标 inferred，即使文本包含事实。

建议：为 direct/Qoder 分拆 system prompt；evidence 放入独立 tool/user data message并用不可混淆边界封装；要求稳定引用 ID（如 `[W1]`）；后处理校验引用集合和协议。

## 3. WIKI_SEARCH_PROMPT

位置：`src/modules/agent/prompts.ts:68`。

要求只读 Wiki、使用 Read/Glob/Grep、返回最多结构化 evidence JSON、无结果返回 `[]`、最多 5 turns。

问题：JSON 只由自然语言约束，没有 schema/tool contract；`PostToolUse` 用正则抓第一个 `[...]`，对嵌套数组、正文方括号和额外文本脆弱。路径安全 hook 使用字符串前缀比较，允许 `/wiki-root-evil` 这类同前缀兄弟目录。

## 4. WEB_RESEARCH_PROMPT

位置：`src/modules/agent/prompts.ts:99`。

要求仅查询 7 个 iRacing 域名、先 WebSearch 后 WebFetch、输出 JSON evidence、优先官方。

实现与提示词存在三处冲突：

1. prompt 说最多 5 turns，AgentDefinition 实际 `maxTurns: 2`。
2. PreToolUse 把 WebSearch 的自然语言 `query` 当 URL 解析；正常搜索词无法通过 allowlist，因而 WebSearch 会被拒绝。
3. allowlist 条目 `reddit.com/r/iRacing` 含路径，但校验只比较 hostname，因此 Reddit 永远不匹配。

正确边界应区分 WebSearch 与 WebFetch：Search 对 query 不做 URL 解析，但限制结果/后续 fetch 域；Fetch 严格解析 URL，并分别校验 hostname 与 pathname。

## 5. KNOWLEDGE_CLEANER_PROMPT 与 direct builder

静态 Qoder 版本位于 `prompts.ts:139`；direct 版本由 `buildCleanerSystemPrompt` 动态生成。两者都要求：

- 输出必须以 YAML Front Matter 开始。
- 分类/子分类只能来自固定枚举。
- 保持源语言、数值与单位，不添加源文不存在的内容。
- 清除导航/广告，组织 H1/H2/H3、表格、图片占位。
- worker 输出目标 <4,500 字符。

动态 user prompt 结构：来源 URL/hint → `RAW TEXT START/END` 中最多 40K 字符 → 输出要求 → reviewer feedback。

问题：

- Qoder worker 版本把原始文本直接拼在“Clean...”后，没有 `RAW TEXT` 边界，且没有把静态 cleaner prompt 设置为顶层 `systemPrompt`；它只是注册为子 Agent prompt。主 Agent 是否调用该子 Agent依赖模型自行路由。
- cleaner 子 Agent 声明 `tools: ['Read','Write']`，同时全局 disallowedTools 包含 `Write`，配置自相矛盾。
- 原始网页/文档与 reviewer feedback 均可能包含指令；prompt 未明确它们是不可执行的数据。
- direct 与 Qoder 的长度规则虽已基本对齐，但 seed direct 默认仍允许 3,000 words，而 worker/静态 Qoder 为 4,500 chars。
- 仅校验 Front Matter/长度，不能验证内容忠实性；人工审核是当前唯一事实门禁。

建议：所有清洗后端共享完全相同的 system/user builder；原始文本用明确的不可执行数据结构承载；采用结构化输出 schema；把 source URL 从模型输出中覆盖为服务端可信值；对 title/tags 做安全规范化并在发布前再次验证。

## 6. 历史、缓存与上下文

- direct 使用最近 6 条 complete 消息，约 3 轮，无字符/token 截断。
- `loadHistoryContext` 支持 20 轮/40K 字符，但主聊天流程导入后未使用。
- Qoder 依赖 `qoder_session_id` resume，不注入 DB 历史；若 SDK resume 数据失效，DB“source of truth”承诺不成立。
- answer cache key 用最近 3 个消息 ID，不包含模型、system prompt 版本、检索索引版本、backend、temperature；部署更新提示词或知识后，L2 仍可回放最多 24 小时旧答案。
- retrieval cache 同样没有索引版本，Wiki 发布后旧检索结果不会立即失效。

建议把 `backend:model:promptVersion:indexVersion` 纳入 key；发布成功主动失效相关 cache；用 token-aware 历史裁剪，并为 Qoder resume 失败提供 DB history fallback。

## 7. Evidence 与 grounding 协议

Qoder hook 把证据改写成 `{"evidence":[...]}`，聊天消费者却只接受根节点数组；因此 SDK 路径通常无法持久化 evidence。direct 路径则无条件把“有检索结果”等价为 grounded，没有验证模型是否使用/引用该片段。

建议定义单一 Zod schema，在 hook、service、SSE mapper、DB 四处复用；grounding 由引用验证结果决定，不由 `evidence.length > 0` 决定。

## 8. 成本、超时和降级

- direct 聊天 30 秒；本地未命中时 Qoder fallback 60 秒；Qoder 主路径默认 120 秒。
- direct 超时有部分文本就标 complete，用户无法区分正常完结与截断。
- worker 有 15 分钟硬超时；Qoder idle timeout 30 秒，但每次 race 创建的 timer/listener 在 generator 先返回时不清理，会累积悬挂 timer/listener。
- 业务限流模块未接线；诊断接口单请求最多连续发起 10 次模型调用。
- direct 成本固定写 0；若 provider 计费，管理后台成本统计失真。

## 9. 评测提示词/用例

`scripts/eval-cases.json` 有 5 场景 17 轮，覆盖 Wiki、Web、推理、拒答、澄清和多轮。标注仍以 Qoder 子 Agent 工具为准；默认 `llm-direct` 本地检索不会产生 `wiki-search` 工具事件，因此行为符合率会把正确 direct 回答误判为失败。脚本还无条件要求 Qoder PAT，即使只跑已配置的 direct backend。

应把预期从“具体工具名”提升为“retrieval channel/grounding/citation contract”，并分别维护 direct 与 Qoder baseline。
