import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const script = readFileSync(resolve(process.cwd(), 'scripts/eval-chat.ts'), 'utf8');
const cases = readFileSync(resolve(process.cwd(), 'scripts/eval-cases.json'), 'utf8');

describe('Qoder chat evaluation contract', () => {
  it('asserts direct local and Web tool events without legacy sub-agent names', () => {
    for (const tool of ['Read', 'Glob', 'Grep']) expect(cases).toContain(`"${tool}"`);
    expect(cases).toMatch(/"expectedTools": \["(?:WebSearch|WebFetch)"/);
    const legacyAgentNames = ['wiki', 'web'].map(
      (prefix) => `${prefix}-${prefix === 'wiki' ? 'search' : 'research'}`,
    );
    for (const name of legacyAgentNames) expect(cases).not.toContain(name);
    expect(script).not.toMatch(/isSubAgent|agentName|subAgents/);
  });

  it('enables session Web search only for Web evaluation cases', () => {
    expect(script).toContain("category === 'A2'");
    expect(script).toContain('webSearchEnabled');
    expect(script).toContain('/api/chat/sessions/${sid}');
    expect(script).toContain("method: 'PATCH'");
  });

  it('records tool names but not tool inputs', () => {
    expect(script).toContain('m.toolCalls.push(data.name)');
    expect(script).not.toMatch(/toolInput|tool_input|inputJson|JSON\.stringify\(data\.input/);
  });
});
