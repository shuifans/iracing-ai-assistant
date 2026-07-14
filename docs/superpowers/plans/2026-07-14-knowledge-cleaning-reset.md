# 知识清洗与知识库重建实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**目标：** 将知识清洗固定为 OpenAI 兼容 LLM 单一路径，建立一来源一笔记的 iRacing 专业知识形态，提供 Qoder 友好的只读文件检索结构，并安全清空现有知识域数据。

**架构：** 来源层保存不可变原文件和规范化文本快照；清洗层仅调用 `cleanWithLlmDirect` 并生成一篇待审核 Markdown；发布层生成精简 `index.md` 和固定 `KNOWLEDGE.md`。Qoder SDK 继续服务聊天与检索，但不参与清洗。

**技术栈：** TypeScript 5.9、Next.js 15、Vitest 4、Zod 4、Drizzle ORM、better-sqlite3、`yaml`、Markdown、Qoder SDK（仅聊天/检索保留）。

## 全局约束

- 一个来源严格对应一篇候选笔记和一篇已发布笔记。
- 不构建知识图谱、实体页、概念页、反向链接或一来源多笔记。
- 知识清洗不得导入、调用或回退到 Qoder SDK。
- 聊天与 Agent 的 Qoder SDK 能力不得删除或改变。
- 原始来源和规范化文本快照不可变；URL 同一来源只抓取一次。
- LLM 输入超过配置上限时明确失败，不允许静默截断。
- 清洗输出硬上限为 12,000 字符；普通笔记目标为 2,000～8,000 字符。
- 所有模型输出必须经过结构校验和人工审核后才能发布。
- 当前工作区存在用户未提交修改；实现时只做定向补丁，不覆盖无关差异，不把用户既有改动混入自动提交。

---

### 任务 1：移除知识清洗侧 Qoder 分支与切换功能

**文件：**

- 修改：`tests/unit/worker/processors/knowledge.test.ts`
- 修改：`worker/processors/knowledge.ts`
- 修改：`tests/unit/modules/agent/client.test.ts`
- 修改：`src/modules/agent/client.ts`
- 修改：`tests/unit/modules/agent/prompts.test.ts`
- 修改：`src/modules/agent/prompts.ts`
- 修改：`src/modules/system-settings/repository.ts`
- 修改：`tests/unit/modules/system-settings/repository.test.ts`
- 删除：`src/app/api/knowledge/cleaning-backend/route.ts`
- 删除：`tests/unit/api/knowledge/cleaning-backend.route.test.ts`
- 删除：`src/components/knowledge/CleaningBackendSwitch.tsx`
- 修改：`src/app/(app)/knowledge/page.tsx`
- 修改：`src/config/env.ts`
- 修改：`tests/unit/config/env.test.ts`
- 修改：`.env.example`

**接口：**

- 保留：`cleanWithLlmDirect(params: CleanWithLlmDirectParams): Promise<string>`
- 删除：`createCleaningQuery(...)`
- 删除：`getCleaningBackend()`、`CLEANING_BACKEND_KEY`、`CLEANING_BACKENDS`
- Worker 清洗调用固定传入 `rawText`、可信来源元数据、反馈、12,000 字符和 6,000 tokens。

- [ ] **步骤 1：把 Worker 测试改成只允许 LLM 直连**

  删除 SDKMessage、`createCleaningQuery`、`getCleaningBackend` 的 mock/import 和所有 SDK generator 测试；将主成功路径断言改为：

  ```ts
  expect(mockCleanWithLlmDirect).toHaveBeenCalledWith(
    expect.objectContaining({
      rawText: 'extracted text content',
      feedback: undefined,
      maxOutputChars: 12_000,
      maxTokens: 6_000,
    }),
  );
  ```

  增加失败测试，证明 `cleanWithLlmDirect` 抛错时任务进入 `AGENT_UNAVAILABLE`，且不存在 Qoder fallback 断言对象。

- [ ] **步骤 2：运行 Worker 测试，确认 RED**

  运行：

  ```bash
  npm run test:unit -- tests/unit/worker/processors/knowledge.test.ts
  ```

  预期：测试因 Worker 仍读取 `getCleaningBackend`、仍使用 4,500/2,500 限额而失败。

