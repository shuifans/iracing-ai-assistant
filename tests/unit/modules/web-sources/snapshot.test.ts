import { afterEach, describe, expect, it } from 'vitest';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { WebKnowledgeSource } from '@/db/schema/web-sources';
import { toWebSourceRule, writeWebSourcesSnapshot } from '@/modules/web-sources/snapshot';

const dirs: string[] = [];

function source(overrides: Partial<WebKnowledgeSource>): WebKnowledgeSource {
  return {
    id: 'source',
    name: 'Source',
    scopeType: 'domain',
    url: 'https://example.com',
    sourceLevel: 'official',
    enabled: true,
    description: null,
    createdBy: 'admin',
    updatedBy: 'admin',
    createdAt: '2026-07-15T00:00:00.000Z',
    updatedAt: '2026-07-15T00:00:00.000Z',
    ...overrides,
  };
}

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('web source snapshot', () => {
  it('maps persisted sources into runtime matching rules', () => {
    expect(
      toWebSourceRule(
        source({ id: 'reddit', scopeType: 'path', url: 'https://reddit.com/r/iRacing' }),
      ),
    ).toEqual({
      id: 'reddit',
      name: 'Source',
      scopeType: 'path',
      url: 'https://reddit.com/r/iRacing',
      hostname: 'reddit.com',
      pathPrefix: '/r/iRacing',
      sourceLevel: 'official',
    });
  });

  it('writes a deterministic sorted markdown snapshot and creates parent directories', () => {
    const dir = mkdtempSync(join(tmpdir(), 'web-snapshot-'));
    dirs.push(dir);
    const snapshotPath = join(dir, 'nested', 'knowledge-sources.md');

    writeWebSourcesSnapshot(
      [
        source({
          id: 'z',
          name: 'Reddit | Community',
          scopeType: 'path',
          url: 'https://reddit.com/r/iRacing',
          sourceLevel: 'community',
          enabled: false,
          description: 'Drivers | discussion',
        }),
        source({
          id: 'a',
          name: 'iRacing',
          url: 'https://iracing.com',
          sourceLevel: 'official',
          description: null,
        }),
      ],
      snapshotPath,
    );

    expect(existsSync(snapshotPath)).toBe(true);
    expect(readFileSync(snapshotPath, 'utf8')).toBe(
      '# iRacing AI 助手 Web 知识源\n\n' +
        '> 此文件由知识源管理后台从数据库生成，请勿手工编辑。\n\n' +
        '| 状态 | 级别 | 名称 | 范围 | URL | 说明 |\n' +
        '|---|---|---|---|---|---|\n' +
        '| 禁用 | community | Reddit \\| Community | path | https://reddit.com/r/iRacing | Drivers \\| discussion |\n' +
        '| 启用 | official | iRacing | domain | https://iracing.com |  |\n',
    );
  });
});
