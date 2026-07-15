/**
 * 多轮对话 AI 测评执行器 (eval-chat.ts)
 *
 * 用法:
 *   # Direct 模式 (跑完整用例集，agent+服务层全量指标)
 *   npx tsx scripts/eval-chat.ts --mode direct --env-file /tmp/eval-creds.env
 *
 *   # HTTP 模式 (需先起 npm run dev，跑 N 轮子集测网络开销)
 *   EVAL_ADMIN_TOKEN=... npx tsx scripts/eval-chat.ts --mode http --http-url http://localhost:3000
 *
 *   # 两者都跑对比 (默认)
 *   npx tsx scripts/eval-chat.ts --mode both --env-file /tmp/eval-creds.env --http-url http://localhost:3000
 *
 * 输出: scripts/eval-results.json + scripts/eval-report.md
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

// ── 参数解析 ────────────────────────────────────────────────────────────
const argv = process.argv.slice(2);
function arg(name: string, def?: string): string | undefined {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? argv[i + 1] : def;
}
const MODE = (arg('mode', 'both') ?? 'both') as 'direct' | 'http' | 'both';
const ENV_FILE = arg('env-file');
const HTTP_URL = arg('http-url', 'http://localhost:3000')!;
const HTTP_SUBSET = parseInt(arg('http-subset', '5')!, 10);
const CASES_PATH = arg('cases', resolve(dirname(fileURLToPath(import.meta.url)), 'eval-cases.json'))!;
const OUT_JSON = resolve(dirname(fileURLToPath(import.meta.url)), 'eval-results.json');
const OUT_MD = resolve(dirname(fileURLToPath(import.meta.url)), 'eval-report.md');

// ── 加载凭据 (注入 process.env，不写项目文件) ─────────────────────────
function loadEnvFile(path: string) {
  if (!existsSync(path)) {
    console.warn(`[eval] env-file 未找到: ${path}`);
    return;
  }
  const content = readFileSync(path, 'utf-8');
  for (const line of content.split('\n')) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const eq = t.indexOf('=');
    if (eq === -1) continue;
    const k = t.slice(0, eq).trim();
    const v = t.slice(eq + 1).trim().replace(/^["']|["']$/g, '');
    if (!process.env[k]) process.env[k] = v;
  }
}
if (ENV_FILE) loadEnvFile(ENV_FILE);

// ── 强制本地 DB / Wiki 路径 (覆盖服务端 .env 的 /srv/... 路径) ──────────
process.env.DATABASE_PATH = resolve(process.cwd(), 'data/eval.sqlite');
process.env.WIKI_ROOT = resolve(process.cwd(), 'data/md-wiki');
process.env.WEB_KNOWLEDGE_SOURCES_SNAPSHOT_PATH = resolve(
  process.cwd(),
  'data/eval/knowledge-sources.md',
);
// NODE_ENV 留服务端的 production 也无妨；但确保不是 test
;(process.env as Record<string, string | undefined>).NODE_ENV = 'production';

// ── 导入服务层 (此时 @/* 已可解析) ────────────────────────────────────
import { runMigrations } from '@/db/migrate';
import { getDb, closeDb } from '@/db/client';
import { users } from '@/db/schema/users';
import { generateId } from '@/lib/uuid';
import { utcNow } from '@/lib/datetime';
import { createSession } from '@/modules/chat/repository';
import { streamChatMessage } from '@/modules/chat/service';
import type { AuthenticatedUser } from '@/modules/auth/types';
import type { SSEEvent } from '@/modules/chat/sse-events';
import {
  consumeChatEvalSse,
  ensureEvalWebKnowledgeFixture,
  ensureHttpWebKnowledgeFixture,
  isHttpEvalRequired,
  requireEvalAdminToken,
  setEvalSessionWebState,
  shouldSkipHttpEvalFailure,
} from './eval-chat-support';

// ── 类型 ────────────────────────────────────────────────────────────────
interface EvalCase {
  id: string; question: string; category: string;
  expectedTools: string[]; expectedGrounding: string; notes?: string;
}
interface EvalScenario {
  id: string; name: string; mode: string; description?: string;
  turns: EvalCase[];
}
interface TurnMetrics {
  mode: 'direct' | 'http';
  scenarioId: string; turnId: string; round: number;
  question: string; category: string;
  expectedTools: string[]; expectedGrounding: string;
  success: boolean; error?: string;
  // 服务端 timing
  ttfbMs?: number; genMs?: number; totalMs?: number; durationApiMs?: number;
  // 客户端 timing (HTTP)
  clientFirstByteMs?: number; clientTotalMs?: number;
  // tokens
  inputTokens?: number; outputTokens?: number;
  // cache
  cacheCreationTokens?: number; cacheReadTokens?: number; cacheHit?: boolean;
  contextUsageRatio?: number;
  // tools / workflow
  toolCalls: string[];
  numTurns?: number; compacted: boolean; retries: number;
  stopReason?: string | null;
  webFetchRequests?: number; webSearchRequests?: number;
  // content
  responseLength: number; responseText: string;
  grounding?: string; sourceCount: number;
  behaviorMatch?: boolean;
}

// ── 共享 SSE 采集器 ─────────────────────────────────────────────────────
/** 从一个 SSE 事件更新 TurnMetrics。eventType 形如 'start'|'delta'|'tool'|'source'|'usage'|'done'|'error' */
function collectFromEvent(eventType: string, data: any, m: TurnMetrics) {
  if (eventType === 'delta' && data.text) {
    m.responseText += data.text;
  } else if (eventType === 'tool') {
    m.toolCalls.push(data.name);
  } else if (eventType === 'source') {
    m.sourceCount++;
  } else if (eventType === 'usage') {
    m.inputTokens = data.inputTokens;
    m.outputTokens = data.outputTokens;
    m.cacheCreationTokens = data.cacheCreationInputTokens;
    m.cacheReadTokens = data.cacheReadInputTokens;
    m.cacheHit = data.cacheHit;
    m.contextUsageRatio = data.contextUsageRatio;
    m.numTurns = data.numTurns;
    m.durationApiMs = data.durationApiMs;
    m.stopReason = data.stopReason;
    if (data.serverToolUse) {
      m.webFetchRequests = data.serverToolUse.webFetchRequests;
      m.webSearchRequests = data.serverToolUse.webSearchRequests;
    }
    if (data.timing) {
      m.ttfbMs = data.timing.agentFirstByteMs;
      m.genMs = data.timing.agentStreamMs;
      m.totalMs = data.timing.totalMs;
    }
  } else if (eventType === 'done') {
    m.grounding = data.grounding;
    if (data.timing && !m.totalMs) {
      m.ttfbMs = data.timing.agentFirstByteMs;
      m.genMs = data.timing.agentStreamMs;
      m.totalMs = data.timing.totalMs;
    }
    if (data.workflow) {
      m.compacted = data.workflow.compacted;
      m.retries = data.workflow.retries;
      m.numTurns = m.numTurns ?? undefined;
    }
    if (data.status === 'complete') m.success = m.success || true;
  } else if (eventType === 'error') {
    m.error = data.message;
    m.success = false;
  }
}