- [ ] **步骤 3：最小化 Worker 为单一路径**

  删除 Qoder SDK 类型、AgentConfig、`createCleaningQuery`、`getCleaningBackend` import，删除 `consumeCleaningQuery`、idle/hard race 辅助函数和后端分支，改为：

  ```ts
  cleanedMarkdown = await cleanWithLlmDirect({
    rawText: extractedText,
    sourceUrl: source.sourceUrl ?? undefined,
    feedback: job.instructionsJson ?? undefined,
    signal,
    maxOutputChars: 12_000,
    maxTokens: 6_000,
    timeoutMs: env.LLM_CLEAN_TIMEOUT_MS,
  });
  ```

  将 Worker 输出长度常量同步改为 `12_000`。

- [ ] **步骤 4：运行 Worker 测试，确认 GREEN**

  运行同上。预期：该测试文件全部通过。

- [ ] **步骤 5：先修改 Agent、设置和 UI 测试以表达删除行为**

  - Prompt 测试不再导入或断言 `KNOWLEDGE_CLEANER_PROMPT`。
  - Agent Client 测试不再测试 `createCleaningQuery`。
  - System Settings 测试不再测试清洗后端常量和读取函数。
  - 删除 cleaning-backend route 测试。
  - 增加知识页源码级组件测试或依赖测试，断言不再引用 `CleaningBackendSwitch` 和 `/api/knowledge/cleaning-backend`。

- [ ] **步骤 6：运行相关测试，确认 RED**

  ```bash
  npm run test:unit -- tests/unit/modules/agent/prompts.test.ts tests/unit/modules/agent/client.test.ts tests/unit/modules/system-settings/repository.test.ts
  ```

  预期：残留生产导出或引用使删除行为测试失败。

- [ ] **步骤 7：删除清洗专用 Qoder 代码和切换 UI/API**

  - 从 Agent Client 删除 `createCleaningQuery`。
  - 从 prompts 删除 `KNOWLEDGE_CLEANER_PROMPT`。
  - 从 system settings 删除清洗后端常量和 getter，保留通用 `getSetting/upsertSetting`。
  - 删除切换 API、组件和知识页 import/render。
  - 从 env schema 和 `.env.example` 删除仅服务模型切换的 `MODEL_SWITCH_PASSWORD_HASH`。`QODER_CLEAN_TIMEOUT_MS` 当前仍被聊天 Agent 配置读取，因此保留该兼容字段，但从 Worker 删除引用并把文档说明改成 Agent 会话用途；本任务不重命名它，避免破坏现有部署环境。

- [ ] **步骤 8：运行任务 1 相关测试和静态搜索**

  ```bash
  npm run test:unit -- tests/unit/worker/processors/knowledge.test.ts tests/unit/modules/agent/prompts.test.ts tests/unit/modules/agent/client.test.ts tests/unit/modules/system-settings/repository.test.ts tests/unit/config/env.test.ts
  rg -n "createCleaningQuery|KNOWLEDGE_CLEANER_PROMPT|knowledge\.cleaning_backend|CleaningBackendSwitch|/api/knowledge/cleaning-backend" src worker tests .env.example
  ```

  预期：测试通过；搜索仅允许在历史设计/迁移或显式清理脚本中出现废弃 setting key，不得出现在运行时清洗链路。

---

### 任务 2：实现严格 taxonomy、完整 Front Matter 与专业提示词

**文件：**

- 修改：`package.json`
- 修改：`package-lock.json`
- 修改：`src/config/constants.ts`
- 修改：`src/modules/knowledge/schemas.ts`
- 修改：`src/modules/knowledge/types.ts`
- 修改：`src/modules/knowledge/front-matter.ts`
- 修改：`src/modules/knowledge/llm-cleaner.ts`
- 修改：`src/modules/knowledge/publisher.ts`
- 修改：`src/db/schema/knowledge.ts`
- 新建：`src/db/migrations/20260714000002_F_knowledge_taxonomy.sql`
- 修改：`tests/unit/modules/knowledge/schemas.test.ts`
- 修改：`tests/unit/modules/knowledge/front-matter.test.ts`
- 修改：`tests/unit/modules/knowledge/llm-cleaner.test.ts`
- 修改：`tests/unit/modules/knowledge/publisher.test.ts`

