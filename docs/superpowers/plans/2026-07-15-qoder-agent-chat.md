# Qoder Agent 单链路问答实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 删除聊天 `llm-direct` 与应用侧检索编排，让固定模型 `Qwen3.7-Plus` 通过 Qoder SDK 直接完成多轮理解、本地 Wiki 检索和会话级可选联网，并提供管理员可维护的 Web 来源及前端进度反馈。

**Architecture:** 聊天服务每轮只创建或 resume 一个 Qoder Query；新 Session 传一次 System Prompt，resume 轮次只传当前用户消息。应用根据业务会话开关决定是否暴露 Web 工具，并通过动态来源规则、Query 级预算 Hook、证据采集和 SSE 映射提供安全与可观察边界，不判断检索是否命中。

**Tech Stack:** Next.js 15 Route Handlers、React 19、TypeScript、Qoder Agent SDK、Drizzle ORM、SQLite、Zod、Vitest、Playwright。

## Global Constraints

- 聊天模型固定为 `Qwen3.7-Plus`，`resolveModel` 使用 `reasoningEffort: 'high'`。
- 问答链路不得调用 OpenAI 兼容 Chat Completion；知识清洗的 OpenAI 兼容 Provider 不受影响。
- Qoder `session_id + resume` 是唯一多轮上下文；禁止把数据库消息历史注入模型。
- 联网默认关闭，按会话持久化；开启后也由 Agent 自主执行本地优先策略。
- 每轮 WebSearch 最多 1 次、WebFetch 最多 2 次、Query 最多 6 turns、整体超时 120 秒。
- Web 来源运行时事实源是 SQLite；`notes/knowledge-sources.md` 是确定性生成的可审阅快照。
- 前端不展示 thinking delta、完整敏感工具输入或内部思维链。

---

### Task 1: 持久化会话联网状态和 Web 来源

**Files:**
- Create: `src/db/migrations/20260715000000_G_qoder_agent_chat.sql`
- Create: `src/db/schema/web-sources.ts`
- Modify: `src/db/schema/chat.ts`
- Modify: `src/db/schema/index.ts`
- Modify: `src/modules/chat/repository.ts`
- Modify: `src/modules/chat/types.ts`
- Test: `tests/integration/modules/chat/repository.test.ts`
- Test: `tests/integration/modules/web-sources/repository.test.ts`

**Interfaces:**
- Produces: `ChatSession.webSearchEnabled: boolean`.
- Produces: `updateSessionWebSearch(sessionId: string, userId: string, enabled: boolean): ChatSession | null`.
- Produces: `webKnowledgeSources` table and `WebKnowledgeSource` / `NewWebKnowledgeSource` types.

- [ ] **Step 1: 写失败的数据库迁移与会话仓库测试**

```ts
it('defaults a new session to web search disabled', () => {
  const session = createSession(user.id);
  expect(session.webSearchEnabled).toBe(false);
});

it('updates web search only for the owning user', () => {
  expect(updateSessionWebSearch(session.id, owner.id, true)?.webSearchEnabled).toBe(true);
  expect(updateSessionWebSearch(session.id, other.id, false)).toBeNull();
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npm run test:integration -- tests/integration/modules/chat/repository.test.ts tests/integration/modules/web-sources/repository.test.ts`

Expected: FAIL，提示 `webSearchEnabled`、`updateSessionWebSearch` 或 `web_knowledge_sources` 尚不存在。

- [ ] **Step 3: 增加迁移和 Drizzle Schema**

```sql
ALTER TABLE chat_sessions ADD COLUMN web_search_enabled INTEGER NOT NULL DEFAULT 0;

CREATE TABLE web_knowledge_sources (
  id TEXT PRIMARY KEY NOT NULL,
  name TEXT NOT NULL,
  scope_type TEXT NOT NULL CHECK (scope_type IN ('domain', 'path', 'exact_url')),
  url TEXT NOT NULL,
  source_level TEXT NOT NULL CHECK (source_level IN ('official', 'community')),
  enabled INTEGER NOT NULL DEFAULT 1,
  description TEXT,
  created_by TEXT NOT NULL REFERENCES users(id),
  updated_by TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE UNIQUE INDEX idx_web_knowledge_sources_url_scope
  ON web_knowledge_sources(url, scope_type);
CREATE INDEX idx_web_knowledge_sources_enabled
  ON web_knowledge_sources(enabled, source_level);
```

