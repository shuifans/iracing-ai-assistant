import { describe, expect, it } from 'vitest';
import {
  normalizeWebSourceUrl,
  webSourceInputSchema,
  webSourceUpdateSchema,
} from '@/modules/web-sources/schemas';

describe('web source schemas', () => {
  it.each([
    'http://iracing.com',
    'https://user@iracing.com',
    'https://iracing.com:444',
    'https://iracing.com:443',
    'https://iracing.com:0443',
    'https://iracing.com:',
    'https://[2001:db8::1]:443/news',
    'https://iracing.com./news',
    'https://iracing.com/a%2fb',
    'https://iracing.com/a%5cb',
    'https://iracing.com/a%2eb',
    'https://iracing.com/%2e/admin',
  ])('rejects unsafe source URL %s', (url) => {
    expect(() =>
      webSourceInputSchema.parse({
        name: 'bad',
        scopeType: 'domain',
        url,
        sourceLevel: 'official',
        enabled: true,
      }),
    ).toThrow();
  });

  it('normalizes a path source', () => {
    expect(normalizeWebSourceUrl('path', 'https://reddit.com/r/iRacing/')).toBe(
      'https://reddit.com/r/iRacing',
    );
  });

  it('allows an IPv6 authority without an explicit port', () => {
    expect(normalizeWebSourceUrl('domain', 'https://[2001:db8::1]/news')).toBe(
      'https://[2001:db8::1]',
    );
  });

  it('normalizes domain and exact URL scopes', () => {
    expect(normalizeWebSourceUrl('domain', 'https://IRACING.com/some/path?q=1')).toBe(
      'https://iracing.com',
    );
    expect(normalizeWebSourceUrl('exact_url', 'https://IRACING.com/a/../news/?q=one')).toBe(
      'https://iracing.com/news/?q=one',
    );
  });

  it('does not default omitted fields in partial updates', () => {
    expect(webSourceUpdateSchema.parse({ name: 'Renamed' })).toEqual({ name: 'Renamed' });
  });

  it('rejects an unsafe URL in partial updates', () => {
    expect(() => webSourceUpdateSchema.parse({ url: 'http://iracing.com' })).toThrow();
  });
});