**接口：**

- `KNOWLEDGE_CATEGORIES` 替换为设计文档中的六类严格映射。
- `FrontMatterData` 新增：`id`、`description`、`aliases`、`source_id`、`source_sha256`、`content_type`、`effective_date`、`expires_at`。
- `makeCleanerUserPrompt` 接收可信元数据：

  ```ts
  interface CleanerSourceMetadata {
    noteId: string;
    sourceId: string;
    sourceSha256: string;
    sourceName?: string;
    sourceUrl?: string;
  }
  ```

- [ ] **步骤 1：安装标准 YAML 解析器**

  ```bash
  npm install yaml
  ```

  预期：`yaml` 写入 dependencies 和 lockfile。

- [ ] **步骤 2：先写 taxonomy 与 Front Matter RED 测试**

  测试至少覆盖：

  ```ts
  expect(frontMatterSchema.parse({
    id: 'source-1',
    title: '2026 Season 3 Schedule',
    description: 'Official schedule for 2026 Season 3.',
    category: 'official-racing',
    subcategory: 'schedule-and-season',
    tags: ['2026S3', 'schedule'],
    aliases: ['2026 S3 schedule'],
    source_id: 'source-1',
    source_sha256: 'a'.repeat(64),
    content_type: 'schedule',
  })).toBeTruthy();

  expect(() => frontMatterSchema.parse({
    // 其余合法字段
    category: 'official-racing',
    subcategory: 'braking',
  })).toThrow();
  ```

  Front Matter round-trip 测试必须包含带冒号的 description、aliases 数组和可选日期，证明标准 YAML 解析不会破坏值。

- [ ] **步骤 3：运行 schema/front-matter 测试，确认 RED**

  ```bash
  npm run test:unit -- tests/unit/modules/knowledge/schemas.test.ts tests/unit/modules/knowledge/front-matter.test.ts
  ```

  预期：旧 taxonomy、缺少字段和手写 YAML parser 导致失败。

- [ ] **步骤 4：实现 taxonomy、Zod superRefine 和 YAML parser**

  - 更新六类常量。
  - 通过 `superRefine` 校验 category/subcategory 配对。
  - 为 hash 使用 `/^[a-f0-9]{64}$/i`。
  - aliases 为最多 10 个、每个最多 100 字符；description 为 1～300 字符。
  - 日期使用 ISO `YYYY-MM-DD` 字符串校验。
  - 使用 `yaml.parse` 解析 Front Matter，拒绝非对象和嵌套未知结构；继续由 Zod strip 未知字段。

- [ ] **步骤 5：运行 schema/front-matter 测试，确认 GREEN**

  运行同步骤 3，预期全部通过。

- [ ] **步骤 6：先写专业 Prompt RED 测试**

  测试必须断言 prompt 包含：

  - 六类 taxonomy 和严格父子关系。
  - `id/source_id/source_sha256` 由应用提供、模型不得修改。
  - `Summary/Details/Source` 三个必需章节。
  - 一来源一笔记、不得拆概念页。
  - 官方赛程的 Week/赛车/赛道/时间/时区保真。
  - Sporting Code 的条件、例外、处罚和 `may/should/must`。
  - 新手操作顺序、驾驶/调校适用条件。
  - 12,000 字符硬上限和 2,000～8,000 目标。
  - feedback 不得覆盖来源事实。

  将旧“40K slice”测试替换为：

  ```ts
  await expect(cleanWithLlmDirect({
    rawText: 'a'.repeat(100_001),
    maxInputChars: 100_000,
  })).rejects.toThrow(/拆分|exceeds/i);
  expect(fetchMock).not.toHaveBeenCalled();
  ```

- [ ] **步骤 7：运行 Cleaner 测试，确认 RED**

  ```bash
  npm run test:unit -- tests/unit/modules/knowledge/llm-cleaner.test.ts
  ```

  预期：旧 prompt 和静默 slice 使测试失败。