function newMetrics(mode: 'direct' | 'http', sc: EvalScenario, turn: EvalCase, round: number): TurnMetrics {
  return {
    mode, scenarioId: sc.id, turnId: turn.id, round,
    question: turn.question, category: turn.category,
    expectedTools: turn.expectedTools, expectedGrounding: turn.expectedGrounding,
    success: false,
    toolCalls: [],
    compacted: false, retries: 0,
    responseLength: 0, responseText: '', sourceCount: 0,
  };
}

function finalize(m: TurnMetrics) {
  m.responseLength = m.responseText.length;
  m.responseText = m.responseText.slice(0, 400); // 截断存档
  // 行为符合预期：工具集合 ⊇ expected (expected 为空表示期望无工具→toolCalls 应为空)
  const expected = m.expectedTools;
  let toolsMatch: boolean;
  if (expected.length === 0) {
    toolsMatch = m.toolCalls.length === 0;
  } else {
    const have = new Set(m.toolCalls);
    toolsMatch = expected.every((t) => have.has(t));
  }
  const groundingMatch = m.grounding === m.expectedGrounding;
  m.behaviorMatch = toolsMatch && groundingMatch && m.success;
}

// ── Direct 模式: 直接调 streamChatMessage ──────────────────────────────
async function runDirect(scenarios: EvalScenario[], user: AuthenticatedUser): Promise<TurnMetrics[]> {
  const out: TurnMetrics[] = [];
  for (const sc of scenarios) {
    const session = createSession(user.id, `eval-${sc.id}`);
    console.log(`\n[Direct] ${sc.id} ${sc.name} (session ${session.id.slice(0, 8)})`);
    for (let i = 0; i < sc.turns.length; i++) {
      const turn = sc.turns[i]!;
      setEvalSessionWebState(session.id, user.id, turn.category);
      const m = newMetrics('direct', sc, turn, i + 1);
      const t0 = Date.now();
      process.stdout.write(`  T${i + 1} ${turn.id} [${turn.category}] ${turn.question.slice(0, 30)}... `);
      try {
        for await (const ev of streamChatMessage(user, session.id, turn.question)) {
          const evt = ev as SSEEvent;
          const type = eventTypeOf(evt);
          collectFromEvent(type, evt, m);
        }
      } catch (err) {
        m.error = (err as Error).message;
      }
      m.clientTotalMs = Date.now() - t0;
      finalize(m);
      out.push(m);
      console.log(`${m.success ? '✓' : '✗'} ${m.totalMs ?? m.clientTotalMs}ms cache=${m.cacheHit ? 'Y' : 'N'} tools=[${m.toolCalls.join(',')}] grounding=${m.grounding ?? '-'}`);
    }
  }
  return out;
}

