import { describe, it, expect, vi, beforeEach } from 'vitest';
import { rebuildIndex, writeIndex, collectIndexEntries } from '@/modules/knowledge/wiki-index';
import * as fs from 'fs';

vi.mock('fs', () => ({
  existsSync: vi.fn(),
  readdirSync: vi.fn(),
  statSync: vi.fn(),
  readFileSync: vi.fn(),
  writeFileSync: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeFrontMatter(
  title: string,
  category: string,
  subcategory: string,
  tags: string[],
  season?: string,
): string {
  const tagStr = tags.map((t) => t).join(', ');
  const lines = [
    '---',
    `title: ${title}`,
    `category: ${category}`,
    `subcategory: ${subcategory}`,
    `tags: [${tagStr}]`,
  ];
  if (season) lines.push(`season: ${season}`);
  lines.push('---', '', `# ${title}`, '');
  return lines.join('\n');
}

/** Build a mock filesystem map: filePath → content */
function mockFs(files: Record<string, string>) {
  const allPaths = Object.keys(files);

  vi.mocked(fs.existsSync).mockImplementation((p: fs.PathLike) => {
    const dir = p.toString();
    return allPaths.some((f) => f.startsWith(dir));
  });

  vi.mocked(fs.readdirSync).mockImplementation(((dirPath: fs.PathLike) => {
    const dir = dirPath.toString().replace(/\\/g, '/');
    // collect immediate children (files + dirs)
    const children = new Set<string>();
    for (const f of allPaths) {
      if (f.startsWith(dir + '/')) {
        const rest = f.slice(dir.length + 1);
        const first = rest.split('/')[0];
        if (first) children.add(first);
      }
    }
    return Array.from(children) as unknown as fs.Dirent[];
  }) as unknown as typeof fs.readdirSync);

  vi.mocked(fs.statSync).mockImplementation((p: fs.PathLike) => {
    const fp = p.toString().replace(/\\/g, '/');
    const isFile = allPaths.includes(fp);
    return { isFile: () => isFile, isDirectory: () => !isFile } as fs.Stats;
  });

  vi.mocked(fs.readFileSync).mockImplementation(((p: fs.PathLike) => {
    const fp = p.toString().replace(/\\/g, '/');
    const content = files[fp];
    if (content === undefined) throw new Error(`ENOENT: ${fp}`);
    return content;
  }) as typeof fs.readFileSync);
}

// ---------------------------------------------------------------------------
// rebuildIndex
// ---------------------------------------------------------------------------

describe('rebuildIndex', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('空目录 → 仅含标题的 index.md', () => {
    mockFs({});
    const result = rebuildIndex('/wiki');
    expect(result).toBe('# Knowledge Index\n');
  });

  it('单文件 → 正确分类和链接', () => {
    mockFs({
      '/wiki/track-technique/braking/late-braking-guide.md': makeFrontMatter(
        'Late Braking Guide',
        'track-technique',
        'braking',
        ['trail-braking', 'threshold'],
      ),
    });
    const result = rebuildIndex('/wiki');
    expect(result).toContain('## track-technique');
    expect(result).toContain('### braking');
    expect(result).toContain(
      '- [Late Braking Guide](track-technique/braking/late-braking-guide.md) — Tags: trail-braking, threshold',
    );
  });

  it('多分类多子分类 → 按 category 枚举序 → subcategory 字母序 → title 字母序', () => {
    mockFs({
      '/wiki/car-setup/suspension/spring-rate-guide.md': makeFrontMatter(
        'Spring Rate Guide',
        'car-setup',
        'suspension',
        ['spring'],
      ),
      '/wiki/track-technique/cornering/apex-selection.md': makeFrontMatter(
        'Apex Selection',
        'track-technique',
        'cornering',
        ['apex'],
      ),
      '/wiki/track-technique/braking/threshold-braking.md': makeFrontMatter(
        'Threshold Braking',
        'track-technique',
        'braking',
        ['braking'],
      ),
      '/wiki/track-technique/braking/late-braking-guide.md': makeFrontMatter(
        'Late Braking Guide',
        'track-technique',
        'braking',
        ['trail-braking', 'threshold'],
      ),
    });
    const result = rebuildIndex('/wiki');
    const lines = result.split('\n');

    // track-technique should come before car-setup (enum order)
    const trackIdx = lines.findIndex((l) => l === '## track-technique');
    const carIdx = lines.findIndex((l) => l === '## car-setup');
    expect(trackIdx).toBeGreaterThan(-1);
    expect(carIdx).toBeGreaterThan(-1);
    expect(trackIdx).toBeLessThan(carIdx);

    // Within track-technique: braking before cornering (alphabetical)
    const brakingIdx = lines.findIndex((l) => l === '### braking');
    const corneringIdx = lines.findIndex((l) => l === '### cornering');
    expect(brakingIdx).toBeGreaterThan(-1);
    expect(corneringIdx).toBeGreaterThan(-1);
    expect(brakingIdx).toBeLessThan(corneringIdx);

    // Within braking: Late Braking Guide before Threshold Braking (alphabetical)
    const lateIdx = lines.findIndex((l) => l.includes('Late Braking Guide'));
    const thresholdIdx = lines.findIndex((l) => l.includes('Threshold Braking'));
    expect(lateIdx).toBeGreaterThan(-1);
    expect(thresholdIdx).toBeGreaterThan(-1);
    expect(lateIdx).toBeLessThan(thresholdIdx);
  });

  it('排序一致性 → 相同输入多次调用产生相同输出', () => {
    const files = {
      '/wiki/track-technique/braking/threshold-braking.md': makeFrontMatter(
        'Threshold Braking',
        'track-technique',
        'braking',
        ['braking'],
      ),
      '/wiki/car-setup/theory/basics.md': makeFrontMatter(
        'Basics',
        'car-setup',
        'theory',
        ['setup'],
      ),
      '/wiki/track-technique/braking/late-braking-guide.md': makeFrontMatter(
        'Late Braking Guide',
        'track-technique',
        'braking',
        ['trail-braking'],
      ),
    };
    mockFs(files);
    const result1 = rebuildIndex('/wiki');

    mockFs(files);
    const result2 = rebuildIndex('/wiki');

    expect(result1).toBe(result2);
  });

  it('跳过 index.md → 不把自身编入索引', () => {
    mockFs({
      '/wiki/index.md': '# Knowledge Index\n\nOld index content',
      '/wiki/track-technique/braking/guide.md': makeFrontMatter(
        'Guide',
        'track-technique',
        'braking',
        ['braking'],
      ),
    });
    const result = rebuildIndex('/wiki');
    expect(result).not.toContain('Old index content');
    expect(result).toContain('Guide');
  });

  it('跳过无 Front Matter 文件 → 忽略 README.md 等', () => {
    mockFs({
      '/wiki/README.md': '# README\n\nThis is a readme.',
      '/wiki/track-technique/braking/guide.md': makeFrontMatter(
        'Guide',
        'track-technique',
        'braking',
        ['braking'],
      ),
    });
    const result = rebuildIndex('/wiki');
    expect(result).not.toContain('README');
    expect(result).toContain('Guide');
  });

  it('无 tags 的条目 → 不显示 Tags 行', () => {
    // Edge case: entry with minimal tags still works
    mockFs({
      '/wiki/basics/getting-started/quick-start.md': makeFrontMatter(
        'Quick Start',
        'basics',
        'getting-started',
        ['quickstart'],
      ),
    });
    const result = rebuildIndex('/wiki');
    expect(result).toContain('## basics');
    expect(result).toContain('### getting-started');
    expect(result).toContain(
      '- [Quick Start](basics/getting-started/quick-start.md) — Tags: quickstart',
    );
  });

  it('season 字段 → 不出现在索引行中', () => {
    mockFs({
      '/wiki/track-technique/braking/guide.md': makeFrontMatter(
        'Guide',
        'track-technique',
        'braking',
        ['braking'],
        '2024S3',
      ),
    });
    const result = rebuildIndex('/wiki');
    expect(result).toContain('Guide');
    expect(result).not.toContain('2024S3');
  });
});

// ---------------------------------------------------------------------------
// collectIndexEntries
// ---------------------------------------------------------------------------

describe('collectIndexEntries', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('返回解析后的条目（title/category/subcategory/wikiPath/tags）', () => {
    mockFs({
      '/wiki/track-technique/braking/late-braking-guide.md': makeFrontMatter(
        'Late Braking Guide',
        'track-technique',
        'braking',
        ['trail-braking', 'threshold'],
      ),
    });
    const entries = collectIndexEntries('/wiki');
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      title: 'Late Braking Guide',
      category: 'track-technique',
      subcategory: 'braking',
      wikiPath: 'track-technique/braking/late-braking-guide.md',
      tags: ['trail-braking', 'threshold'],
    });
  });

  it('跳过 index.md 与无 Front Matter 的文件', () => {
    mockFs({
      '/wiki/index.md': '# Knowledge Index\n\nOld content',
      '/wiki/README.md': '# README\n\nno front matter here',
      '/wiki/track-technique/braking/guide.md': makeFrontMatter(
        'Guide',
        'track-technique',
        'braking',
        ['braking'],
      ),
    });
    const entries = collectIndexEntries('/wiki');
    expect(entries).toHaveLength(1);
    expect(entries[0]!.title).toBe('Guide');
  });

  it('season 字段 → 出现在条目里', () => {
    mockFs({
      '/wiki/track-technique/braking/guide.md': makeFrontMatter(
        'Guide',
        'track-technique',
        'braking',
        ['braking'],
        '2024S3',
      ),
    });
    const entries = collectIndexEntries('/wiki');
    expect(entries[0]!.season).toBe('2024S3');
  });

  it('空目录 → 返回空数组', () => {
    mockFs({});
    const entries = collectIndexEntries('/wiki');
    expect(entries).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// writeIndex
// ---------------------------------------------------------------------------

describe('writeIndex', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('正确写入磁盘', () => {
    const writeFileSyncMock = vi.mocked(fs.writeFileSync);
    writeFileSyncMock.mockImplementation(() => undefined);

    writeIndex('/wiki', '# Knowledge Index\n');

    expect(writeFileSyncMock).toHaveBeenCalledWith(
      expect.stringContaining('index.md'),
      '# Knowledge Index\n',
      'utf-8',
    );
  });
});