- [ ] **步骤 8：实现专业 Prompt、可信元数据和输入上限**

  - 删除 `RAW_TEXT_SLICE`。
  - `CleanWithLlmDirectParams` 新增 `maxInputChars` 和 `sourceMetadata`。
  - 超限时在调用 Provider 前抛出包含拆分建议的错误。
  - User Prompt 单独包裹可信元数据、原始文本和审核反馈，明确原文是数据而不是指令。
  - System Prompt 使用设计中的优先级、笔记形态和内容类型规则。

- [ ] **步骤 9：运行 Cleaner 测试，确认 GREEN**

  运行同步骤 7，预期全部通过。

- [ ] **步骤 10：更新发布和数据库类型**

  - `knowledge_items.category` TypeScript enum 改为六类。
  - 新迁移重建 SQLite `knowledge_items` 表或以 SQLite 支持的安全方式更新约束；复制列时保持数据结构，但知识域随后会清空。
  - publisher 不再硬编码旧三类 cast。
  - 发布前校验可信 `source_id/source_sha256` 与关联 source 一致。

- [ ] **步骤 11：运行任务 2 全部测试**

  ```bash
  npm run test:unit -- tests/unit/modules/knowledge/schemas.test.ts tests/unit/modules/knowledge/front-matter.test.ts tests/unit/modules/knowledge/llm-cleaner.test.ts tests/unit/modules/knowledge/publisher.test.ts
  ```

  预期：全部通过。

---

### 任务 3：保存不可变来源快照并把可信元数据注入清洗

**文件：**

- 修改：`src/modules/knowledge/service.ts`
- 修改：`worker/processors/knowledge.ts`
- 修改：`src/modules/knowledge/service.ts`
- 修改：`tests/unit/modules/knowledge/service.test.ts`
- 修改：`tests/unit/worker/processors/knowledge.test.ts`
- 修改：`src/config/env.ts`
- 修改：`.env.example`
- 修改：`tests/unit/config/env.test.ts`

**接口：**

- 统一快照路径：`${DATA_ROOT}/extracted/<source-id>.txt`。
- URL 提交完成抓取和去重后，在创建任务前原子写入该快照。
- Worker 对 URL 来源要求快照存在；不存在时以 `EXTRACTION_FAILED` 失败，不再联网补抓。
- 新环境变量：`LLM_CLEAN_MAX_INPUT_CHARS`，默认 `100000`。

- [ ] **步骤 1：先写 URL 快照 RED 测试**

  `submitUrlSource` 测试断言：

  ```ts
  expect(writeFileSync).toHaveBeenCalledWith(
    expect.stringMatching(/extracted\/source-.+\.txt$/),
    extraction.text,
    'utf-8',
  );
  ```

  Worker 测试断言 URL 快照存在时读取快照且 `fetchUrl` 不被调用；快照缺失时任务失败且 `fetchUrl` 仍不被调用。

- [ ] **步骤 2：运行服务和 Worker 测试，确认 RED**

  ```bash
  npm run test:unit -- tests/unit/modules/knowledge/service.test.ts tests/unit/worker/processors/knowledge.test.ts
  ```

- [ ] **步骤 3：实现快照辅助函数和 URL 单次抓取语义**

  - 提取 `getExtractedSnapshotPath(sourceId)`，统一 service、worker 和 review 读取路径。
  - URL 提交在 sourceId 生成后创建 `extracted` 目录并原子写入文本快照。
  - Worker 对 URL 只读快照；文件来源首次解析后写快照，重洗复用。
  - 调用 Cleaner 时传入 `noteId: source.id`、source ID/hash/name/url 和 `maxInputChars`。

- [ ] **步骤 4：新增环境变量测试并实现配置**

  测试默认值 `100000` 和显式覆盖值；在 env schema 和 `.env.example` 中加入 `LLM_CLEAN_MAX_INPUT_CHARS`。

- [ ] **步骤 5：运行任务 3 测试，确认 GREEN**

  ```bash
  npm run test:unit -- tests/unit/modules/knowledge/service.test.ts tests/unit/worker/processors/knowledge.test.ts tests/unit/config/env.test.ts
  ```

