/**
 * Build the local BM25 search index over the md-wiki.
 * Produces data/search-index.json (loaded at chat runtime for instant retrieval).
 *
 * Usage: npx tsx scripts/build-search-index.ts   (or npm run build:search-index)
 */
import { resolve } from 'node:path';
import { existsSync, readFileSync } from 'node:fs';

// Manual .env load (project has no dotenv) — reuse pattern from test-model.ts
const envPath = resolve(__dirname, '..', '.env');
if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, 'utf-8').split('\n')) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const eq = t.indexOf('=');
    if (eq === -1) continue;
    const k = t.slice(0, eq).trim();
    const v = t.slice(eq + 1).trim().replace(/^["']|["']$/g, '');
    if (!process.env[k]) process.env[k] = v;
  }
}

async function main() {
  const { rebuildAndPersist, searchWiki, topSearchScore } = await import('@/modules/knowledge/search-index');
  const wikiRoot = process.env.WIKI_ROOT ?? resolve(process.cwd(), 'data/md-wiki');
  console.log(`[build-search-index] wiki root: ${wikiRoot}`);
  const { files, chunks } = rebuildAndPersist(wikiRoot);
  console.log(`[build-search-index] ✓ indexed ${files} files, ${chunks} chunks → data/search-index.json`);

  // Smoke test a query
  const q = process.argv[2] ?? 'iRating 如何计算';
  const hits = searchWiki(q, 3);
  console.log(`[build-search-index] smoke "${q}": top score=${topSearchScore(q).toFixed(2)}, ${hits.length} hits`);
  for (const h of hits) console.log(`  - ${h.score.toFixed(2)}  ${h.wikiPath}  ::  ${h.title}`);
}

main().catch((err) => {
  console.error('[build-search-index] ✗', err);
  process.exit(1);
});
