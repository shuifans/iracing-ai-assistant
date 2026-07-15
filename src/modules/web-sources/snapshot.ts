import { mkdirSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { WebKnowledgeSource } from '@/db/schema/web-sources';
import type { WebSourceRule } from './types';

export function toWebSourceRule(source: WebKnowledgeSource): WebSourceRule {
  const parsed = new URL(source.url);
  return {
    id: source.id,
    name: source.name,
    scopeType: source.scopeType,
    url: source.url,
    hostname: parsed.hostname,
    ...(source.scopeType === 'path' ? { pathPrefix: parsed.pathname } : {}),
    sourceLevel: source.sourceLevel,
  };
}

function escapeCell(value: string): string {
  return value.replace(/\|/g, '\\|').replace(/[\r\n]+/g, ' ');
}

function compareText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

export function writeWebSourcesSnapshot(
  sources: WebKnowledgeSource[],
  snapshotPath: string,
): void {
  const sorted = [...sources].sort(
    (a, b) =>
      compareText(a.sourceLevel, b.sourceLevel) ||
      compareText(a.name, b.name) ||
      compareText(a.url, b.url),
  );
  const header = [
    '# iRacing AI 助手 Web 知识源',
    '',
    '> 此文件由知识源管理后台从数据库生成，请勿手工编辑。',
    '',
    '| 状态 | 级别 | 名称 | 范围 | URL | 说明 |',
    '|---|---|---|---|---|---|',
  ];
  const rows = sorted.map(
    (source) =>
      `| ${source.enabled ? '启用' : '禁用'} | ${source.sourceLevel} | ${escapeCell(source.name)} | ${source.scopeType} | ${escapeCell(source.url)} | ${escapeCell(source.description ?? '')} |`,
  );
  const contents = [...header, ...rows].join('\n') + '\n';
  const parent = dirname(snapshotPath);
  mkdirSync(parent, { recursive: true });
  const temporaryPath = `${snapshotPath}.${process.pid}.${randomUUID()}.tmp`;
  try {
    writeFileSync(temporaryPath, contents, 'utf8');
    renameSync(temporaryPath, snapshotPath);
  } catch (error) {
    try {
      unlinkSync(temporaryPath);
    } catch {}
    throw error;
  }
}
