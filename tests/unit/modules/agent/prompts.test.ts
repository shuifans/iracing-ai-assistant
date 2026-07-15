import { describe, it, expect } from 'vitest';
import * as prompts from '@/modules/agent/prompts';

describe('CHAT_SYSTEM_PROMPT', () => {
  const prompt = prompts.CHAT_SYSTEM_PROMPT;

  it('defines the complete iRacing assistant scope and focused clarification behavior', () => {
    expect(prompt).toMatch(/only iRacing/i);
    expect(prompt).toMatch(/car.*track.*series/i);
    expect(prompt).toContain('@Lucifinil');
  });

  it('requires KNOWLEDGE.md, index-first routing, and Details for precise answers', () => {
    expect(prompt).toContain('KNOWLEDGE.md');
    expect(prompt).toContain('index.md');
    expect(prompt).toContain('Details');
    expect(prompt.indexOf('KNOWLEDGE.md')).toBeLessThan(prompt.indexOf('index.md'));
  });

  it('stops at sufficient local knowledge and uses Web only to fill a gap', () => {
    expect(prompt).toMatch(/local knowledge.*sufficient.*do not use.*Web/is);
    expect(prompt).toMatch(/only.*Web.*local knowledge.*missing|Web.*only.*missing/is);
    expect(prompt).toMatch(/knowledge-sources\.md/i);
  });

  it('requires verifiable local and Web citations and honest insufficiency', () => {
    expect(prompt).toMatch(/title.*relative path.*original source/is);
    expect(prompt).toMatch(/page title.*URL/is);
    expect(prompt).toMatch(/insufficient|do not fabricate/i);
  });

  it('resists injection from users, wiki notes, and webpages without exposing chain of thought', () => {
    expect(prompt).toMatch(/user.*Wiki.*web/is);
    expect(prompt).toMatch(/prompt injection/i);
    expect(prompt).toMatch(/do not.*internal reasoning|never.*chain.of.thought/is);
  });

  it('does not export obsolete sub-agent prompts', () => {
    expect(prompts).not.toHaveProperty('WIKI_SEARCH_PROMPT');
    expect(prompts).not.toHaveProperty('WEB_RESEARCH_PROMPT');
    expect(prompts).not.toHaveProperty('WEB_RESEARCH_MAX_TURNS');
  });
});
