# P0/P1 修复实施报告

## 1. 结论

2026-07-14 已完成审计发现 F-01 至 F-11 的修复，并提前完成与 F-11 不可分离的 F-14 响应体总超时部分。所有波次均采用测试先行、实现代理与独立复审代理分离的方式；复审发现的阻断问题均在进入下一波前修复。

本轮没有 commit、push 或部署。本机不得直接 push GitHub；后续如需推送，必须通过 sgserver 的 `/home/admin/ai-projects/iracing-ai-assistant` 中转。

## 2. Finding 关闭情况

| Finding | 状态 | 主要修复 | 关键验证 |
|---|---|---|---|
| F-01 | 已关闭 | Git 全部改为 executable + argv；路径 containment；恶意标题仅作为字面 commit message | 真实临时 Git sentinel 测试 |
| F-02 | 已关闭 | 合法同步状态、事务发布、异步 push SHA/status CAS、真实 retry 与文件/index 补偿 | 发布/仓储/真实 Git 共 69 项独立复审测试 |
| F-03 | 已关闭 | `cleaning→pending_review` 原子清 lease；恢复只处理执行态并重复 CAS 条件 | 19 integration + 65 relevant unit |
| F-04 | 已关闭 | 两阶段附件 owner/schema/migration、原子绑定、Direct/Qoder 图片输入、缓存隔离、数量/总大小限制 | 127 unit + 20 SQLite/upload/migration integration |
| F-05 | 已关闭 | 默认限流配置；global/role/user 单事务全检查后写入；共享聊天入口强制执行；诊断管理员/Origin/输入/会话归属守卫 | 63 unit + 23 integration + 4 chat e2e |
| F-06 | 已关闭 | stop 通过 message→session 校验 caller ownership，跨用户统一 NOT_FOUND | chat service/route 回归测试 |
| F-07 | 已关闭 | WebSearch 与 WebFetch 分离验证；精确 hostname/path；安全文件 containment；共享 max-turn | Qoder 聚焦 101 项 |
| F-08 | 已关闭 | 唯一 Zod evidence envelope；按真实 SDK `tool_response` 协议解析并形成 source SSE/DB 调用 | SDK 协议 fixture 与 chat consumer 测试 |
| F-09 | 已关闭 | 两处统一 `SafeMarkdown`；GFM + tag/attribute sanitizer + 双重 URL policy | 3 files / 8 component tests |
| F-10 | 已关闭 | Next 14→15.5.20、React 19.2.7；移除 `xlsx@0.18.5`，改用锁定的 `read-excel-file@9.2.0`；明确禁用 `.xls` | 40 focused、typecheck、lint、build；runtime high 2→0 |
| F-11 | 已关闭 | IPv4-only：全 A 记录校验、验证 IP 固定到 HTTPS socket、保留 Host/SNI/证书、逐跳重验；双栈忽略 AAAA，AAAA-only 明确失败 | URL/worker 50 项 |
| F-14（部分） | 已关闭 | 单一 deadline 覆盖 DNS、redirect、headers、完整 body；worker abort 销毁 request/response | slow/infinite body、caller abort、maxBytes destroy |

## 3. 复审过程中额外拦截的问题

- 发布 retry 初版只改状态、旧 push 回调可覆盖新发布、null-SHA retry 可能推旧 HEAD、DB 失败未恢复 index；均已修复。
- 限流初版缺默认配置且多 scope 会部分计数；现改为迁移 seed + 单事务全检查后写入。
- Qoder 初版误读不存在的 `tool_output`；现使用 SDK `PostToolUseHookInput.tool_response`。
- 附件初版会把图片答案写入共享文本缓存，存在跨用户内容泄漏；现图片轮禁止相关缓存读写。
- 上传初版在大小检查前读取完整文件，且单消息无数量/总字节限制；现读取前快速拒绝，最多 4 张/20 MiB。
- URL 初版在双栈域名上过度 fail-closed。根据用户明确要求，最终收敛为 IPv4-only 出站：正常 A+AAAA 域名固定到安全 A，AAAA 永不进入 socket，仅 AAAA 时明确拒绝。

## 4. 最终全量验证

| 检查 | 最终结果 |
|---|---|
| `npm run typecheck` | PASS |
| `npm run lint` | PASS |
| `npm run test:unit` | PASS：79 files / 949 tests（最终 IPv4-only 收敛后） |
| `npm run test:integration` | PASS：11 files / 90 tests |
| `npx vitest run --project e2e` | PASS：4 files / 16 tests |
| `npm run test:contract` | 退出 0，但仍无测试文件（F-27/P3） |
| `npm run build` | PASS：Next.js 15.5.20，15 个静态页 |
| `npm run test:e2e` | 7/8；唯一失败仍为 F-26/P3 的 knowledge tab 未点击测试漂移 |
| `node --import tsx scripts/validate-wiki.ts` | PASS：18/18 |
| `git diff --check` | PASS |
| `npm audit --omit=dev` | 最新成功结果：0 critical / 0 high / 2 moderate；最终联网复跑被受限环境的隐私策略拒绝 |

审计残余 2 个 moderate 实际来自同一条 `next/node_modules/postcss <8.5.10` 链。npm 给出的所谓修复会退回不受支持的 Next 9.3.3，未采用。Next 支持路线依据 [Next.js Support Policy](https://nextjs.org/support-policy) 与 [Next.js 15 Upgrade Guide](https://nextjs.org/docs/15/app/guides/upgrading/version-15)。

## 5. 明确保留到 P2/P3 的项目

- P2：F-12、F-13、F-15 至 F-24，以及 F-14 中不属于本次网络实现之外的后续策略项。
- P3：F-26 浏览器用例/standalone 启动、F-27 空 contract、F-28 统计、F-29 retry 语义。
- F-25 的版本错位和 lint 失败已因 F-10 必要的 Next/React/ESLint 对齐而消失，但仍应在后续 CI 中把 lint 固化为强制 gate。

## 6. 交付边界

- 工作树包含产品代码、迁移、测试和本 review 目录的未提交变更。
- 未调用真实付费 LLM/Qoder，也未部署到生产。
- 未创建 commit，未从本机 push GitHub。
