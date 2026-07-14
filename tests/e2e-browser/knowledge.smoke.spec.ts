import { test, expect } from './fixtures';

/**
 * /knowledge smoke E2E — guards the regressions fixed in this branch:
 *  - file upload returns 201 (was 500 FK: createSource ignored the caller's id,
 *    so submitJob referenced a never-persisted source_id)
 *  - sources/jobs/items pagination reads meta.nextCursor (was json.pagination →
 *    Next never activated)
 */
test.describe('/knowledge smoke', () => {
  test('unauthenticated /knowledge redirects to /login', async ({ page }) => {
    await page.goto('/knowledge');
    await expect(page).toHaveURL(/\/login/);
  });

  test('authenticated /knowledge renders the sources tab and paginates (>20 seeded sources)', async ({
    authedKadminPage: page,
  }) => {
    await page.goto('/knowledge');
    await expect(page).toHaveURL(/\/knowledge/);
    await expect(page.getByRole('tab', { name: '来源管理' })).toBeVisible();
    // 21 seeded sources, limit 20 → meta.nextCursor non-null → 下一页 enabled
    await expect(page.getByRole('button', { name: '下一页' })).toBeEnabled();
  });

  test('sources list returns meta.nextCursor (envelope fix: cursor under meta, not pagination)', async ({
    request,
    kadminToken,
  }) => {
    const headers = { Authorization: `Bearer ${kadminToken}` };
    const res = await request.get('/api/knowledge/sources?limit=20', { headers });
    expect(res.ok()).toBeTruthy();
    const json = (await res.json()) as { meta?: { nextCursor: string | null } };
    expect(json.meta?.nextCursor).toBeTruthy();
  });

  test('file upload returns 201 (regression: was 500 FK before the createSource id fix)', async ({
    request,
    kadminToken,
  }) => {
    const res = await request.post('/api/knowledge/sources/file', {
      headers: { Authorization: `Bearer ${kadminToken}` },
      multipart: {
        file: {
          name: 'e2e-upload.txt',
          mimeType: 'text/plain',
          buffer: Buffer.from('iRacing brake points for T1 at Summit Main.\n'),
        },
      },
    });
    expect(res.status()).toBe(201);
    const json = (await res.json()) as { data: { sourceId: string; jobId: string } };
    expect(json.data.sourceId).toBeTruthy();
    expect(json.data.jobId).toBeTruthy();
  });
});
