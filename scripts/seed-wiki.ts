/**
 * 知识库种子清洗脚本
 *
 * 流程：
 *   1. 从白名单域名抓取 iRacing 相关页面原始文本
 *   2. 优先通过可配置的 OpenAI 兼容 LLM API 清洗（如 LongCat-2.0）
 *      非限流/额度错误时，兜底使用 Qoder SDK + Qwen3.7-Plus
 *   3. 写入 ./data/md-wiki 对应目录
 *   4. 调用 rebuildIndex 生成 index.md
 *
 * 用法：
 *   npx tsx scripts/seed-wiki.ts           # 处理全部种子 URL
 *   npx tsx scripts/seed-wiki.ts --dry-run # 仅抓取+预览，不写文件
 *
 * @module scripts/seed-wiki
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { readFileSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { query, accessTokenFromEnv } from '@qoder-ai/qoder-agent-sdk';

// ── 手动加载 .env ──────────────────────────────────────────────────────────
const envPath = resolve(__dirname, '..', '.env');
for (const line of readFileSync(envPath, 'utf-8').split('\n')) {
  const t = line.trim();
  if (!t || t.startsWith('#')) continue;
  const i = t.indexOf('=');
  if (i === -1) continue;
  const k = t.slice(0, i);
  if (!process.env[k]) process.env[k] = t.slice(i + 1);
}

// ── 常量 ──────────────────────────────────────────────────────────────────

const MODEL = process.env.QODER_MODEL ?? 'Qwen3.7-Plus';
const WIKI_ROOT = resolve(__dirname, '..', process.env.WIKI_ROOT ?? './data/md-wiki');
const TEMP_DIR = join(WIKI_ROOT, '..', '.seed-temp');
const DRY_RUN = process.argv.includes('--dry-run');
const FORCE = process.argv.includes('--force');
const STOP_ON_LLM_RATE_LIMIT = process.env.STOP_ON_LLM_RATE_LIMIT !== 'false';

interface OpenAiCompatibleProvider {
  name: string;
  baseUrl: string;
  apiKey: string;
  model: string;
}

class StopCleaningError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'StopCleaningError';
  }
}

function getOpenAiCompatibleProviders(): OpenAiCompatibleProvider[] {
  const providerNames = (process.env.LLM_API_PROVIDERS ?? 'longcat')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

  return providerNames
    .map((name) => {
      const key = name.toUpperCase().replace(/[^A-Z0-9]/g, '_');
      const baseUrl = process.env[`${key}_API_BASE_URL`] ?? process.env[`${key}_BASE_URL`] ?? '';
      const apiKey = process.env[`${key}_API_KEY`] ?? '';
      const model = process.env[`${key}_MODEL`] ?? '';
      if (!baseUrl || !apiKey || !model) return null;
      return { name, baseUrl, apiKey, model };
    })
    .filter((p): p is OpenAiCompatibleProvider => p !== null);
}

function maskSecret(value: string): string {
  if (value.length <= 8) return '****';
  return `${value.slice(0, 4)}...${value.slice(-4)}`;
}

function isRateLimitOrQuotaError(status: number, bodyText: string): boolean {
  const lower = bodyText.toLowerCase();
  return (
    status === 429 ||
    status === 402 ||
    lower.includes('rate_limit') ||
    lower.includes('rate limit') ||
    lower.includes('too many requests') ||
    lower.includes('quota') ||
    lower.includes('insufficient') ||
    lower.includes('余额') ||
    lower.includes('额度') ||
    lower.includes('限流') ||
    lower.includes('超限')
  );
}

/**
 * 种子 URL 列表 —— 全部来自白名单域名，按主题分组
 *
 * 筛选标准：
 *   - 内容必须是 iRacing 核心知识（驾驶技巧、车辆调校、入门指南）
 *   - 优先选官方/权威来源
 *   - 排除纯论坛讨论帖（无结论性知识）
 *   - 排除时效性强的新闻/公告
 */
