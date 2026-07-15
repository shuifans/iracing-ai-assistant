import { accessSync, constants } from 'node:fs';
import { join } from 'node:path';
import {
  createWebSource,
  deleteWebSource,
  listEnabledWebSourceRules,
  listWebSources,
} from '@/modules/web-sources/service';
import { updateSessionWebSearch } from '@/modules/chat/repository';
import type { WebSourceRule } from '@/modules/web-sources/types';

export const EVAL_OFFICIAL_WEB_SOURCE = {
  name: 'iRacing Support (eval)',
  scopeType: 'domain' as const,
  url: 'https://support.iracing.com/',
  sourceLevel: 'official' as const,
  enabled: true,
  description: 'Isolated chat evaluation fixture for official iRacing support content.',
};

export interface EvalWebKnowledgeFixture {
  rules: WebSourceRule[];
  snapshotPath: string;
}

export function ensureEvalWebKnowledgeFixture(actorId: string): EvalWebKnowledgeFixture {
  for (const source of listWebSources()) deleteWebSource(source.id, actorId);
  createWebSource(EVAL_OFFICIAL_WEB_SOURCE, actorId);

  const rules = listEnabledWebSourceRules();
  if (
    rules.length !== 1 ||
    rules[0]?.hostname !== 'support.iracing.com' ||
    rules[0]?.scopeType !== 'domain'
  ) {
    throw new Error(
      'eval Web source fixture must contain only the official iRacing support domain',
    );
  }

  const snapshotPath =
    process.env.WEB_KNOWLEDGE_SOURCES_SNAPSHOT_PATH ??
    join(process.cwd(), 'notes', 'knowledge-sources.md');
  accessSync(snapshotPath, constants.R_OK);
  return { rules, snapshotPath };
}

export function setEvalSessionWebState(
  sessionId: string,
  userId: string,
  category: string,
): boolean {
  const enabled = category === 'A2';
  const session = updateSessionWebSearch(sessionId, userId, enabled);
  if (!session) throw new Error('eval session is missing or not owned by the eval user');
  return session.webSearchEnabled;
}