在 `src/db/schema/web-sources.ts` 使用 `integer('enabled', { mode: 'boolean' })`，并从 `src/db/schema/index.ts` 导出。

- [ ] **Step 4: 实现会话字段与所有权更新**

```ts
export function updateSessionWebSearch(
  sessionId: string,
  userId: string,
  enabled: boolean,
): ChatSession | null {
  const db = getDb();
  db.update(chatSessions)
    .set({ webSearchEnabled: enabled, updatedAt: utcNow() })
    .where(and(eq(chatSessions.id, sessionId), eq(chatSessions.userId, userId)))
    .run();
  return getSession(sessionId, userId);
}
```

同时把 `webSearchEnabled: false` 加入 `createSession`，并补齐管理员会话显式 select/mapping。

- [ ] **Step 5: 运行数据库测试**

Run: `npm run test:integration -- tests/integration/modules/chat/repository.test.ts tests/integration/modules/web-sources/repository.test.ts`

Expected: PASS。

- [ ] **Step 6: 提交**

```bash
git add src/db/migrations/20260715000000_G_qoder_agent_chat.sql src/db/schema/chat.ts src/db/schema/web-sources.ts src/db/schema/index.ts src/modules/chat/repository.ts src/modules/chat/types.ts tests/integration/modules/chat/repository.test.ts tests/integration/modules/web-sources/repository.test.ts
git commit -m "feat(chat): persist web search session state"
```

### Task 2: Web 来源校验、CRUD、快照和审计

**Files:**
- Create: `src/modules/web-sources/types.ts`
- Create: `src/modules/web-sources/schemas.ts`
- Create: `src/modules/web-sources/repository.ts`
- Create: `src/modules/web-sources/service.ts`
- Create: `src/modules/web-sources/snapshot.ts`
- Create: `src/app/api/knowledge/web-sources/route.ts`
- Create: `src/app/api/knowledge/web-sources/[id]/route.ts`
- Modify: `src/modules/audit/types.ts`
- Modify: `src/config/env.ts`
- Modify: `.env.example`
- Test: `tests/unit/modules/web-sources/schemas.test.ts`
- Test: `tests/unit/modules/web-sources/snapshot.test.ts`
- Test: `tests/integration/api/knowledge/web-sources.test.ts`

**Interfaces:**
- Consumes: `WebKnowledgeSource` from Task 1.
- Produces: `WebSourceRule = { id; name; scopeType; url; hostname; pathPrefix?; sourceLevel }`.
- Produces: `listEnabledWebSourceRules(): WebSourceRule[]`.
- Produces: CRUD methods `createWebSource`, `updateWebSource`, `deleteWebSource`, `listWebSources`.
- Produces: `writeWebSourcesSnapshot(sources, snapshotPath): void`.

- [ ] **Step 1: 写 URL 规范化和范围匹配失败测试**

```ts
it.each(['http://iracing.com', 'https://user@iracing.com', 'https://iracing.com:444'])
  ('rejects unsafe source URL %s', (url) => {
    expect(() => webSourceInputSchema.parse({
      name: 'bad', scopeType: 'domain', url,
      sourceLevel: 'official', enabled: true,
    })).toThrow();
  });

it('normalizes a path source', () => {
  expect(normalizeWebSourceUrl('path', 'https://reddit.com/r/iRacing/')).toBe(
    'https://reddit.com/r/iRacing',
  );
});
```

- [ ] **Step 2: 运行单元测试确认失败**

Run: `npm run test:unit -- tests/unit/modules/web-sources/schemas.test.ts tests/unit/modules/web-sources/snapshot.test.ts`

Expected: FAIL，模块尚不存在。

- [ ] **Step 3: 实现类型、Zod 校验和规则映射**