const SEED_URLS: Array<{ url: string; hint: string; category: string }> = [
  // ── basics / getting-started ──────────────────────────────────────
  {
    url: 'https://iracing.com/getting-started/',
    hint: 'iRacing 官方新手入门指南：如何注册、下载、开始第一场比赛',
    category: 'basics',
  },
  {
    url: 'https://hipole.com/iracing/',
    hint: '嗨跑赛车中文 iRacing 教程：模拟赛车驾驶学校，新手入门',
    category: 'basics',
  },
  // ── basics / series-and-league ────────────────────────────────────
  {
    url: 'https://iracing.com/safety-rating/',
    hint: 'iRacing 安全评分（Safety Rating）系统详解：如何计算、如何提升',
    category: 'basics',
  },
  // ── basics / buying-guide ─────────────────────────────────────────
  {
    url: 'https://iracing.com/cars/',
    hint: 'iRacing 车辆目录：所有可用赛车分类与购买说明',
    category: 'basics',
  },
  // ── track-technique / driving-line ────────────────────────────────
  {
    url: 'https://iracing.com/tracks/',
    hint: 'iRacing 赛道目录：全球真实赛道的激光扫描数据与赛道列表',
    category: 'track-technique',
  },
  // ── track-technique / braking ─────────────────────────────────────
  {
    url: 'https://www.iracing.com/physics-modeling-ntm-v7-info-plus/',
    hint: 'iRacing 官方物理模型与轮胎模型说明：NTM v7、抓地、轮胎行为与驾驶感受',
    category: 'track-technique',
  },
  // ── basics / hardware ─────────────────────────────────────────────
  {
    url: 'https://www.iracing.com/wheels/',
    hint: 'iRacing 模拟赛车硬件建议：方向盘、踏板、座舱与显示设备',
    category: 'basics',
  },
  // ── basics / series-and-league ────────────────────────────────────
  {
    url: 'https://www.iracing.com/series/',
    hint: 'iRacing 官方系列赛说明：不同赛事系列、赛程和参赛方式',
    category: 'basics',
  },
  // ── basics / getting-started ──────────────────────────────────────
  {
    url: 'https://support.iracing.com/support/solutions/articles/31000133336-new-racer-guide-how-to-get-started',
    hint: 'iRacing 官方新手指南：从零开始完成账户创建、安装、硬件与首场比赛准备',
    category: 'basics',
  },
  {
    url: 'https://support.iracing.com/support/solutions/articles/31000168572-iracing-setup-a-beginner-s-guide-on-how-to-get-started',
    hint: 'iRacing 新手安装与设置指南：软件安装、控制器配置、座椅位置与基础车辆调校',
    category: 'basics',
  },
  // ── basics / series-and-league ────────────────────────────────────
  {
    url: 'https://support.iracing.com/support/solutions/articles/31000133523-what-is-irating',
    hint: 'iRating 官方解释：评分机制、分类独立性、与驾照等级的关系',
    category: 'basics',
  },
  {
    url: 'https://support.iracing.com/support/solutions/articles/31000133459-iracing-how-to-what-are-licenses-',
    hint: 'iRacing 驾照等级说明：Rookie/D/C/B/A/Pro 分类与晋升规则',
    category: 'basics',
  },
  {
    url: 'https://support.iracing.com/support/solutions/articles/31000173706-graduating-from-rookie-class',
    hint: '如何从 Rookie 毕业：晋级条件、赛季规则与新手晋升建议',
    category: 'basics',
  },
  // ── track-technique / driving-line ────────────────────────────────
  {
    url: 'https://www.hipole.com/2016/02/racingline-i/',
    hint: 'HiPole 赛车线基础教程：外内外的物理原理、弯心与入弯出弯参照物',
    category: 'track-technique',
  },
  // ── car-setup / tools ─────────────────────────────────────────────
  {
    url: 'https://coachdaveacademy.com/tutorials/a-delta-guide-understanding-brake-traces-to-be-faster/',
    hint: 'Coach Dave Academy 刹车曲线分析教程：初始刹车、trail braking 与数据对比方法',
    category: 'car-setup',
  },
  // ── track-technique / braking ─────────────────────────────────────
  {
    url: 'https://coachdaveacademy.com/tutorials/racecraft-how-to-get-better-in-sim-racing/',
    hint: 'Coach Dave Academy Racecraft 教程：刹车稳定性、trail braking、超车判断与驾驶一致性',
    category: 'track-technique',
  },
  // ── basics / getting-started ──────────────────────────────────────
  {
    url: 'https://coachdaveacademy.com/tutorials/iracing-for-dummies/',
    hint: 'Coach Dave Academy iRacing 入门指南：从车辆、赛道、设置到新手训练路径',
    category: 'basics',
  },
];

