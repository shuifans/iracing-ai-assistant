# 验证与复现实验日志

## 1. 环境

- Node.js：22.23.1（由命令错误栈确认）
- npm install：`npm ci` 成功，新增 643 packages。
- 审计基线：`b6bdc5869d5365c920a7c636a297a0c9572c1126`。

## 2. 基线命令

| 命令 | 退出码 | 结果 |
|---|---:|---|
| `npm ci` | 0 | 安装成功；audit 摘要 2 high / 5 moderate |
| `npm run typecheck` | 0 | 无 TypeScript 错误 |
| `npm run lint` | 1 | 1 个 `react-hooks/set-state-in-effect` 错误 |
| `npm run test:unit` | 0 | 68 files，857 tests 全通过 |
| `npm run test:integration` | 0 | 7 files，59 tests 全通过 |
| `npm run test:contract` | 0 | 没有 contract 测试，`passWithNoTests` 使其成功 |
| `npx vitest run --project e2e` | 0 | 4 files，16 tests 全通过 |
| `npm run build` | 0 | Next 14.2.35 production build 成功，15 个静态页生成 |
| `npm audit --json` | 1 | 7 vulnerabilities：2 high、5 moderate |
| `npm run test:e2e`（首次） | 1 | Playwright Chromium 未安装，属于环境依赖 |
| `npm run test:e2e:install` | 0 | Chromium 安装成功 |
| `npm run test:e2e`（复跑） | 1 | 8 tests：7 通过、1 失败；失败定位为测试脚本未点击 tab |
| `npx tsx scripts/validate-wiki.ts` | 0 | 18 个 Wiki 文件全部通过 Front Matter/正文验证 |

### Lint 失败

`src/app/(admin)/admin/sessions/page.tsx:115` 在 effect 主体同步调用 `setDetailLoading(true)`，触发 `react-hooks/set-state-in-effect`。生产 build 使用 Next 14 内置检查仍成功，说明 `npm run build` 与独立 ESLint 16 规则集不一致。

### 依赖风险

- Next.js 14.2.35：多个 DoS、request smuggling、cache poisoning、WebSocket SSRF 等 advisory；npm 建议的自动修复是升级 Next 16，属于 major。
- `xlsx` 0.18.5：prototype pollution 与 ReDoS，高危且 npm registry 路径无可用自动修复；项目会解析管理员上传的 Excel，代码路径可达。
- drizzle-kit 的旧 esbuild 链：中危，主要影响开发服务器而非生产 runtime。

## 3. EXP-01：人工审核任务被租约恢复

目标：验证进入 `pending_review` 后，遗留 lease 是否会使任务重新排队。

方法：临时 SQLite 运行全部 migration；创建 source/job；claim 后执行 extracting→cleaning→pending_review；把 lease expiry 设为过去，再调用 `recoverExpiredLeases()`。

结果：

```text
before pending_review w1
recovered 1
after queued null
```

结论：稳定复现。根因是 `worker/processors/knowledge.ts:184-188` 仅改 status，不清 lease；`jobs/repository.ts:426-455` 又把 pending_review 纳入过期恢复。

## 4. EXP-02：附件上传外键失败

目标：验证上传 API 以空 messageId 创建附件的实际 DB 行为。

方法：临时 SQLite migration 后直接调用与 route 相同的 `createAttachment('', ...)`。

结果：

```text
error SqliteError FOREIGN KEY constraint failed
```

结论：稳定复现。`message_attachments.message_id` 为 NOT NULL 外键，上传 route 的“两阶段绑定”没有 schema 支持，且发送流程没有后续绑定实现。

## 5. EXP-03：maxAttempts 未生效

目标：验证 `maxAttempts=3` 是否限制重试。

方法：临时 DB 创建 job，连续执行 fail → retry 五次。

结果：

```text
retry 1 true attempt 1 max 3
retry 2 true attempt 2 max 3
retry 3 true attempt 3 max 3
retry 4 true attempt 4 max 3
retry 5 true attempt 5 max 3
```

结论：稳定复现。repository/service 都未检查 `newAttempt > maxAttempts`。

## 6. EXP-00：失败的实验脚本

第一次 EXP-01 在准备数据时因 shell/SQL 引号错误失败：SQLite 报 `no such column: "u1"`，没有进入目标代码路径。随后改用 Drizzle 对象插入，EXP-01 成功复现。该失败不计为产品缺陷。

## 7. EXP-04：发布同步状态与用户删除约束

目标：用真实 migration 的 CHECK/FK 验证两条静态调用链。

方法：内存 SQLite 执行全部 migration，插入 user/source/job/draft/item，然后分别执行发布器等价的 `wiki_sync_status='pushed'` 更新和用户服务等价的 `submitted_by=''` 更新。

结果：

```text
sync_update=CHECK constraint failed: wiki_sync_status IN ('committed', 'push_pending', 'synced', 'push_failed')
user_nullify=FOREIGN KEY constraint failed
stored_sync=committed
stored_submitter=u1
```

