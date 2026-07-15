import { asc, eq } from 'drizzle-orm';
import { getDb } from '@/db/client';
import { webKnowledgeSources, type WebKnowledgeSource } from '@/db/schema/web-sources';
import { generateId } from '@/lib/uuid';
import { utcNow } from '@/lib/datetime';
import type { WebSourceInput, WebSourceUpdate } from './types';

export function listWebSources(): WebKnowledgeSource[] {
  return getDb()
    .select()
    .from(webKnowledgeSources)
    .orderBy(
      asc(webKnowledgeSources.sourceLevel),
      asc(webKnowledgeSources.name),
      asc(webKnowledgeSources.url),
    )
    .all();
}

export function listEnabledWebSources(): WebKnowledgeSource[] {
  return getDb()
    .select()
    .from(webKnowledgeSources)
    .where(eq(webKnowledgeSources.enabled, true))
    .orderBy(
      asc(webKnowledgeSources.sourceLevel),
      asc(webKnowledgeSources.name),
      asc(webKnowledgeSources.url),
    )
    .all();
}

export function getWebSource(id: string): WebKnowledgeSource | null {
  return (
    getDb().select().from(webKnowledgeSources).where(eq(webKnowledgeSources.id, id)).get() ?? null
  );
}

export function createWebSource(input: WebSourceInput, actorId: string): WebKnowledgeSource {
  const now = utcNow();
  return getDb()
    .insert(webKnowledgeSources)
    .values({
      id: generateId(),
      ...input,
      description: input.description ?? null,
      createdBy: actorId,
      updatedBy: actorId,
      createdAt: now,
      updatedAt: now,
    })
    .returning()
    .get();
}

export function updateWebSource(
  id: string,
  changes: WebSourceUpdate,
  actorId: string,
): WebKnowledgeSource | null {
  return (
    getDb()
      .update(webKnowledgeSources)
      .set({ ...changes, updatedBy: actorId, updatedAt: utcNow() })
      .where(eq(webKnowledgeSources.id, id))
      .returning()
      .get() ?? null
  );
}

export function deleteWebSource(id: string): WebKnowledgeSource | null {
  return (
    getDb()
      .delete(webKnowledgeSources)
      .where(eq(webKnowledgeSources.id, id))
      .returning()
      .get() ?? null
  );
}