```ts
export type WebSourceScope = 'domain' | 'path' | 'exact_url';
export type WebSourceLevel = 'official' | 'community';

export interface WebSourceRule {
  id: string;
  name: string;
  scopeType: WebSourceScope;
  url: string;
  hostname: string;
  pathPrefix?: string;
  sourceLevel: WebSourceLevel;
}
```

`normalizeWebSourceUrl` 必须强制 HTTPS、空 credentials、空 port、无 trailing-dot hostname，并对 `%2f`、`%5c`、`%2e` 编码路径拒绝。`domain` 只保留 origin，`path` 去除尾部 `/`，`exact_url` 保留规范 pathname/query。

- [ ] **Step 4: 实现 CRUD、确定性快照与审计动作**

新增审计动作：

```ts
'web_source.created'
'web_source.updated'
'web_source.deleted'
'web_source.enabled'
'web_source.disabled'
```

新增审计资源 `web_knowledge_source`。每次成功变更在同一服务调用中写审计，然后按 `sourceLevel, name, url` 排序生成 Markdown：

```md
# iRacing AI 助手 Web 知识源

> 此文件由知识源管理后台从数据库生成，请勿手工编辑。

| 状态 | 级别 | 名称 | 范围 | URL | 说明 |
|---|---|---|---|---|---|
```

使用临时文件加 `renameSync` 原子替换。路径读取 `WEB_KNOWLEDGE_SOURCES_SNAPSHOT_PATH`，默认 `path.join(process.cwd(), 'notes/knowledge-sources.md')`。

- [ ] **Step 5: 实现管理员 API**

`GET/POST /api/knowledge/web-sources` 和 `PATCH/DELETE /api/knowledge/web-sources/:id` 都使用：

```ts
const user = await requireAuth(request);
requireActiveUser(user);
requireRole(user, 'knowledge_admin', 'admin');
validateOrigin(request); // mutation only
```

POST 返回 201，PATCH 返回更新后的来源，DELETE 返回 `{ deleted: true }`。每个 mutation 将 `user.id` 传入 service 作为 actor。

- [ ] **Step 6: 运行来源模块与 API 测试**

Run: `npm run test:unit -- tests/unit/modules/web-sources && npm run test:integration -- tests/integration/api/knowledge/web-sources.test.ts`

Expected: PASS，包括普通用户 403、非法 URL 400、CRUD 和快照更新。

- [ ] **Step 7: 提交**

```bash
git add src/modules/web-sources src/app/api/knowledge/web-sources src/modules/audit/types.ts src/config/env.ts .env.example tests/unit/modules/web-sources tests/integration/api/knowledge/web-sources.test.ts
git commit -m "feat(knowledge): manage agent web sources"
```

### Task 3: 管理后台 Web 来源页面

**Files:**
- Create: `src/components/knowledge/WebSourceManager.tsx`
- Modify: `src/app/(app)/knowledge/page.tsx`
- Test: `tests/unit/components/knowledge/WebSourceManager.test.tsx`

**Interfaces:**
- Consumes: Task 2 API response `{ data: { sources: WebKnowledgeSource[] } }`.
- Produces: `WebSourceManager` client component with create/edit/enable/disable/delete actions.

- [ ] **Step 1: 写管理组件失败测试**

```tsx
it('renders configured sources and can disable one', async () => {
  vi.mocked(authFetch).mockResolvedValueOnce(jsonResponse({
    data: { sources: [{ id: 's1', name: 'iRacing Support', scopeType: 'domain',
      url: 'https://support.iracing.com', sourceLevel: 'official', enabled: true }] },
  }));
  render(<WebSourceManager />);
  expect(await screen.findByText('iRacing Support')).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: '停用 iRacing Support' }));
  expect(authFetch).toHaveBeenCalledWith('/api/knowledge/web-sources/s1',
    expect.objectContaining({ method: 'PATCH' }));
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npm run test:unit -- tests/unit/components/knowledge/WebSourceManager.test.tsx`

Expected: FAIL，组件不存在。

- [ ] **Step 3: 实现来源表格和编辑表单**

组件必须提供：名称、范围类型、URL、官方/社区、启用状态和说明字段；显示后端验证错误；删除使用 `ConfirmDialog`；成功/失败使用 `Toast`；所有按钮有包含来源名的 aria-label。

