import { describe, it, expect } from 'vitest';
import {
  CHAT_SYSTEM_PROMPT,
  WIKI_SEARCH_PROMPT,
  WEB_RESEARCH_PROMPT,
  KNOWLEDGE_CLEANER_PROMPT,
} from '@/modules/agent/prompts';

describe('CHAT_SYSTEM_PROMPT', () => {
  it('mentions iRacing', () => {
    expect(CHAT_SYSTEM_PROMPT).toContain('iRacing');
  });

  it('mentions @Lucifinil (expert escalation — SPEC 10.6 rule 8)', () => {
    expect(CHAT_SYSTEM_PROMPT).toContain('@Lucifinil');
  });

  it('enforces scope lock — SPEC 10.6 rule 1', () => {
    expect(CHAT_SYSTEM_PROMPT).toMatch(/only iRacing|ONLY iRacing/i);
  });

  it('requires evidence citation — SPEC 10.6 rule 4', () => {
    expect(CHAT_SYSTEM_PROMPT).toMatch(/cite|source|evidence/i);
  });

  it('includes prompt injection resistance — SPEC 10.6 rule 7', () => {
    expect(CHAT_SYSTEM_PROMPT).toMatch(/injection|override|ignore/i);
  });

  it('has a HISTORY_CONTEXT placeholder for trimmed history', () => {
    expect(CHAT_SYSTEM_PROMPT).toContain('{{HISTORY_CONTEXT}}');
  });
});

describe('WIKI_SEARCH_PROMPT', () => {
  it('mentions evidence', () => {
    expect(WIKI_SEARCH_PROMPT).toContain('evidence');
  });

  it('instructs returning a JSON array', () => {
    expect(WIKI_SEARCH_PROMPT).toContain('JSON array');
  });

  it('restricts to Read / Glob / Grep', () => {
    expect(WIKI_SEARCH_PROMPT).toContain('Read');
    expect(WIKI_SEARCH_PROMPT).toContain('Glob');
    expect(WIKI_SEARCH_PROMPT).toContain('Grep');
  });
});

describe('WEB_RESEARCH_PROMPT', () => {
  const ALLOWLISTED_DOMAINS = [
    'support.iracing.com',
    'iracing.com',
    'forums.iracing.com',
    'reddit.com/r/iRacing',
    'hipole.com',
    'coachdaveacademy.com',
    'newsroom.porsche.com',
  ];

  it.each(ALLOWLISTED_DOMAINS)(
    'includes allowlisted domain: %s',
    (domain) => {
      expect(WEB_RESEARCH_PROMPT).toContain(domain);
    },
  );

  it('mentions evidence', () => {
    expect(WEB_RESEARCH_PROMPT).toContain('evidence');
  });

  it('forbids calling sub-agents', () => {
    expect(WEB_RESEARCH_PROMPT).toMatch(/not call any sub-agent|Do NOT call/i);
  });
});

describe('KNOWLEDGE_CLEANER_PROMPT', () => {
  it('mentions Markdown output', () => {
    expect(KNOWLEDGE_CLEANER_PROMPT).toContain('Markdown');
  });

  it('sets max turns guidance', () => {
    expect(KNOWLEDGE_CLEANER_PROMPT).toContain('8 turns');
  });

  it('preserves factual accuracy constraint', () => {
    expect(KNOWLEDGE_CLEANER_PROMPT).toMatch(/factual accuracy|do not paraphrase/i);
  });
});
