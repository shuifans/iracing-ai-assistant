import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { SafeMarkdown, sanitizeMarkdownUrl } from '@/components/chat/SafeMarkdown';

afterEach(cleanup);

describe('sanitizeMarkdownUrl', () => {
  it('rejects obfuscated executable schemes', () => {
    const dangerousUrls = [
      'javascript:alert(1)',
      'JaVaScRiPt:alert(1)',
      ' java\nscript:alert(1)',
      'java\u00a0script:alert(1)',
      'java&#x73;cript:alert(1)',
      'javascript&#58;alert(1)',
      '&#106;&#97;&#118;&#97;&#115;&#99;&#114;&#105;&#112;&#116;&#58;alert(1)',
      'data:text/html,<script>alert(1)</script>',
      'vbscript:msgbox(1)',
      '//attacker.example/payload',
      '\\attacker.example\\payload',
    ];

    for (const url of dangerousUrls) {
      expect(sanitizeMarkdownUrl(url), url).toBeUndefined();
    }
  });

  it('allows HTTP(S) and intentional relative path forms', () => {
    const safeUrls = [
      'https://example.com/guide',
      'http://example.com/replay',
      '/knowledge/guide',
      './next-page',
      '../parent-page',
      'wiki/setup/brakes',
      '#brake-bias',
      '?tab=setup',
    ];

    for (const url of safeUrls) {
      expect(sanitizeMarkdownUrl(url), url).toBe(url);
    }
  });
});

describe('SafeMarkdown', () => {
  it('does not turn raw HTML or dangerous Markdown URLs into executable elements', () => {
    const markdown = [
      '[unsafe](javascript:alert(1))',
      '',
      '<img src=x onerror="window.__markdownXss=true">',
      '<script>window.__markdownXss=true</script>',
    ].join('\n');

    const { container } = render(<SafeMarkdown>{markdown}</SafeMarkdown>);

    expect(container.querySelector('img, script, [onerror]')).toBeNull();
    expect(screen.queryByRole('link', { name: 'unsafe' })).toBeNull();
    expect(screen.getByText('unsafe')).toBeTruthy();
  });

  it('keeps relative links in-app and protects external links', () => {
    render(
      <SafeMarkdown>
        {'[wiki](/knowledge/guide) [web](https://example.com "External guide")'}
      </SafeMarkdown>,
    );

    const wiki = screen.getByRole('link', { name: 'wiki' });
    expect(wiki.getAttribute('href')).toBe('/knowledge/guide');
    expect(wiki.getAttribute('target')).toBeNull();
    expect(wiki.getAttribute('rel')).toBeNull();

    const web = screen.getByRole('link', { name: 'web' });
    expect(web.getAttribute('title')).toBe('External guide');
    expect(web.getAttribute('target')).toBe('_blank');
    expect(web.getAttribute('rel')).toBe('noopener noreferrer');
    expect(web.hasAttribute('node')).toBe(false);
  });
});
