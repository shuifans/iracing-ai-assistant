import { join } from 'node:path';
import { getDb } from '@/db/client';
import { AppError } from '@/lib/errors';
import { recordAudit } from '@/modules/audit/service';
import type { AuditAction } from '@/modules/audit/types';
import * as repository from './repository';
import { normalizeWebSourceUrl } from './schemas';
import { toWebSourceRule, writeWebSourcesSnapshot } from './snapshot';
import type {
  WebKnowledgeSource,
  WebSourceInput,
  WebSourceRule,
  WebSourceUpdate,
} from './types';

function snapshotPath(): string {
  return (
    process.env.WEB_KNOWLEDGE_SOURCES_SNAPSHOT_PATH ??
    join(process.cwd(), 'notes/knowledge-sources.md')
  );
}

function refreshSnapshot(): void {
  writeWebSourcesSnapshot(repository.listWebSources(), snapshotPath());
}

function duplicateError(error: unknown): never {
  if (error instanceof Error && /UNIQUE constraint failed/.test(error.message)) {
    throw new AppError('DUPLICATE_SOURCE', '相同范围的知识源 URL 已存在');
  }
  throw error;
}

export function listWebSources(): WebKnowledgeSource[] {
  return repository.listWebSources();
}

export function listEnabledWebSourceRules(): WebSourceRule[] {
  return repository.listEnabledWebSources().map(toWebSourceRule);
}

export function createWebSource(input: WebSourceInput, actorId: string): WebKnowledgeSource {
  let source: WebKnowledgeSource;
  try {
    source = getDb().transaction(() => {
      const created = repository.createWebSource(input, actorId);
      recordAudit({
        actorId,
        action: 'web_source.created',
        resource: 'web_knowledge_source',
        resourceId: created.id,
        changes: input,
      });
      return created;
    });
  } catch (error) {
    duplicateError(error);
  }
  refreshSnapshot();
  return source;
}

export function updateWebSource(
  id: string,
  changes: WebSourceUpdate,
  actorId: string,
): WebKnowledgeSource {
  let updated: WebKnowledgeSource;
  try {
    updated = getDb().transaction(() => {
      const current = repository.getWebSource(id);
      if (!current) throw new AppError('NOT_FOUND', `Web 知识源 ${id} 不存在`);
      const normalizedChanges = { ...changes };
      if (changes.url !== undefined || changes.scopeType !== undefined) {
        const scopeType = changes.scopeType ?? current.scopeType;
        normalizedChanges.url = normalizeWebSourceUrl(scopeType, changes.url ?? current.url);
      }
      const result = repository.updateWebSource(id, normalizedChanges, actorId);
      if (!result) throw new AppError('NOT_FOUND', `Web 知识源 ${id} 不存在`);
      const action: AuditAction =
        changes.enabled !== undefined && changes.enabled !== current.enabled
          ? changes.enabled
            ? 'web_source.enabled'
            : 'web_source.disabled'
          : 'web_source.updated';
      recordAudit({
        actorId,
        action,
        resource: 'web_knowledge_source',
        resourceId: id,
        changes: normalizedChanges,
      });
      return result;
    });
  } catch (error) {
    duplicateError(error);
  }
  refreshSnapshot();
  return updated;
}

export function deleteWebSource(id: string, actorId: string): void {
  getDb().transaction(() => {
    const deleted = repository.deleteWebSource(id);
    if (!deleted) throw new AppError('NOT_FOUND', `Web 知识源 ${id} 不存在`);
    recordAudit({
      actorId,
      action: 'web_source.deleted',
      resource: 'web_knowledge_source',
      resourceId: id,
      changes: { deleted },
    });
  });
  refreshSnapshot();
}
