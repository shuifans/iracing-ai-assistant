import * as fs from 'fs';
import * as path from 'path';
import { getRawDb } from '@/db/client';
import { writeKnowledgeAgentContract } from './agent-contract';

export interface ResetKnowledgeOptions {
  dataRoot: string;
  confirm: boolean;
}

const RESET_SQL = [
  'UPDATE knowledge_jobs SET parent_draft_id = NULL',
  'UPDATE evaluation_feedback SET applied_to_job_id = NULL',
  'DELETE FROM evaluation_dimensions',
  'DELETE FROM evaluation_feedback',
  'DELETE FROM knowledge_evaluations',
  'DELETE FROM knowledge_items',
  'DELETE FROM knowledge_drafts',
  'DELETE FROM knowledge_jobs',
  'DELETE FROM knowledge_sources',
  'DELETE FROM retrieval_cache',
  "DELETE FROM system_settings WHERE key = 'knowledge.cleaning_backend'",
] as const;

const EMPTY_SEARCH_INDEX = {
  documentCount: 0,
  nextId: 0,
  documentIds: {},
  fieldIds: { text: 0, title: 1, tags: 2, heading: 3 },
  fieldLength: {},
  averageFieldLength: [],
  storedFields: {},
  dirtCount: 0,
  index: [],
  serializationVersion: 2,
};

function resolveInside(root: string, ...segments: string[]): string {
  const resolvedRoot = path.resolve(root);
  const target = path.resolve(resolvedRoot, ...segments);
  const relative = path.relative(resolvedRoot, target);
  if (
    !relative ||
    relative === '..' ||
    relative.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relative)
  ) {
    throw new Error(`Reset target must be a child of DATA_ROOT: ${target}`);
  }
  return target;
}

export function resetKnowledgeDomain(options: ResetKnowledgeOptions): void {
  if (!options.confirm) {
    throw new Error('Knowledge reset requires explicit confirmation');
  }

  const resolvedDataRoot = path.resolve(options.dataRoot);
  const dataRoot = fs.existsSync(resolvedDataRoot)
    ? fs.realpathSync(resolvedDataRoot)
    : resolvedDataRoot;
  if (dataRoot === path.parse(dataRoot).root) {
    throw new Error('DATA_ROOT must not be the filesystem root');
  }
  const targets = [
    resolveInside(dataRoot, 'uploads', 'knowledge'),
    resolveInside(dataRoot, 'extracted'),
    resolveInside(dataRoot, 'drafts'),
    resolveInside(dataRoot, 'md-wiki'),
    resolveInside(dataRoot, 'search-index.json'),
  ];

  for (const target of targets) {
    let current = dataRoot;
    for (const segment of path.relative(dataRoot, target).split(path.sep)) {
      current = path.join(current, segment);
      if (fs.existsSync(current) && fs.lstatSync(current).isSymbolicLink()) {
        throw new Error(`Reset path must not contain a symbolic link: ${current}`);
      }
    }
  }

  const db = getRawDb();
  db.transaction(() => {
    for (const statement of RESET_SQL) db.prepare(statement).run();
  })();

  for (const target of targets) {
    fs.rmSync(target, { recursive: true, force: true });
  }

  const wikiRoot = resolveInside(dataRoot, 'md-wiki');
  fs.mkdirSync(wikiRoot, { recursive: true });
  fs.writeFileSync(path.join(wikiRoot, 'index.md'), '# Knowledge Index\n', 'utf-8');
  writeKnowledgeAgentContract(wikiRoot);
  fs.writeFileSync(
    path.join(dataRoot, 'search-index.json'),
    JSON.stringify(EMPTY_SEARCH_INDEX),
    'utf-8',
  );
}

export { RESET_SQL };
