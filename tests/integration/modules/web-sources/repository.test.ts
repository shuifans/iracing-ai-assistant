import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { webKnowledgeSources } from '@/db/schema/web-sources';
import { users } from '@/db/schema/users';
import { createTestDb, type TestDb } from '../../../helpers/test-db';

describe('web knowledge sources schema', () => {
  let db: TestDb;
  let cleanup: () => void;

  beforeAll(() => {
    const test = createTestDb();
    db = test.db;
    cleanup = test.cleanup;
    db.insert(users)
      .values({
        id: 'admin',
        username: 'admin',
        passwordHash: 'hash',
        role: 'admin',
        status: 'active',
        createdAt: '2026-07-15T00:00:00.000Z',
        updatedAt: '2026-07-15T00:00:00.000Z',
      })
      .run();
  });

  afterAll(() => {
    cleanup();
  });

  beforeEach(() => {
    db.delete(webKnowledgeSources).run();
  });

  it('persists a typed source and defaults it to enabled', () => {
    db.insert(webKnowledgeSources)
      .values({
        id: 'source-1',
        name: 'iRacing Support',
        scopeType: 'domain',
        url: 'https://support.iracing.com',
        sourceLevel: 'official',
        description: 'Official iRacing support articles',
        createdBy: 'admin',
        updatedBy: 'admin',
        createdAt: '2026-07-15T00:00:00.000Z',
        updatedAt: '2026-07-15T00:00:00.000Z',
      })
      .run();

    const source = db
      .select()
      .from(webKnowledgeSources)
      .where(eq(webKnowledgeSources.id, 'source-1'))
      .get();

    expect(source).toMatchObject({
      scopeType: 'domain',
      sourceLevel: 'official',
      enabled: true,
    });
  });

  it('enforces unique URL and scope pairs', () => {
    db.insert(webKnowledgeSources)
      .values({
        id: 'source-original',
        name: 'Original',
        scopeType: 'domain',
        url: 'https://support.iracing.com',
        sourceLevel: 'official',
        createdBy: 'admin',
        updatedBy: 'admin',
        createdAt: '2026-07-15T00:00:00.000Z',
        updatedAt: '2026-07-15T00:00:00.000Z',
      })
      .run();

    expect(() =>
      db
        .insert(webKnowledgeSources)
        .values({
          id: 'source-duplicate',
          name: 'Duplicate',
          scopeType: 'domain',
          url: 'https://support.iracing.com',
          sourceLevel: 'community',
          createdBy: 'admin',
          updatedBy: 'admin',
          createdAt: '2026-07-15T00:00:00.000Z',
          updatedAt: '2026-07-15T00:00:00.000Z',
        })
        .run(),
    ).toThrow();
  });
});