知识管理页新增 Tab：

```ts
{ id: 'web-sources', label: '联网知识源' }
```

对应内容只渲染 `<WebSourceManager />`，避免继续膨胀页面内数据 hook。

- [ ] **Step 4: 运行组件测试**

Run: `npm run test:unit -- tests/unit/components/knowledge/WebSourceManager.test.tsx`

Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add src/components/knowledge/WebSourceManager.tsx 'src/app/(app)/knowledge/page.tsx' tests/unit/components/knowledge/WebSourceManager.test.tsx
git commit -m "feat(knowledge): add web source manager"
```

### Task 4: 将 Qoder Client 收敛为直接工具 Agent

**Files:**
- Modify: `src/modules/agent/client.ts`
- Modify: `src/modules/agent/types.ts`
- Modify: `src/modules/agent/prompts.ts`
- Test: `tests/unit/modules/agent/client.test.ts`
- Test: `tests/unit/modules/agent/prompts.test.ts`

**Interfaces:**
- Consumes: `listEnabledWebSourceRules(): WebSourceRule[]` and snapshot path from Task 2.
- Produces: `createChatQuery(config, options)` where options add `webSearchEnabled`, `loadWebSourceRules`, `webSourcesSnapshotPath`, `onEvidence`.
- Produces: Query-local Web budget and `Evidence` callbacks for direct `Read` / `WebFetch` calls.

- [ ] **Step 1: 替换旧子 Agent 测试为单 Agent 失败测试**

```ts
it('uses Qwen3.7-Plus and direct local tools without sub-agents', () => {
  createChatQuery(baseConfig, { ...baseOptions, webSearchEnabled: false });
  const options = lastCallArgs().options;
  expect(options.resolveModel({})).resolves.toMatchObject({ model: 'Qwen3.7-Plus' });
  expect(options.tools).toEqual(['Read', 'Glob', 'Grep']);
  expect(options.agents).toBeUndefined();
  expect(options.allowedTools).not.toContain('Agent');
});

it('adds web tools only when the session enables them', () => {
  createChatQuery(baseConfig, { ...baseOptions, webSearchEnabled: true });
  expect(lastCallArgs().options.tools).toEqual([
    'Read', 'Glob', 'Grep', 'WebSearch', 'WebFetch',
  ]);
});

it('sends the system prompt only when resume is absent', () => {
  createChatQuery(baseConfig, baseOptions);
  expect(lastCallArgs().options.systemPrompt).toBe(CHAT_SYSTEM_PROMPT);
  createChatQuery(baseConfig, { ...baseOptions, qoderSessionId: 'session-1' });
  expect(lastCallArgs().options.systemPrompt).toBeUndefined();
});
```

- [ ] **Step 2: 运行 Agent 测试确认失败**

Run: `npm run test:unit -- tests/unit/modules/agent/client.test.ts tests/unit/modules/agent/prompts.test.ts`

Expected: FAIL，仍存在子 Agent、静态 allowlist 和重复 System Prompt。

- [ ] **Step 3: 重写主 Prompt 并删除子 Agent 定义**

Prompt 必须逐条落实规格中的范围锁定、`KNOWLEDGE.md -> index.md -> Details`、本地有效即停止、Web 仅补缺、来源引用、注入防护和不输出思维链。删除 `WIKI_SEARCH_PROMPT`、`WEB_RESEARCH_PROMPT`、`WEB_RESEARCH_MAX_TURNS` 和 `chatAgentDefinitions`。

- [ ] **Step 4: 实现 Query 级动态 Hook 与预算**

```ts
const budget = { webSearch: 0, webFetch: 0 };