// ── Front Matter 模板 ──────────────────────────────────────────────────────

const CLEANER_SYSTEM_PROMPT = `
You are a knowledge cleaning agent for the iRacing AI assistant's wiki.

## Goal
Convert raw web page text into a clean, well-structured Markdown document
with YAML Front Matter metadata.

## Output Format

The output MUST start with Front Matter delimited by "---":

---
title: <concise title, max 200 chars>
category: <one of: track-technique | car-setup | basics>
subcategory: <one of: driving-line | braking | tire-management | suspension | theory | presets | tools | getting-started | buying-guide | series-and-league | hardware>
tags: [tag1, tag2, tag3]
source_name: <original website name>
source_url: <original URL>
season: <optional, e.g. 2025S3>
---

Then the body: a clean Markdown document with:
- A clear H1 title
- Logical H2/H3 heading hierarchy
- Clean paragraphs, no orphan lines
- Tables preserved in proper Markdown table syntax
- All advertising, navigation, cookie banners, and irrelevant content stripped
- Factual accuracy preserved — do NOT paraphrase technical values
- Image references converted to ![alt](url) placeholders where possible
- If the source is too noisy, output a brief explanation instead

## Category Guide
- track-technique: driving techniques, racing line, braking, tire management
- car-setup: car setup theory, preset guides, setup tools
- basics: getting started, buying guide, license system, hardware requirements

## Rules
- Write in the SAME LANGUAGE as the source content (English stays English)
- Keep technical terms, values, and units exactly as in the source
- Maximum 3000 words in the body
- Do NOT add content not present in the source
- Respond with ONLY the cleaned Markdown document, nothing else
`.trim();

function sourceAlreadyExists(sourceUrl: string): string | null {
  if (FORCE || !fs.existsSync(WIKI_ROOT)) return null;

  function walk(dir: string): string | null {
    for (const entry of fs.readdirSync(dir)) {
      const fullPath = path.join(dir, entry);
      const stat = fs.statSync(fullPath);
      if (stat.isDirectory()) {
        const found = walk(fullPath);
        if (found) return found;
      } else if (entry.endsWith('.md')) {
        const content = fs.readFileSync(fullPath, 'utf-8');
        if (content.includes(`source_url: ${sourceUrl}`)) {
          return path.relative(WIKI_ROOT, fullPath).replace(/\\/g, '/');
        }
      }
    }
    return null;
  }

  return walk(WIKI_ROOT);
}

// ── URL 抓取（简单 SSRF 安全版）────────────────────────────────────────────

const ALLOWLIST = [
  'support.iracing.com',
  'iracing.com',
  'forums.iracing.com',
  'reddit.com/r/iRacing',
  'hipole.com',
  'coachdaveacademy.com',
  'newsroom.porsche.com',
];

function isAllowlisted(url: string): boolean {
  try {
    const hostname = new URL(url).hostname.toLowerCase();
    return ALLOWLIST.some((d) => hostname === d || hostname.endsWith(`.${d}`));
  } catch {
    return false;
  }
}

async function fetchPage(url: string): Promise<{ text: string; truncated: boolean }> {
  if (!isAllowlisted(url)) {
    throw new Error(`URL not in allowlist: ${url}`);
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 45_000);

  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        'user-agent': 'iRacing-AI-Assistant/1.0 (+https://iracing-ai.local)',
        accept: 'text/html,application/xhtml+xml,*/*;q=0.9',
      },
    });

    if (!res.ok) {
      throw new Error(`HTTP ${res.status} ${res.statusText}`);
    }

    const html = await res.text();
    const truncated = html.length > 5_000_000;

    // 简单提取可读文本（去掉 script/style/nav）
    const text = html
      .replace(/<script[\s\S]*?<\/script>/gi, '')
      .replace(/<style[\s\S]*?<\/style>/gi, '')
      .replace(/<nav[\s\S]*?<\/nav>/gi, '')
      .replace(/<header[\s\S]*?<\/header>/gi, '')
      .replace(/<footer[\s\S]*?<\/footer>/gi, '')
      .replace(/<[^>]+>/g, '\n')
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/\n{3,}/g, '\n\n')
      .trim()
      .slice(0, 80_000); // 最多 80K 字符

    return { text, truncated };
  } finally {
    clearTimeout(timer);
  }
}

