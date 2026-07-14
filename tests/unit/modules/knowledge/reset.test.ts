import { beforeEach, describe, expect, it, vi } from 'vitest';

const run = vi.fn();
const prepare = vi.fn(() => ({ run }));
const transaction = vi.fn((callback: () => void) => callback);

vi.mock('@/db/client', () => ({
  getRawDb: vi.fn(() => ({ prepare, transaction })),
}));

vi.mock('fs', () => ({
  existsSync: vi.fn(() => false),
  lstatSync: vi.fn(() => ({ isSymbolicLink: () => false })),
  rmSync: vi.fn(),
  mkdirSync: vi.fn(),
  writeFileSync: vi.fn(),
}));

import * as fs from 'fs';
import { KNOWLEDGE_AGENT_CONTRACT } from '@/modules/knowledge/agent-contract';
import { RESET_SQL, resetKnowledgeDomain } from '@/modules/knowledge/reset';

describe('resetKnowledgeDomain', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prepare.mockImplementation(() => ({ run }));
    transaction.mockImplementation((callback: () => void) => callback);
  });

  it('requires explicit confirmation', () => {
    expect(() => resetKnowledgeDomain({ dataRoot: '/data', confirm: false })).toThrow(
      'explicit confirmation',
    );
    expect(prepare).not.toHaveBeenCalled();
    expect(fs.rmSync).not.toHaveBeenCalled();
  });

  it('rejects the filesystem root as DATA_ROOT', () => {
    expect(() => resetKnowledgeDomain({ dataRoot: '/', confirm: true })).toThrow(
      'must not be the filesystem root',
    );
    expect(fs.rmSync).not.toHaveBeenCalled();
  });

  it('clears only knowledge tables in dependency order before deleting files', () => {
    resetKnowledgeDomain({ dataRoot: '/data', confirm: true });

    const statements = (prepare.mock.calls as unknown as Array<[string]>).map(([sql]) => sql);
    expect(statements).toEqual([...RESET_SQL]);
    expect(RESET_SQL.join('\n')).not.toMatch(/users|chat_sessions|messages|audit_logs/);
    expect(fs.rmSync).toHaveBeenCalledTimes(5);
    expect(fs.rmSync).toHaveBeenNthCalledWith(1, '/data/uploads/knowledge', {
      recursive: true,
      force: true,
    });
    expect(fs.rmSync).toHaveBeenCalledWith('/data/search-index.json', {
      recursive: true,
      force: true,
    });
  });

  it('does not delete files when the database transaction fails', () => {
    transaction.mockImplementation(() => () => {
      throw new Error('db failed');
    });

    expect(() => resetKnowledgeDomain({ dataRoot: '/data', confirm: true })).toThrow('db failed');
    expect(fs.rmSync).not.toHaveBeenCalled();
  });

  it('recreates an empty index and the fixed agent contract', () => {
    resetKnowledgeDomain({ dataRoot: '/data', confirm: true });

    expect(fs.writeFileSync).toHaveBeenCalledWith(
      '/data/md-wiki/index.md',
      '# Knowledge Index\n',
      'utf-8',
    );
    expect(fs.writeFileSync).toHaveBeenCalledWith(
      '/data/md-wiki/KNOWLEDGE.md',
      KNOWLEDGE_AGENT_CONTRACT,
      'utf-8',
    );
    expect(fs.writeFileSync).toHaveBeenCalledWith(
      '/data/search-index.json',
      expect.stringContaining('"documentCount":0'),
      'utf-8',
    );
  });

  it('is idempotent for already absent directories', () => {
    expect(() => resetKnowledgeDomain({ dataRoot: '/data', confirm: true })).not.toThrow();
    expect(() => resetKnowledgeDomain({ dataRoot: '/data', confirm: true })).not.toThrow();
  });
});