if (toolName === 'WebSearch' && ++budget.webSearch > 1) {
  return deny('WEB_TOOL_BUDGET_EXHAUSTED');
}
if (toolName === 'WebFetch' && ++budget.webFetch > 2) {
  return deny('WEB_TOOL_BUDGET_EXHAUSTED');
}
```

每次 Web 调用通过 `options.loadWebSourceRules()` 读取最新启用规则。WebSearch 必须含已授权 `site:hostname` 且不得包含未授权 site；WebFetch 按 domain/path/exact_url 匹配。文件工具只允许 `config.wikiRoot` 或与 `webSourcesSnapshotPath` 完全相等的 Read；不得允许 Glob/Grep 扫描整个 notes 目录。

Budget 只在校验通过、即将允许调用时递增，非法调用不能消耗合法预算。

- [ ] **Step 5: 采集直接工具证据而不修改模型工具输出**

PostToolUse 对 `Read` 和 `WebFetch` 调用 `options.onEvidence`：

```ts
options.onEvidence?.({
  evidenceId: generateId(),
  type: toolName === 'Read' ? 'wiki' : 'web',
  title: deriveEvidenceTitle(toolInput),
  wikiPath: toolName === 'Read' ? relativeWikiPath : undefined,
  url: toolName === 'WebFetch' ? canonicalUrl : undefined,
  excerpt: extractToolText(toolResponse).slice(0, 600),
  retrievedAt: utcNow(),
});
```

不得用 `updatedToolOutput` 把 Read/WebFetch 原始内容替换成 evidence envelope；Agent 必须继续看到完整工具结果。

- [ ] **Step 6: 运行 Agent 测试**

Run: `npm run test:unit -- tests/unit/modules/agent/client.test.ts tests/unit/modules/agent/prompts.test.ts`

Expected: PASS，包括首轮/恢复 Prompt、动态工具、来源规则、预算和证据回调。

- [ ] **Step 7: 提交**

```bash
git add src/modules/agent/client.ts src/modules/agent/types.ts src/modules/agent/prompts.ts tests/unit/modules/agent/client.test.ts tests/unit/modules/agent/prompts.test.ts
git commit -m "refactor(agent): make qoder the direct chat agent"
```

### Task 5: 聊天服务只保留 Qoder SDK

**Files:**
- Modify: `src/modules/chat/service.ts`
- Delete: `src/modules/agent/llm-client.ts`
- Delete: `src/modules/chat/cache.ts`
- Delete: `tests/unit/modules/agent/llm-client.test.ts`
- Modify: `tests/unit/modules/chat/service.test.ts`

**Interfaces:**
- Consumes: Task 4 `createChatQuery` and Task 1 session flag.
- Produces: one Qoder Query per message, plus a single retry with a new Session only for recognized resume failure.

- [ ] **Step 1: 写 qoder-only 服务失败测试**

```ts
it('always creates a qoder query with the session web flag', async () => {
  mockGetSession.mockReturnValue({ ...session, webSearchEnabled: true });
  await collect(streamChatMessage(user, session.id, 'current question'));
  expect(mockCreateChatQuery).toHaveBeenCalledWith(expect.anything(),
    expect.objectContaining({
      userMessage: 'current question',
      qoderSessionId: session.qoderSessionId,
      webSearchEnabled: true,
    }));
  expect(mockSearchWiki).not.toHaveBeenCalled();
});
```

删除 Direct、缓存命中和 BM25 阈值测试，增加“没有读取历史并拼 Prompt”的断言。

- [ ] **Step 2: 运行服务测试确认失败**

Run: `npm run test:unit -- tests/unit/modules/chat/service.test.ts`

Expected: FAIL，服务仍分流 Direct/SDK 并访问 cache/searchWiki。

- [ ] **Step 3: 删除分流、缓存和 Direct 调用**

`streamChatMessage` 在持久化 pending 消息后直接：

```ts
const evidenceList: Evidence[] = [];
const query = createChatQuery(config, {
  userMessage: content,
  qoderSessionId: session.qoderSessionId ?? undefined,
  webSearchEnabled: session.webSearchEnabled,
  imageAttachments,
  abortController,
  webSourcesSnapshotPath: resolveWebSourcesSnapshotPath(),
  loadWebSourceRules: listEnabledWebSourceRules,
  onEvidence: (evidence) => {
    if (!evidenceList.some((item) => item.evidenceId === evidence.evidenceId)) {
      evidenceList.push(evidence);
    }
  },
});
```

删除 `CHAT_ANSWER_BACKEND`、`searchWiki`、answer/retrieval cache、Direct history 和 30/60 秒分支。保留 Qoder usage、compaction、retry telemetry、停止、图片、来源和消息持久化。

- [ ] **Step 4: 实现一次 resume 失败恢复**

仅当 SDK error subtype/message 匹配 `resume|session` 且包含 `not found|invalid|expired` 时：清空数据库 `qoderSessionId`，用相同当前消息创建无 resume Query，最多重试一次。不得读取或注入数据库历史；普通模型、认证、超时错误不得重试为新 Session。

- [ ] **Step 5: 运行服务测试**

Run: `npm run test:unit -- tests/unit/modules/chat/service.test.ts`

Expected: PASS，包括 qoder-only、联网快照、证据持久化、resume 恢复和无答案缓存。

- [ ] **Step 6: 提交**

```bash
git add src/modules/chat/service.ts tests/unit/modules/chat/service.test.ts
git rm src/modules/agent/llm-client.ts src/modules/chat/cache.ts tests/unit/modules/agent/llm-client.test.ts
git commit -m "refactor(chat): remove direct llm answer path"
```

### Task 6: 会话 API 和聊天联网开关 UI

**Files:**
- Modify: `src/app/api/chat/sessions/[id]/route.ts`
- Modify: `src/app/(app)/chat/[sessionId]/page.tsx`
- Modify: `src/components/chat/ChatInput.tsx`
- Test: `tests/unit/api/chat/sessions.route.test.ts`
- Test: `tests/unit/components/chat/ChatInput.test.tsx`

**Interfaces:**
- Consumes: `updateSessionWebSearch` from Task 1.
- Produces: `PATCH /api/chat/sessions/:id` body `{ webSearchEnabled: boolean }`.
- Produces: controlled `ChatInput` props `webSearchEnabled`, `onWebSearchChange`, `webSearchUpdating`.

- [ ] **Step 1: 写 API 与开关组件失败测试**

```ts
it('updates the owned session web flag', async () => {
  const response = await PATCH(request({ webSearchEnabled: true }), params(session.id));
  expect(response.status).toBe(200);
  expect(updateSessionWebSearch).toHaveBeenCalledWith(session.id, user.id, true);
});

