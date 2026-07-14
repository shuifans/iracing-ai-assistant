import { describe, expect, it } from 'vitest';
import { buildMessages } from '@/modules/agent/llm-client';

describe('buildMessages image input', () => {
  it('adds OpenAI-compatible image_url parts to the user message', () => {
    const messages = buildMessages({
      systemPrompt: 'system',
      evidence: [],
      history: [],
      userMessage: 'What is shown?',
      imageAttachments: [{ base64: 'cG5n', mediaType: 'image/png' }],
    });

    expect(messages.at(-1)).toEqual({
      role: 'user',
      content: [
        { type: 'text', text: 'What is shown?' },
        {
          type: 'image_url',
          image_url: { url: 'data:image/png;base64,cG5n' },
        },
      ],
    });
  });
});