---

### 任务 4：实现 Agent 路由索引、KNOWLEDGE.md 与可检索性评估

**文件：**

- 新建：`src/modules/knowledge/agent-contract.ts`
- 新建：`tests/unit/modules/knowledge/agent-contract.test.ts`
- 修改：`src/modules/knowledge/wiki-index.ts`
- 修改：`tests/unit/modules/knowledge/wiki-index.test.ts`
- 修改：`src/modules/knowledge-evaluation/evaluators/retrieval-probe.ts`
- 修改：`tests/unit/modules/knowledge-evaluation/evaluators/retrieval-probe.test.ts`
- 修改：`src/modules/knowledge-evaluation/evaluators/heuristic.ts`
- 修改：`tests/unit/modules/knowledge-evaluation/evaluators/heuristic.test.ts`
- 修改：`src/modules/knowledge/publisher.ts`

**接口：**

- `KNOWLEDGE_AGENT_CONTRACT: string`
- `writeKnowledgeAgentContract(wikiRoot: string): void`
- `IndexEntry` 新增 `description`、`aliases`、`effectiveDate`、`expiresAt`。

- [ ] **步骤 1：先写 index 与 contract RED 测试**

  Index 示例断言：

  ```md
  - [2026 Season 3 Schedule](official-racing/schedule-and-season/2026-season-3-schedule.md) — Official 2026S3 schedule. | aliases: 2026 S3 schedule | season: 2026S3
  ```

  同时断言 index 不包含正文段落，跳过 `index.md` 和 `KNOWLEDGE.md`。

  Contract 测试断言包含：先读 index、Grep/Glob 缩小范围、只读、读取 Details、引用笔记与原始来源、处理过期/冲突、证据不足时说明。

- [ ] **步骤 2：运行 index/contract 测试，确认 RED**

  ```bash
  npm run test:unit -- tests/unit/modules/knowledge/wiki-index.test.ts tests/unit/modules/knowledge/agent-contract.test.ts
  ```

- [ ] **步骤 3：实现精简 index 和固定 contract**

  - Index 仍按 category/subcategory/title 确定性排序。
  - 每条只输出链接、description、有限 aliases/tags 和时效字段。
  - `collectIndexEntries` 排除两个系统 Markdown 文件。
  - 发布、归档、恢复和重置后写入 contract。

- [ ] **步骤 4：运行 index/contract 测试，确认 GREEN**

  运行同步骤 2。

- [ ] **步骤 5：先写可检索性与 lint RED 测试**

  - 关键词在 description 或 aliases 命中时计为可检索。
  - 旧分类或跨类 subcategory 得分为 0。
  - 超过 12,000 字符按新阈值评分。
  - `expires_at` 早于当前日期时 freshness 明确降分。

- [ ] **步骤 6：实现并运行评估测试**

  ```bash
  npm run test:unit -- tests/unit/modules/knowledge-evaluation/evaluators/retrieval-probe.test.ts tests/unit/modules/knowledge-evaluation/evaluators/heuristic.test.ts
  ```

  预期：全部通过。

---

### 任务 5：实现安全、幂等的知识域重置并执行

**文件：**

- 新建：`src/modules/knowledge/reset.ts`
- 新建：`tests/unit/modules/knowledge/reset.test.ts`
- 新建：`scripts/reset-knowledge.ts`
- 修改：`package.json`

**接口：**

```ts
export interface ResetKnowledgeOptions {
  dataRoot: string;
  confirm: boolean;
}

export function resetKnowledgeDomain(options: ResetKnowledgeOptions): void;
```

package script：

```json
"knowledge:reset": "tsx scripts/reset-knowledge.ts"
```

- [ ] **步骤 1：先写 reset RED 测试**

  覆盖：

  - `confirm=false` 拒绝执行。
  - SQL 删除顺序为 dimensions→feedback→evaluations→items→drafts→jobs→sources→obsolete setting。
  - 任一 SQL 抛错时不调用文件删除。
  - `dataRoot` 外路径被拒绝。
  - 空数据库和不存在目录可重复执行。
  - 重建空 `index.md` 和 `KNOWLEDGE.md`。
  - 用户、会话、审计和其他 system settings 不在删除 SQL 中。