it('shows the persistent web mode and warning', async () => {
  render(<ChatInput {...baseProps} webSearchEnabled onWebSearchChange={onChange} />);
  expect(screen.getByRole('switch', { name: '联网搜索' })).toBeChecked();
  expect(screen.getByText(/优先使用本地知识库/)).toBeInTheDocument();
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npm run test:unit -- tests/unit/api/chat/sessions.route.test.ts tests/unit/components/chat/ChatInput.test.tsx`

Expected: FAIL，API 只支持 title 且 ChatInput 没有联网 props。

- [ ] **Step 3: 扩展 PATCH 会话接口**

PATCH body 必须严格二选一：有效 `title` 或 boolean `webSearchEnabled`。联网分支调用所有权更新并返回 `{ id, webSearchEnabled }`；未知字段或同时传两个字段返回 `VALIDATION_ERROR`。

- [ ] **Step 4: 实现会话持久开关**

SessionPage 从 GET response 初始化 `session.webSearchEnabled`。切换时先禁用 switch，PATCH 成功后更新状态，失败则保持旧值并显示错误。ChatInput 使用 `role="switch"`、`aria-checked` 和文案：

```text
优先使用本地知识库；仅本地资料不足时访问管理员授权的网站。联网回答可能需要最多约 2 分钟。
```

- [ ] **Step 5: 运行 API 与组件测试**

Run: `npm run test:unit -- tests/unit/api/chat/sessions.route.test.ts tests/unit/components/chat/ChatInput.test.tsx`

Expected: PASS。

- [ ] **Step 6: 提交**

```bash
git add 'src/app/api/chat/sessions/[id]/route.ts' 'src/app/(app)/chat/[sessionId]/page.tsx' src/components/chat/ChatInput.tsx tests/unit/api/chat/sessions.route.test.ts tests/unit/components/chat/ChatInput.test.tsx
git commit -m "feat(chat): add persistent web search toggle"
```

### Task 7: 将真实 Qoder 工具事件映射为前端进度

**Files:**
- Modify: `src/modules/chat/sse-events.ts`
- Modify: `src/modules/chat/service.ts`
- Modify: `src/app/(app)/chat/[sessionId]/page.tsx`
- Test: `tests/unit/modules/chat/sse-contract.test.ts`
- Test: `tests/unit/modules/chat/service.test.ts`

**Interfaces:**
- Produces: SSE stages `understanding | local_search | local_read | web_search | web_fetch | synthesizing | complete`.
- Produces: optional status fields `current?: number`, `limit?: number`, `sourceName?: string`.

- [ ] **Step 1: 写状态映射失败测试**

```ts
it.each([
  ['Grep', 'local_search', '正在检索本地知识库…'],
  ['Read', 'local_read', '正在阅读相关知识笔记…'],
  ['WebSearch', 'web_search', '本地资料不足，正在搜索已授权网站（1/1）…'],
  ['WebFetch', 'web_fetch', '正在读取网页资料（1/2）…'],
])('maps %s to a user-visible status', async (tool, stage, message) => {
  const events = await runWithToolUse(tool);
  expect(events).toContainEqual(expect.objectContaining({ stage, message }));
});
```

- [ ] **Step 2: 运行 SSE/服务测试确认失败**

Run: `npm run test:unit -- tests/unit/modules/chat/sse-contract.test.ts tests/unit/modules/chat/service.test.ts`

Expected: FAIL，仍使用 cache/web_fallback 等旧 stage。

- [ ] **Step 3: 更新 SSE 类型与服务映射**

开始 Query 发送 `understanding`。主 Agent tool_use 出现时先发送对应 status，再发送脱敏 tool event；Web input preview 只保留授权来源名，不发送完整 query/URL。第一个 text delta 前若已使用工具则发送一次 `synthesizing`。

预算耗尽或 100 秒仍未结束时发送：

```text
联网资料响应较慢，正在使用已获得的内容完成回答…
```

该提示不主动 abort；120 秒硬超时仍由 AbortController 执行。

- [ ] **Step 4: 更新 SessionPage SSE 联合类型和显示**

移除 cache_check/web_fallback 文案，直接显示服务端 status.message。收到 done/error 或开始文本输出后按协议清除/更新状态，不自行推测 Agent 思维。

- [ ] **Step 5: 运行 SSE/服务测试**

Run: `npm run test:unit -- tests/unit/modules/chat/sse-contract.test.ts tests/unit/modules/chat/service.test.ts`

Expected: PASS。

- [ ] **Step 6: 提交**

```bash
git add src/modules/chat/sse-events.ts src/modules/chat/service.ts 'src/app/(app)/chat/[sessionId]/page.tsx' tests/unit/modules/chat/sse-contract.test.ts tests/unit/modules/chat/service.test.ts
git commit -m "feat(chat): stream qoder tool progress"
```

### Task 8: 删除双后端配置并对齐文档与评测

**Files:**
- Modify: `src/config/env.ts`
- Modify: `src/config/constants.ts`
- Modify: `.env.example`
- Modify: `README.md`
- Modify: `SPEC.md`
- Modify: `scripts/eval-chat.ts`
- Modify: `tests/unit/config/env.test.ts`
- Modify: `tests/unit/config/constants.test.ts`
- Create: `tests/unit/scripts/eval-chat.test.ts`

**Interfaces:**
- Consumes: Tasks 4–7 final qoder-only behavior.
- Produces: no runtime/config reference to `CHAT_ANSWER_BACKEND`, chat `LLM_API_BASE_URL`, chat `LLM_API_KEY`, or `LLM_MODEL`.

- [ ] **Step 1: 写配置失败测试**

```ts
it('does not expose a chat answer backend switch', () => {
  const parsed = parseEnv(validEnv);
  expect('CHAT_ANSWER_BACKEND' in parsed).toBe(false);
});

it('keeps the qoder chat model default explicit', () => {
  expect(parseEnv(validEnv).QODER_MODEL).toBe('Qwen3.7-Plus');
});
```

- [ ] **Step 2: 运行配置测试确认失败**

Run: `npm run test:unit -- tests/unit/config/env.test.ts tests/unit/config/constants.test.ts`

Expected: FAIL，旧双后端常量和 env 仍存在。

- [ ] **Step 3: 删除聊天双后端配置并保留清洗 Provider**

删除 `CHAT_ANSWER_BACKENDS` / `ChatAnswerBackend` 和聊天用途的 `LLM_API_BASE_URL`、`LLM_API_KEY`、`LLM_MODEL`。不得删除 `LLM_API_PROVIDERS`、`LONGCAT_*` 或知识清洗使用的 Provider 配置。把 `QODER_MODEL` schema 改为默认 `Qwen3.7-Plus`。

- [ ] **Step 4: 更新 README、SPEC 和评测断言**

文档只描述 Qoder Agent；评测从“是否调用 wiki-search/web-research 子 Agent”改为检查直接 Read/Glob/Grep/WebSearch/WebFetch 工具事件。联网案例先通过会话 API 开启开关，默认案例保持关闭。

- [ ] **Step 5: 运行配置与脚本测试**

Run: `npm run test:unit -- tests/unit/config tests/unit/scripts`

Expected: PASS。

- [ ] **Step 6: 确认没有聊天双后端残留**

Run: `rg -n "CHAT_ANSWER_BACKEND|streamLlmDirect|isLlmDirectConfigured|wiki-search|web-research" src tests scripts README.md SPEC.md .env.example`

Expected: 只允许历史迁移/设计文档中的说明；运行代码、当前测试和部署示例无匹配。

- [ ] **Step 7: 提交**

```bash
git add src/config/env.ts src/config/constants.ts .env.example README.md SPEC.md scripts/eval-chat.ts tests/unit/config tests/unit/scripts
git commit -m "docs(agent): make qoder the only chat backend"
```

### Task 9: 全量验证与浏览器验收

**Files:**
- Modify: `tests/e2e/chat.test.ts`
- Modify: `tests/e2e-browser/knowledge.smoke.spec.ts`
- Modify: `tests/e2e-browser/fixtures.ts` if fixture API needs Web sources

**Interfaces:**
- Consumes: all previous tasks.
- Produces: regression coverage for qoder-only chat, persistent Web toggle and source administration.

- [ ] **Step 1: 增加 E2E 契约场景**

API E2E 验证：创建会话默认 `webSearchEnabled=false`；PATCH 后 GET 仍为 true；其他用户不能修改。浏览器 smoke 验证知识管理员能打开“联网知识源”Tab、新增 exact URL、停用并看到状态变化。

- [ ] **Step 2: 运行类型检查和单元测试**

Run: `npm run typecheck && npm run test:unit`

Expected: exit 0，所有 unit tests PASS。

- [ ] **Step 3: 运行集成测试**

Run: `npm run test:integration`

Expected: exit 0，所有 integration tests PASS。

- [ ] **Step 4: 运行生产构建**

Run: `npm run build`

Expected: exit 0，Next.js production build 成功。

- [ ] **Step 5: 运行可用的 E2E**

Run: `npm run test:e2e`

Expected: exit 0；若真实 Qoder 凭证不可用，只允许明确跳过需要外网/凭证的生成断言，数据库权限、会话开关和后台 CRUD 不得跳过。

- [ ] **Step 6: 检查最终差异和迁移顺序**

Run: `git diff --check && git status --short && npm run db:migrate`

Expected: 无 whitespace error；迁移成功；工作树只包含本计划相关改动。

- [ ] **Step 7: 提交验收测试**

```bash
git add tests/e2e/chat.test.ts tests/e2e-browser/knowledge.smoke.spec.ts tests/e2e-browser/fixtures.ts
git commit -m "test(agent): cover qoder-only chat workflow"
```

## 实施检查点

- Task 1–3 完成后：知识管理员可以维护 Web 来源，数据库与 notes 快照一致。
- Task 4–5 完成后：所有聊天问题只进入 Qoder SDK，resume 轮次只发送当前消息。
- Task 6–7 完成后：用户可按会话开启联网并看到真实工具进度。
- Task 8–9 完成后：双后端配置清理完毕，全量验证通过。