function eventTypeOf(ev: SSEEvent): string {
  if ('seq' in ev && 'text' in ev) return 'delta';
  if ('toolUseId' in ev) return 'tool';
  if ('source' in ev) return 'source';
  if ('inputTokens' in ev) return 'usage';
  if ('status' in ev && 'grounding' in ev) return 'done';
  if ('code' in ev && 'retryable' in ev) return 'error';
  return 'start';
}

// ── HTTP 模式: 调 /api/chat/messages SSE ───────────────────────────────
async function runHttp(
  scenarios: EvalScenario[], token: string, baseUrl: string, subsetN: number,
): Promise<TurnMetrics[]> {
  const out: TurnMetrics[] = [];
  // 取每个场景第 1 轮，凑够 subsetN 轮 (跨场景测网络)
  const flat: { sc: EvalScenario; turn: EvalCase; round: number }[] = [];
  for (const sc of scenarios) {
    flat.push({ sc, turn: sc.turns[0]!, round: 1 });
  }
  const subset = flat.slice(0, subsetN);

  for (const { sc, turn, round } of subset) {
    const m = newMetrics('http', sc, turn, round);
    const t0 = performance.now();
    process.stdout.write(`  [HTTP] ${turn.id} [${turn.category}] ${turn.question.slice(0, 30)}... `);
    try {
      // 每轮新会话 (HTTP 子集只测网络开销，不测多轮 resume)
      const sres = await fetch(`${baseUrl}/api/chat/sessions`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, Origin: new URL(baseUrl).origin },
      });
      if (!sres.ok) throw new Error(`session create HTTP ${sres.status}`);
      const sjson = (await sres.json()) as { data?: { id?: unknown } };
      const sid = sjson.data?.id;
      if (typeof sid !== 'string' || sid.length === 0) {
        throw new Error('session create returned malformed JSON');
      }

      const webSearchEnabled = turn.category === 'A2';
      const patchRes = await fetch(`${baseUrl}/api/chat/sessions/${sid}`, {
        method: 'PATCH',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
          Origin: new URL(baseUrl).origin,
        },
        body: JSON.stringify({ webSearchEnabled }),
      });
      if (!patchRes.ok) throw new Error(`session Web toggle HTTP ${patchRes.status}`);
      const patchJson = (await patchRes.json()) as {
        data?: { id?: unknown; webSearchEnabled?: unknown };
      };
      if (patchJson.data?.id !== sid || patchJson.data.webSearchEnabled !== webSearchEnabled) {
        throw new Error('session Web toggle returned malformed JSON');
      }

      const res = await fetch(`${baseUrl}/api/chat/messages`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
          Origin: new URL(baseUrl).origin,
        },
        body: JSON.stringify({ sessionId: sid, content: turn.question }),
      });
      if (!res.ok) throw new Error(`chat message HTTP ${res.status}`);
      await consumeChatEvalSse(
        res,
        (eventType, data) => collectFromEvent(eventType, data, m),
        () => { m.clientFirstByteMs = Math.round(performance.now() - t0); },
      );
    } catch (err) {
      throw new Error(`HTTP eval turn ${turn.id} failed: ${(err as Error).message}`, { cause: err });
    }
    m.clientTotalMs = Math.round(performance.now() - t0);
    finalize(m);
    out.push(m);
    console.log(`${m.success ? '✓' : '✗'} cTotal=${m.clientTotalMs}ms sTotal=${m.totalMs ?? '-'}ms Δ=${m.clientTotalMs && m.totalMs ? m.clientTotalMs - m.totalMs : '-'}ms`);
  }
  return out;
}