结论：两项均稳定复现。发布器成功 spawn push 后必然在状态更新处抛错；有知识来源的用户删除必然在“nullify”步骤失败。

准备实验时前两次插入分别因审计脚本使用了不存在的 `display_name` 列、非法 source status `pending` 而提前失败；修正为 migration 的真实 schema 后得到上述目标结果，不计为产品失败。

## 8. Browser E2E 根因

安装浏览器后复跑，结果为 7/8 通过。唯一失败：

```text
tests/e2e-browser/knowledge.smoke.spec.ts:16
Expected: 下一页 button enabled
Received: element not found
```

代码证据：

- 页面 `activeTab` 默认是 `overview`（`knowledge/page.tsx:102`）。
- Pagination 仅在 `activeTab === 'sources'` 时渲染（`:923-957`）。
- 用例只断言“来源管理”tab 可见，没有执行 click（spec `:19-23`）。
- 同一 spec 的 sources API 测试通过，确认 `meta.nextCursor` 存在。

结论：测试用例漂移，不是 sources API 分页缺陷。修复用例应先点击 tab，再等待 sources 请求和分页按钮。

E2E 服务同时输出两项配置警告：`output:'standalone'` 构建使用了 `next start`；instrumentation 在 standalone 构建中找不到 `.next/server/chunks/migrations`。测试仍能运行，但生产启动形态应单独覆盖。

## 9. Wiki 验证

`npx tsx scripts/validate-wiki.ts` 扫描 `data/md-wiki`，18/18 篇通过，0 失败。没有运行 `build:search-index`，因为该命令会重写生成资产，不符合本轮“只写 review 文档”的约束。

## 10. 验证覆盖与限制

- 未调用真实付费 LLM/Qoder，避免消耗外部配额；Agent 缺陷基于 SDK 配置、提示词和事件协议的确定性静态分析。
- 未执行命令注入 payload，避免在本机产生副作用；污点链止于 `execSync(string)`，已足以判定。
- 未对受控 DNS 服务器做 rebinding 利用；该项标为高可信风险而非动态验证缺陷。
- 未运行会重写 `data/search-index.json` 的索引构建。
- 最终文档完整性和 Git diff 核验见下一节。

## 11. 交付前最终核验

按 `verification-before-completion` 要求重新执行关键验证，最新结果：

| 检查 | 结果 |
|---|---|
| `npm run typecheck` | exit 0 |
| `npm run lint` | exit 1；仍为 sessions page 第 115 行的 1 个错误 |
| `npm run test:unit` | exit 0；68 files / 857 tests |
| `npm run test:integration` | exit 0；7 files / 59 tests |
| `npx vitest run --project e2e` | exit 0；4 files / 16 tests |
| `npm run build` | exit 0；15 个静态页生成 |
| `npx tsx scripts/validate-wiki.ts` | exit 0；18/18 通过 |

文档核验：review 目录共有 README + 00–08 共 10 个 Markdown 文件；`06-findings.md` 有 29 个唯一 finding 标题；未发现未完成任务、占位标记、行尾空白或断开的相对 Markdown 链接。

`git status --short` 仅显示 `?? docs/reviews/`；产品源码、测试、配置和数据资产均无 tracked diff。本轮没有 commit 或 push。

## 12. P0/P1 修复后的最终核验（取代第 11 节审计基线）

第 11 节记录的是“尚未修改产品代码”的审计阶段。本节记录 F-01 至 F-11 修复完成后的同一工作树结果：

| 检查 | 结果 |
|---|---|
| `npm run typecheck` | exit 0 |
| `npm run lint` | exit 0 |
| `npm run test:unit` | exit 0；79 files / 949 tests（最终 IPv4-only 策略移除 16 个不再适用的 IPv6 用例后复跑） |
| `npm run test:integration` | exit 0；11 files / 90 tests |
| `npx vitest run --project e2e` | exit 0；4 files / 16 tests |
| `npm run test:contract` | exit 0；仍无 contract tests（F-27/P3） |
| `npm run build` | exit 0；Next.js 15.5.20，15 个静态页 |
| `npm run test:e2e` | 7/8；仍为 F-26/P3 的 knowledge tab 测试未点击 tab |
| `node --import tsx scripts/validate-wiki.ts` | exit 0；18/18 |
| `git diff --check` | exit 0 |

Playwright 仍输出 `next start` 与 standalone 配置不匹配、instrumentation 找不到 standalone migration chunks 的既有警告，归入 F-26/P3。

依赖审计在依赖复审时成功得到 0 critical / 0 high / 2 moderate；两个 moderate 来自同一条 Next 内置 PostCSS 链。最终核验阶段再次联网调用 npm audit 时，受限执行环境以“不得向外部 registry 发送私有依赖图”为由拒绝，因此没有用失败的联网复跑覆盖最近一次成功证据。

本轮仍未 commit、push 或部署；本机不得直接 push GitHub。
