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

  test('authenticated /knowledge renders the import tab and paginates (>20 seeded jobs)', async ({
    authedKadminPage: page,
  }) => {
    await page.goto('/knowledge');
    await expect(page).toHaveURL(/\/knowledge/);
    await expect(page.getByRole('tab', { name: '导入知识' })).toBeVisible();
    // 21 seeded failed jobs, limit 20 → meta.nextCursor non-null → 下一页 enabled
    await expect(page.getByRole('button', { name: '下一页' })).toBeEnabled();
  });

  test('/knowledge uses the unified TopNav (no chat session sidebar)', async ({
    authedKadminPage: page,
  }) => {
    await page.goto('/knowledge');
    // TopNav 模块链接按角色显隐：kadmin 可见「对话」「知识管理」，不可见「账户管理」
    const topNav = page.getByRole('navigation', { name: '模块导航' });
    await expect(topNav.getByRole('link', { name: '对话' })).toBeVisible();
    await expect(topNav.getByRole('link', { name: '知识管理' })).toBeVisible();
    await expect(topNav.getByRole('link', { name: '账户管理' })).toHaveCount(0);
    // 知识页不再挂会话侧边栏
    await expect(page.getByRole('complementary', { name: '会话历史' })).toHaveCount(0);
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

  test('knowledge admin can create and disable an isolated exact-URL Web source', async ({
    authedKadminPage: page,
    kadminToken,
    webSourceCleanup,
  }, testInfo) => {
    const unique = `${Date.now()}-${testInfo.workerIndex}`;
    const sourceName = `e2e-web-source-${unique}`;
    const sourceUrl = `https://support.iracing.com/e2e/${unique}`;
    webSourceCleanup.trackName(sourceName);

    await page.goto('/knowledge');
    // 「联网知识源」位于 管理知识 tab 下的子分区（pill 按钮）
    await page.getByRole('tab', { name: '管理知识' }).click();
    const webSourcesTab = page.getByRole('button', { name: '联网知识源' });
    await expect(webSourcesTab).toBeVisible();
    await webSourcesTab.click();
    await expect(page.getByRole('heading', { name: '新增联网知识源' })).toBeVisible();

    await page.getByLabel('名称').fill(sourceName);
    await page.getByLabel('范围类型').selectOption('exact_url');
    await page.getByRole('textbox', { name: 'URL' }).fill(sourceUrl);
    await page.getByLabel('来源级别').selectOption('official');
    await page.getByRole('button', { name: `创建 ${sourceName}` }).click();

    const sourceRow = page.getByRole('row').filter({ hasText: sourceName });
    await expect(sourceRow).toContainText('精确 URL');
    await expect(sourceRow).toContainText('已启用');

    const listRes = await page.request.get('/api/knowledge/web-sources', {
      headers: { Authorization: `Bearer ${kadminToken}` },
    });
    expect(listRes.ok()).toBeTruthy();
    const listJson = (await listRes.json()) as {
      data: { sources: Array<{ name: string; url: string }> };
    };
    expect(
      listJson.data.sources.some(
        (source) => source.name === sourceName && source.url === sourceUrl,
      ),
    ).toBe(true);

    await sourceRow.getByRole('button', { name: `停用 ${sourceName}` }).click();
    await expect(sourceRow).toContainText('已停用');
    await expect(sourceRow.getByRole('button', { name: `启用 ${sourceName}` })).toBeVisible();
  });
});