// ── OpenAI 兼容 LLM API 清洗（LongCat 优先，可扩展多个 Provider）────────────

function makeCleanerUserPrompt(rawText: string, sourceUrl: string, hint: string): string {
  return `Clean the following raw web page text into a structured Markdown document with Front Matter.

Source URL: ${sourceUrl}
Context hint: ${hint}

--- RAW TEXT START ---
${rawText.slice(0, 40_000)}
--- RAW TEXT END ---

Output ONLY the cleaned Markdown document (starting with "---" Front Matter). Nothing else.`;
}

async function cleanWithOpenAiCompatibleProvider(
  provider: OpenAiCompatibleProvider,
  rawText: string,
  sourceUrl: string,
  hint: string,
): Promise<string> {
  const endpoint = `${provider.baseUrl.replace(/\/$/, '')}/v1/chat/completions`;
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${provider.apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: provider.model,
      messages: [
        { role: 'system', content: CLEANER_SYSTEM_PROMPT },
        { role: 'user', content: makeCleanerUserPrompt(rawText, sourceUrl, hint) },
      ],
      temperature: 0.2,
      max_tokens: 6000,
    }),
  });

  const bodyText = await response.text();

  if (!response.ok) {
    if (STOP_ON_LLM_RATE_LIMIT && isRateLimitOrQuotaError(response.status, bodyText)) {
      throw new StopCleaningError(
        `${provider.name} 返回限流/额度错误，已按配置停止本轮清洗。HTTP ${response.status}: ${bodyText.slice(0, 300)}`,
      );
    }
    throw new Error(`${provider.name} API failed: HTTP ${response.status}: ${bodyText.slice(0, 500)}`);
  }

  let json: any;
  try {
    json = JSON.parse(bodyText);
  } catch {
    throw new Error(`${provider.name} API returned non-JSON response: ${bodyText.slice(0, 200)}`);
  }

  const content = json?.choices?.[0]?.message?.content;
  if (!content || typeof content !== 'string') {
    throw new Error(`${provider.name} API response missing choices[0].message.content`);
  }

  return content.trim();
}

async function cleanWithConfiguredLLMs(rawText: string, sourceUrl: string, hint: string): Promise<string> {
  const providers = getOpenAiCompatibleProviders();

  for (const provider of providers) {
    try {
      console.log(
        `        LLM API: ${provider.name} / ${provider.model} (${provider.baseUrl}, key ${maskSecret(provider.apiKey)})`,
      );
      return await cleanWithOpenAiCompatibleProvider(provider, rawText, sourceUrl, hint);
    } catch (err) {
      if (err instanceof StopCleaningError) throw err;
      const message = err instanceof Error ? err.message : String(err);
      console.log(`        LLM API失败，尝试下一个Provider/兜底: ${message}`);
    }
  }

  console.log(`        使用 Qoder SDK + ${MODEL} 兜底清洗`);
  return cleanWithQwen(rawText, sourceUrl, hint);
}

// ── Qoder SDK + Qwen3.7-Plus 兜底清洗 ─────────────────────────────────────