// ── 聚合 ────────────────────────────────────────────────────────────────
function pct(sorted: number[], p: number): number {
  if (!sorted.length) return 0;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[idx]!;
}
function summarize(ms: TurnMetrics[]) {
  const ok = ms.filter((m) => m.success);
  const totals = ok.map((m) => m.totalMs ?? m.clientTotalMs ?? 0).sort((a, b) => a - b);
  const ttfbs = ok.map((m) => m.ttfbMs ?? m.clientFirstByteMs ?? 0).sort((a, b) => a - b);
  const gens = ok.map((m) => m.genMs ?? 0).sort((a, b) => a - b);
  const cacheHits = ok.filter((m) => m.cacheHit).length;
  const allTools = ok.flatMap((m) => m.toolCalls);
  const toolDist: Record<string, number> = {};
  for (const t of allTools) toolDist[t] = (toolDist[t] ?? 0) + 1;
  const behaviorMatch = ok.filter((m) => m.behaviorMatch).length;
  return {
    count: ms.length, success: ok.length, fail: ms.length - ok.length,
    successRate: ms.length ? +(ok.length / ms.length * 100).toFixed(1) : 0,
    latency: {
      ttfb: { p50: pct(ttfbs, 50), p95: pct(ttfbs, 95), mean: ttfbs.length ? Math.round(ttfbs.reduce((a, b) => a + b, 0) / ttfbs.length) : 0 },
      gen: { p50: pct(gens, 50), p95: pct(gens, 95), mean: gens.length ? Math.round(gens.reduce((a, b) => a + b, 0) / gens.length) : 0 },
      total: { p50: pct(totals, 50), p95: pct(totals, 95), mean: totals.length ? Math.round(totals.reduce((a, b) => a + b, 0) / totals.length) : 0 },
    },
    cache: {
      hitRate: ok.length ? +(cacheHits / ok.length * 100).toFixed(1) : 0,
      avgCacheRead: ok.length ? Math.round(ok.reduce((a, m) => a + (m.cacheReadTokens ?? 0), 0) / ok.length) : 0,
      avgCacheCreate: ok.length ? Math.round(ok.reduce((a, m) => a + (m.cacheCreationTokens ?? 0), 0) / ok.length) : 0,
    },
    tools: toolDist,
    workflow: {
      avgNumTurns: ok.length ? +(ok.reduce((a, m) => a + (m.numTurns ?? 0), 0) / ok.length).toFixed(1) : 0,
      compactedCount: ok.filter((m) => m.compacted).length,
      retryCount: ok.reduce((a, m) => a + m.retries, 0),
    },
    behaviorMatchRate: ok.length ? +(behaviorMatch / ok.length * 100).toFixed(1) : 0,
    totalTokens: ms.reduce((a, m) => a + (m.inputTokens ?? 0) + (m.outputTokens ?? 0), 0),
  };
}

