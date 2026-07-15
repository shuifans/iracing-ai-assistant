import type { WebKnowledgeSource } from '@/db/schema/web-sources';

export type WebSourceScope = 'domain' | 'path' | 'exact_url';
export type WebSourceLevel = 'official' | 'community';

export interface WebSourceRule {
  id: string;
  name: string;
  scopeType: WebSourceScope;
  url: string;
  hostname: string;
  pathPrefix?: string;
  sourceLevel: WebSourceLevel;
}

export interface WebSourceInput {
  name: string;
  scopeType: WebSourceScope;
  url: string;
  sourceLevel: WebSourceLevel;
  enabled: boolean;
  description?: string | null;
}

export type WebSourceUpdate = Partial<WebSourceInput>;
export type { WebKnowledgeSource };