async function cleanWithQwen(rawText: string, sourceUrl: string, hint: string): Promise<string> {
  const cliPath =
    process.platform === 'win32'
      ? [
          join(process.env.APPDATA ?? '', 'npm', 'node_modules', '@qoder-ai', 'qodercli', 'bundle', 'qodercli.js'),
        ].find(existsSync)
      : undefined;

  const prompt = makeCleanerUserPrompt(rawText, sourceUrl, hint);

  const q = query({
    prompt,
    options: {
      auth: accessTokenFromEnv(),
      model: MODEL,
      maxTurns: 3,
      ...(cliPath ? { pathToQoderCLIExecutable: cliPath } : {}),
      systemPrompt: CLEANER_SYSTEM_PROMPT,
      disallowedTools: ['Write', 'Edit', 'Bash', 'Agent', 'WebFetch', 'WebSearch'],
    },
  });

  let fullText = '';

  for await (const msg of q) {
    // 捕获流式输出
    if (msg.type === 'stream_event') {
      const event = msg.event;
      if (event.type === 'content_block_delta') {
        const delta = event.delta as { text?: string } | undefined;
        if (delta?.text) fullText += delta.text;
      }
    }
    // 捕获完整 assistant 消息（某些模型不输出 stream_event）
    if (msg.type === 'assistant') {
      const assistantMsg = msg.message as { content?: Array<{ type: string; text?: string }> };
      for (const block of assistantMsg.content ?? []) {
        if (block.type === 'text' && block.text && !fullText.includes(block.text)) {
          fullText = block.text;
        }
      }
    }
    // 错误处理
    if (msg.type === 'result') {
      if (msg.subtype !== 'success') {
        const errs = 'errors' in msg ? (msg.errors as string[])?.join('; ') : 'unknown';
        throw new Error(`Qoder query failed: ${errs}`);
      }
    }
  }

  return fullText.trim();
}

// ── Front Matter 验证 + 路径生成 ─────────────────────────────────────────

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9\-\u4e00-\u9fff\u3400-\u4dbf]/g, '')
    .replace(/-{2,}/g, '-')
    .replace(/^-+|-+$/g, '');
}

interface ParsedWiki {
  frontMatter: Record<string, string | string[]>;
  body: string;
  wikiPath: string;
}

function parseAndValidate(content: string): ParsedWiki & { fixedContent: string } {
  // 容错：如果开头没有 ---，但第一行是 title: 或 category:，自动补上
  let fixed = content;
  if (!fixed.startsWith('---')) {
    // 找到第一个 Front Matter 字段
    const fmFieldRe = /^(title|category|subcategory|tags|source_name|source_url|season|updated_at):/m;
    const match = fmFieldRe.exec(fixed);
    if (match) {
      // 找 Front Matter 结束位置（下一个 H1 或空行后的非 FM 字段）
      const bodyStart = fixed.indexOf('\n# ');
      if (bodyStart !== -1) {
        const fmBlock = fixed.slice(0, bodyStart).trim();
        const body = fixed.slice(bodyStart).trim();
        fixed = `---\n${fmBlock}\n---\n\n${body}`;
      } else {
        // 尝试找连续空行分隔
        const doubleNewline = fixed.indexOf('\n\n');
        if (doubleNewline !== -1 && doubleNewline < 500) {
          const fmBlock = fixed.slice(0, doubleNewline).trim();
          const body = fixed.slice(doubleNewline).trim();
          fixed = `---\n${fmBlock}\n---\n\n${body}`;
        }
      }
    }
  }

  if (!fixed.startsWith('---')) {
    throw new Error('Output does not start with Front Matter delimiter');
  }

  const afterOpen = fixed.indexOf('\n');
  const closePattern = '\n---';
  const closeIdx = fixed.indexOf(closePattern, afterOpen + 1);
  if (closeIdx === -1) {
    throw new Error('Front Matter closing delimiter not found');
  }

  const yamlBlock = fixed.slice(afterOpen + 1, closeIdx);
  const body = fixed.slice(closeIdx + closePattern.length).replace(/^\n/, '');

  // 简单 YAML 解析
  const fm: Record<string, string | string[]> = {};
  for (const line of yamlBlock.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const colonIdx = trimmed.indexOf(':');
    if (colonIdx === -1) continue;
    const key = trimmed.slice(0, colonIdx).trim();
    const raw = trimmed.slice(colonIdx + 1).trim();
    if (raw.startsWith('[') && raw.endsWith(']')) {
      fm[key] = raw.slice(1, -1).split(',').map((s) => s.trim()).filter(Boolean);
    } else {
      fm[key] = raw;
    }
  }

  // 基本验证
  const required = ['title', 'category', 'subcategory', 'tags'];
  for (const key of required) {
    if (!fm[key]) throw new Error(`Missing required Front Matter field: ${key}`);
  }

  const validCategories = ['track-technique', 'car-setup', 'basics'];
  if (!validCategories.includes(fm.category as string)) {
    throw new Error(`Invalid category: ${fm.category}`);
  }

  const slug = slugify(fm.title as string) || 'untitled';
  const wikiPath = `${fm.category}/${fm.subcategory}/${slug}.md`;

  return { frontMatter: fm, body, wikiPath, fixedContent: fixed };
}