// ── Markdown 报告 ──────────────────────────────────────────────────────
function fmtMs(ms: number | undefined): string {
  if (ms === undefined) return '-';
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}
function genReport(direct: TurnMetrics[] | null, http: TurnMetrics[] | null): string {
  const lines: string[] = [];
  lines.push('# 多轮对话 AI 测评报告\n');
  lines.push(`> 生成时间: ${utcNow()} | 模型: ${process.env.QODER_MODEL ?? 'Qwen3.7-Plus'}\n`);

  if (direct) {
    const s = summarize(direct);
    lines.push('## 一、Direct 模式 (服务层, 完整用例集)\n');
    lines.push(`- 总轮次: **${s.count}** | 成功: **${s.success}** | 失败: **${s.fail}** | 成功率: **${s.successRate}%**`);
    lines.push(`- TTFB: p50=${fmtMs(s.latency.ttfb.p50)} p95=${fmtMs(s.latency.ttfb.p95)} 均=${fmtMs(s.latency.ttfb.mean)}`);
    lines.push(`- 生成时延: p50=${fmtMs(s.latency.gen.p50)} p95=${fmtMs(s.latency.gen.p95)} 均=${fmtMs(s.latency.gen.mean)}`);
    lines.push(`- 总耗时: p50=${fmtMs(s.latency.total.p50)} p95=${fmtMs(s.latency.total.p95)} 均=${fmtMs(s.latency.total.mean)}`);
    lines.push(`- **缓存命中率: ${s.cache.hitRate}%** | 平均 cache_read=${s.cache.avgCacheRead} tokens | 平均 cache_create=${s.cache.avgCacheCreate} tokens`);
    lines.push(`- 工具调用分布: ${JSON.stringify(s.tools)}`);
    lines.push(`- Agent 工作流: 平均 num_turns=${s.workflow.avgNumTurns} | 压缩触发=${s.workflow.compactedCount} | 重试=${s.workflow.retryCount}`);
    lines.push(`- 行为符合预期率: ${s.behaviorMatchRate}%`);
    lines.push(`- 总 token: ${s.totalTokens.toLocaleString()}\n`);

    // 每轮明细表
    lines.push('### 每轮明细 (Direct)\n');
    lines.push('| 场景 | 轮 | 类别 | 问题 | TTFB | 生成 | 总耗时 | in/out | 缓存 | cache_read | 工具 | numTurns | grounding | 行为 | 结果 |');
    lines.push('|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|');
    for (const m of direct) {
      const q = m.question.slice(0, 18).replace(/\|/g, '/');
      lines.push([
        m.scenarioId, m.round, m.category, q,
        fmtMs(m.ttfbMs), fmtMs(m.genMs), fmtMs(m.totalMs),
        `${m.inputTokens ?? '-'}/${m.outputTokens ?? '-'}`,
        m.cacheHit ? '✓' : '✗',
        String(m.cacheReadTokens ?? '-'),
        m.toolCalls.join(',') || '-',
        m.numTurns ?? '-',
        m.grounding ?? '-',
        m.behaviorMatch ? '✓' : '✗',
        m.success ? '✓' : '✗',
      ].join('|'));
    }
    lines.push('');

    // 缓存压测场景趋势
    const s4 = direct.filter((m) => m.scenarioId === 'S4');
    if (s4.length) {
      lines.push('### S4 缓存压测趋势\n');
      lines.push('| 轮 | cache_create | cache_read | 命中 |');
      lines.push('|---|---|---|---|');
      for (const m of s4) lines.push(`| T${m.round} | ${m.cacheCreationTokens ?? '-'} | ${m.cacheReadTokens ?? '-'} | ${m.cacheHit ? '✓' : '✗'} |`);
      lines.push('');
    }
  }

  if (http) {
    const s = summarize(http);
    lines.push('## 二、HTTP 模式 (全链路, 子集)\n');
    lines.push(`- 子集轮次: ${s.count} | 成功率: ${s.successRate}%`);
    lines.push(`- 客户端总耗时: p50=${fmtMs(s.latency.total.p50)} p95=${fmtMs(s.latency.total.p95)} 均=${fmtMs(s.latency.total.mean)}`);
    lines.push(`- 缓存命中率: ${s.cache.hitRate}%\n`);
  }

  if (direct && http) {
    lines.push('## 三、Direct vs HTTP 对比 (网络壳开销)\n');
    lines.push('| 指标 | Direct | HTTP | Δ (HTTP−Direct) |');
    lines.push('|---|---|---|---|');
    const d = summarize(direct), h = summarize(http);
    lines.push(`| 总耗时 p50 | ${fmtMs(d.latency.total.p50)} | ${fmtMs(h.latency.total.p50)} | ${fmtMs((h.latency.total.p50 || 0) - (d.latency.total.p50 || 0))} |`);
    lines.push(`| 总耗时均值 | ${fmtMs(d.latency.total.mean)} | ${fmtMs(h.latency.total.mean)} | ${fmtMs((h.latency.total.mean || 0) - (d.latency.total.mean || 0))} |`);
    lines.push(`| TTFB p50 | ${fmtMs(d.latency.ttfb.p50)} | ${fmtMs(h.latency.ttfb.p50)} | ${fmtMs((h.latency.ttfb.p50 || 0) - (d.latency.ttfb.p50 || 0))} |`);
    lines.push('');
  }

  lines.push('## 四、结论与瓶颈\n');
  if (direct) {
    const s = summarize(direct);
    lines.push(`- **缓存**: 命中率 ${s.cache.hitRate}%。SDK resume 机制下，多轮应逐步建立缓存——若 S4 后几轮 cache_read 仍≈0，说明缓存未生效或上下文变动过大。`);
    lines.push(`- **延迟瓶颈**: TTFB 均值 ${fmtMs(s.latency.ttfb.mean)}（含 reasoningEffort=high 推理 + 工具调用）；生成均值 ${fmtMs(s.latency.gen.mean)}。`);
    lines.push(`- **工具路由**: ${Object.keys(s.tools).length ? JSON.stringify(s.tools) : '无工具调用'}。`);
    lines.push(`- **行为符合预期**: ${s.behaviorMatchRate}%——若低，检查 system prompt scope lock / 工具路由是否符合用例标注。`);
  }
  lines.push('\n> 原始数据见 `scripts/eval-results.json`');
  return lines.join('\n');
}