- [ ] **步骤 2：运行 reset 测试，确认 RED**

  ```bash
  npm run test:unit -- tests/unit/modules/knowledge/reset.test.ts
  ```

- [ ] **步骤 3：实现事务优先、路径受限的 reset**

  - 使用 `getRawDb().transaction(...)` 执行固定 SQL。
  - 解除 `knowledge_jobs.parent_draft_id` 与 `evaluation_feedback.applied_to_job_id` 的循环引用影响，确保删除顺序实际可执行；必要时先置空这两个字段，再删除叶表。
  - 使用 `path.resolve` + 相对路径检查确保每个目标在 `DATA_ROOT` 内。
  - 文件删除只发生在事务提交后。
  - 删除固定目录后重建 `md-wiki/index.md` 和 `KNOWLEDGE.md`。

- [ ] **步骤 4：运行 reset 测试，确认 GREEN**

  运行同步骤 2。

- [ ] **步骤 5：先做 dry-run 信息核对，再执行真实重置**

  先输出数据库路径、DATA_ROOT 和各知识表计数，不输出凭据。确认目标为当前项目数据后运行：

  ```bash
  npm run knowledge:reset -- --confirm-reset-knowledge
  ```

  预期：知识表计数归零；旧上传、抽取缓存、草稿和 Wiki 正文删除；只剩空 index、KNOWLEDGE.md 和无关数据。

---

### 任务 6：全量验证与范围审查

**文件：**

- 检查：本计划涉及的全部文件
- 不修改：聊天 Qoder 主路径，除非类型检查证明必须做最小兼容调整

- [ ] **步骤 1：运行针对性单元测试**

  ```bash
  npm run test:unit -- tests/unit/worker/processors/knowledge.test.ts tests/unit/modules/knowledge/llm-cleaner.test.ts tests/unit/modules/knowledge/front-matter.test.ts tests/unit/modules/knowledge/schemas.test.ts tests/unit/modules/knowledge/service.test.ts tests/unit/modules/knowledge/wiki-index.test.ts tests/unit/modules/knowledge/agent-contract.test.ts tests/unit/modules/knowledge/reset.test.ts tests/unit/modules/knowledge-evaluation/evaluators/heuristic.test.ts tests/unit/modules/knowledge-evaluation/evaluators/retrieval-probe.test.ts
  ```

  预期：0 failures。

- [ ] **步骤 2：运行全量单元与集成测试**

  ```bash
  npm run test:unit
  npm run test:integration
  ```

  预期：0 failures。若存在与本任务无关的既有失败，记录完整用例与错误，不把它描述为通过。

- [ ] **步骤 3：运行类型、lint 和格式检查**

  ```bash
  npm run typecheck
  npm run lint
  npm run format:check
  ```

  预期：全部退出码为 0。

- [ ] **步骤 4：运行静态范围审查**

  ```bash
  rg -n "createCleaningQuery|KNOWLEDGE_CLEANER_PROMPT|knowledge\.cleaning_backend|CleaningBackendSwitch|/api/knowledge/cleaning-backend" src worker tests .env.example
  rg -n "@qoder-ai/qoder-agent-sdk" src worker
  git diff --check
  git status --short
  ```

  预期：第一条只允许重置脚本中的废弃 setting key；第二条仍能在聊天/Agent 文件中找到 Qoder SDK，但不能在知识清洗 Worker 或 Cleaner 中找到；diff 无空白错误。

- [ ] **步骤 5：逐条对照成功标准**

  检查：单一 Cleaner、六类 taxonomy、一来源一笔记、不可变快照、无静默截断、路由字段、精简 index、KNOWLEDGE.md、人工审核、数据清空、聊天 Qoder 保留。

- [ ] **步骤 6：提交或交付**

  当前工作区已有用户修改且与任务文件重叠，因此不自动提交包含既有改动的共享文件。交付时列出本次实际修改、测试证据、仍存在的既有失败和知识重置结果；仅在能够精确隔离本次变更时才创建实现提交。