// ── index.md 生成 ──────────────────────────────────────────────────────────

function rebuildIndex(wikiRoot: string): string {
  const lines: string[] = ['# Knowledge Index'];
  const entries: Array<{ title: string; category: string; subcategory: string; path: string; tags: string[] }> = [];

  function walk(dir: string) {
    if (!fs.existsSync(dir)) return;
    for (const entry of fs.readdirSync(dir)) {
      const fullPath = path.join(dir, entry);
      const stat = fs.statSync(fullPath);
      if (stat.isDirectory()) {
        walk(fullPath);
      } else if (entry.endsWith('.md') && entry !== 'index.md') {
        try {
          const content = fs.readFileSync(fullPath, 'utf-8');
          const parsed = parseAndValidate(content);
          entries.push({
            title: parsed.frontMatter.title as string,
            category: parsed.frontMatter.category as string,
            subcategory: parsed.frontMatter.subcategory as string,
            path: path.relative(wikiRoot, fullPath).replace(/\\/g, '/'),
            tags: (parsed.frontMatter.tags as string[]) ?? [],
          });
        } catch {
          // skip
        }
      }
    }
  }

  walk(wikiRoot);

  // 按 category → subcategory → title 排序
  entries.sort((a, b) => {
    const catOrder = ['track-technique', 'car-setup', 'basics'];
    const ca = catOrder.indexOf(a.category) - catOrder.indexOf(b.category);
    if (ca !== 0) return ca;
    const sub = a.subcategory.localeCompare(b.subcategory);
    if (sub !== 0) return sub;
    return a.title.localeCompare(b.title);
  });

  let lastCat = '';
  let lastSub = '';
  for (const e of entries) {
    if (e.category !== lastCat) {
      lines.push('', `## ${e.category}`);
      lastCat = e.category;
      lastSub = '';
    }
    if (e.subcategory !== lastSub) {
      lines.push('', `### ${e.subcategory}`);
      lastSub = e.subcategory;
    }
    const tagPart = e.tags.length > 0 ? ` — Tags: ${e.tags.join(', ')}` : '';
    lines.push(`- [${e.title}](${e.path})${tagPart}`);
  }
  lines.push('');
  return lines.join('\n');
}

// ── 主流程 ─────────────────────────────────────────────────────────────────

interface ProcessResult {
  url: string;
  status: 'success' | 'failed' | 'skipped';
  wikiPath?: string;
  title?: string;
  error?: string;
  fetchChars?: number;
  cleanChars?: number;
}

