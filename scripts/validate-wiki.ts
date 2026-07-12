// 用项目内置的 front-matter 验证器检查所有 wiki 文件
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { parseFrontMatter } from '../src/modules/knowledge/front-matter';

const wikiRoot = './data/md-wiki';

interface FileResult {
  path: string;
  valid: boolean;
  title?: string;
  category?: string;
  subcategory?: string;
  tags?: string[];
  bodyLines: number;
  error?: string;
}

function walk(dir: string): string[] {
  const results: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) results.push(...walk(full));
    else if (entry.endsWith('.md') && entry !== 'index.md') results.push(full);
  }
  return results;
}

const files = walk(wikiRoot);
const results: FileResult[] = [];

for (const f of files) {
  const rel = f.replace(/\\/g, '/').replace('data/md-wiki/', '');
  const content = readFileSync(f, 'utf-8');
  try {
    const { frontMatter, body } = parseFrontMatter(content);
    results.push({
      path: rel,
      valid: true,
      title: frontMatter.title,
      category: frontMatter.category,
      subcategory: frontMatter.subcategory,
      tags: frontMatter.tags,
      bodyLines: body.split('\n').length,
    });
  } catch (e: any) {
    results.push({
      path: rel,
      valid: false,
      bodyLines: 0,
      error: e.message,
    });
  }
}

console.log('\n=== Wiki 文件质量报告 ===\n');
console.log(`总文件数: ${results.length}`);
console.log(`通过验证: ${results.filter(r => r.valid).length}`);
console.log(`验证失败: ${results.filter(r => !r.valid).length}\n`);

for (const r of results) {
  const icon = r.valid ? '✓' : '✗';
  console.log(`${icon}  ${r.path}`);
  if (r.valid) {
    console.log(`    标题: ${r.title}`);
    console.log(`    分类: ${r.category}/${r.subcategory}`);
    console.log(`    标签: [${r.tags?.join(', ')}]`);
    console.log(`    正文: ${r.bodyLines} 行`);
  } else {
    console.log(`    错误: ${r.error}`);
  }
  console.log();
}