// ── 主流程 ──────────────────────────────────────────────────────────────
async function main() {
  const usesDirect = MODE === 'direct' || MODE === 'both';
  const usesHttp = MODE === 'http' || MODE === 'both';
  const httpRequired = isHttpEvalRequired(argv, MODE);
  if (usesDirect && !process.env.QODER_PERSONAL_ACCESS_TOKEN) {
    console.error('[eval] ✗ 缺少 QODER_PERSONAL_ACCESS_TOKEN (用 --env-file 指向凭据文件)');
    process.exit(1);
  }

  // 加载用例集
  const cases = JSON.parse(readFileSync(CASES_PATH, 'utf-8')) as { scenarios: EvalScenario[] };
  console.log(`[eval] 用例集: ${cases.scenarios.length} 场景, 共 ${cases.scenarios.reduce((a, s) => a + s.turns.length, 0)} 轮`);
  console.log(`[eval] 模式: ${MODE} | HTTP_URL: ${HTTP_URL} | HTTP子集: ${HTTP_SUBSET}`);

  let direct: TurnMetrics[] | null = null;
  let http: TurnMetrics[] | null = null;

  // Direct 模式
  if (usesDirect) {
    console.log(`[eval] 初始化隔离 DB: ${process.env.DATABASE_PATH}`);
    runMigrations(process.env.DATABASE_PATH!);
    const db = getDb();
    let userId = generateId();
    const now = utcNow();
    const existing = db.select().from(users).all().find((u) => u.username === 'eval-runner');
    if (existing) {
      userId = existing.id;
    } else {
      await db.insert(users).values({
        id: userId, username: 'eval-runner', passwordHash: '$2b$12$fakehashfortestingonly',
        role: 'admin', status: 'active', createdAt: now, updatedAt: now, approvedAt: now,
      });
    }
    const user: AuthenticatedUser = {
      id: userId, username: 'eval-runner', role: 'admin', status: 'active',
    };
    console.log('\n========== Direct 模式 ==========');
    const fixture = ensureEvalWebKnowledgeFixture(user.id);
    console.log(`[eval] Web fixture: ${fixture.rules[0]!.url} | snapshot: ${fixture.snapshotPath}`);
    direct = await runDirect(cases.scenarios, user);
  }

  // HTTP 模式
  if (usesHttp) {
    console.log('\n========== HTTP 模式 ==========');
    let token = httpRequired ? requireEvalAdminToken(process.env) : undefined;
    try {
      const ping = await fetch(`${HTTP_URL}/api/health/live`);
      if (!ping.ok) throw new Error(`health ${ping.status}`);
      token ??= requireEvalAdminToken(process.env);
      await ensureHttpWebKnowledgeFixture(HTTP_URL, token);
      http = await runHttp(cases.scenarios, token, HTTP_URL, HTTP_SUBSET);
    } catch (err) {
      if (shouldSkipHttpEvalFailure(err, httpRequired)) {
        console.warn(`[eval] HTTP 模式跳过: 默认服务不可达 (${(err as Error).message})`);
        http = null;
      } else {
        throw err;
      }
    }
  }

  // 输出
  const report = { timestamp: utcNow(), model: process.env.QODER_MODEL ?? 'Qwen3.7-Plus', direct, http,
    directSummary: direct ? summarize(direct) : null, httpSummary: http ? summarize(http) : null };
  writeFileSync(OUT_JSON, JSON.stringify(report, null, 2));
  writeFileSync(OUT_MD, genReport(direct, http));
  console.log(`\n[eval] ✓ 完成: ${OUT_JSON} + ${OUT_MD}`);

  if (usesDirect) closeDb();
}

main().catch((err) => {
  console.error('[eval] ✗ 致命错误:', err);
  process.exit(1);
});