async function main() {
  console.log(`\n${'═'.repeat(60)}`);
  console.log(`  知识库种子清洗脚本`);
  console.log(`  Qoder 兜底模型: ${MODEL}`);
  const providers = getOpenAiCompatibleProviders();
  console.log(
    `  LLM API Providers: ${providers.length > 0 ? providers.map((p) => `${p.name}/${p.model}`).join(', ') : '(none)'}`,
  );
  console.log(`  Wiki 根目录: ${WIKI_ROOT}`);
  console.log(`  种子 URL 数: ${SEED_URLS.length}`);
  console.log(`  Dry Run: ${DRY_RUN}`);
  console.log(`  Force: ${FORCE}`);
  console.log(`${'═'.repeat(60)}\n`);

  // 确保目录存在
  fs.mkdirSync(WIKI_ROOT, { recursive: true });
  fs.mkdirSync(TEMP_DIR, { recursive: true });

  const results: ProcessResult[] = [];

  for (let i = 0; i < SEED_URLS.length; i++) {
    const { url, hint, category } = SEED_URLS[i]!;
    const progress = `[${i + 1}/${SEED_URLS.length}]`;

    console.log(`${progress} 抓取: ${url}`);
    console.log(`        提示: ${hint} | 预期分类: ${category}`);

    let result: ProcessResult = { url, status: 'skipped' };

    const existingPath = sourceAlreadyExists(url);
    if (existingPath) {
      console.log(`        已存在，跳过: ${existingPath}`);
      results.push({ url, status: 'skipped', wikiPath: existingPath });
      continue;
    }

    try {
      // Step 1: 抓取
      const { text, truncated } = await fetchPage(url);
      result.fetchChars = text.length;

      if (text.length < 200) {
        throw new Error(`抓取内容过短 (${text.length} 字符)，可能无法提取有效知识`);
      }

      console.log(`        抓取: ${text.length} 字符${truncated ? ' (已截断)' : ''}`);

      if (DRY_RUN) {
        console.log(`        [DRY RUN] 跳过清洗`);
        result.status = 'skipped';
        results.push(result);
        continue;
      }

      // Step 2: 清洗
      console.log(`        清洗中...`);
      const cleaned = await cleanWithConfiguredLLMs(text, url, hint);
      result.cleanChars = cleaned.length;
      console.log(`        清洗完成: ${cleaned.length} 字符`);

      // Step 3: 验证 + 写入
      const parsed = parseAndValidate(cleaned);
      const targetPath = path.join(WIKI_ROOT, parsed.wikiPath);

      fs.mkdirSync(path.dirname(targetPath), { recursive: true });
      fs.writeFileSync(targetPath, parsed.fixedContent, 'utf-8');

      result.status = 'success';
      result.wikiPath = parsed.wikiPath;
      result.title = parsed.frontMatter.title as string;

      console.log(`        ✓ 写入: ${parsed.wikiPath}`);
      console.log(`          标题: ${result.title}`);
    } catch (err) {
      if (err instanceof StopCleaningError) {
        result.status = 'failed';
        result.error = err.message;
        console.log(`        ■ 停止: ${result.error}`);
        results.push(result);
        break;
      }
      result.status = 'failed';
      result.error = err instanceof Error ? err.message : String(err);
      console.log(`        ✗ 失败: ${result.error}`);
    }

    results.push(result);

    // 避免请求过快
    if (i < SEED_URLS.length - 1) {
      await new Promise((r) => setTimeout(r, 2000));
    }
  }

  // ── 生成 index.md ──────────────────────────────────────────────
  if (!DRY_RUN) {
    console.log(`\n生成 index.md ...`);
    const indexContent = rebuildIndex(WIKI_ROOT);
    fs.writeFileSync(path.join(WIKI_ROOT, 'index.md'), indexContent, 'utf-8');
    console.log(`✓ index.md 已生成`);
  }

  // ── 清理临时目录 ────────────────────────────────────────────────
  try {
    fs.rmSync(TEMP_DIR, { recursive: true, force: true });
  } catch { /* ignore */ }

  // ── 结果汇总 ────────────────────────────────────────────────────
  console.log(`\n${'─'.repeat(60)}`);
  console.log(`  清洗结果汇总`);
  console.log(`${'─'.repeat(60)}`);

  const success = results.filter((r) => r.status === 'success');
  const failed = results.filter((r) => r.status === 'failed');

  console.log(`  成功: ${success.length} / ${results.length}`);
  console.log(`  失败: ${failed.length} / ${results.length}`);

  if (success.length > 0) {
    console.log(`\n  成功写入的文件:`);
    for (const r of success) {
      console.log(`    - ${r.wikiPath}  (${r.title})`);
    }
  }

  if (failed.length > 0) {
    console.log(`\n  失败详情:`);
    for (const r of failed) {
      console.log(`    - ${r.url}: ${r.error}`);
    }
  }

  console.log(`\n${'═'.repeat(60)}\n`);
}

main().catch((err) => {
  console.error('脚本异常:', err);
  process.exit(1);
});
