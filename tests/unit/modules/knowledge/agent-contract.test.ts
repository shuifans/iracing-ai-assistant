import { describe, expect, it, vi } from 'vitest';

vi.mock('fs', () => ({
  mkdirSync: vi.fn(),
  writeFileSync: vi.fn(),
}));

import * as fs from 'fs';
import {
  KNOWLEDGE_AGENT_CONTRACT,
  writeKnowledgeAgentContract,
} from '@/modules/knowledge/agent-contract';

describe('knowledge agent contract', () => {
  it('defines index-first, read-only, evidence-grounded retrieval', () => {
    expect(KNOWLEDGE_AGENT_CONTRACT).toContain('始终先读 `index.md`');
    expect(KNOWLEDGE_AGENT_CONTRACT).toContain('只读');
    expect(KNOWLEDGE_AGENT_CONTRACT).toContain('Grep/Glob');
    expect(KNOWLEDGE_AGENT_CONTRACT).toContain('`Details`');
    expect(KNOWLEDGE_AGENT_CONTRACT).toContain('原始来源');
    expect(KNOWLEDGE_AGENT_CONTRACT).toContain('过期');
    expect(KNOWLEDGE_AGENT_CONTRACT).toContain('内容冲突');
    expect(KNOWLEDGE_AGENT_CONTRACT).toContain('证据不足');
  });

  it('writes the fixed contract to the wiki root', () => {
    writeKnowledgeAgentContract('/wiki');
    expect(fs.writeFileSync).toHaveBeenCalledWith(
      '/wiki/KNOWLEDGE.md',
      KNOWLEDGE_AGENT_CONTRACT,
      'utf-8',
    );
  });
});
