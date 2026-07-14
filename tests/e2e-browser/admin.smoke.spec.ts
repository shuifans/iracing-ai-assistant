import { test, expect } from './fixtures';

/**
 * /admin smoke E2E — guards the regressions fixed in this branch:
 *  - /admin no longer 404s (now redirects to /admin/users)
 *  - disable/enable/role use PATCH (the frontend was sending POST/PUT → 405)
 *  - users pagination reads meta.nextCursor + sets it (Next button activates with >20 users)
 */
test.describe('/admin smoke', () => {
  test('unauthenticated /admin redirects to /login (not 404)', async ({ page }) => {
    await page.goto('/admin');
    // /admin → server redirect to /admin/users → client layout → /api/auth/me 401 → /login
    await expect(page).toHaveURL(/\/login/);
  });

  test('authenticated /admin lands on /admin/users', async ({ authedAdminPage: page }) => {
    await page.goto('/admin');
    await expect(page).toHaveURL(/\/admin\/users/);
    await expect(page.getByRole('heading', { name: '用户管理' })).toBeVisible();
  });

  test('disable / enable / change-role accept PATCH (was 405 when frontend used POST/PUT)', async ({
    request,
    adminToken,
  }) => {
    const headers = { Authorization: `Bearer ${adminToken}` };
    const list = await request.get('/api/admin/users?limit=20', { headers });
    expect(list.ok()).toBeTruthy();
    const body = (await list.json()) as {
      data: { users: { id: string; username: string }[] };
    };
    const target = body.data.users.find((u) => u.username === 'e2e-user01');
    expect(target).toBeTruthy();

    const disable = await request.fetch(`/api/admin/users/${target!.id}/disable`, {
      method: 'PATCH',
      headers,
    });
    expect(disable.status()).toBe(200);

    const enable = await request.fetch(`/api/admin/users/${target!.id}/enable`, {
      method: 'PATCH',
      headers,
    });
    expect(enable.status()).toBe(200);

    const role = await request.fetch(`/api/admin/users/${target!.id}/role`, {
      method: 'PATCH',
      headers,
      data: { role: 'user' },
    });
    expect(role.status()).toBe(200);
  });

  test('users pagination: 全部用户 tab → 下一页 enabled (>20 seeded users)', async ({
    authedAdminPage: page,
  }) => {
    await page.goto('/admin/users');
    await page.getByRole('tab', { name: '全部用户' }).click();
    // 22 seeded users, limit 20 → meta.nextCursor non-null → Next enabled
    await expect(page.getByRole('button', { name: '下一页' })).toBeEnabled();
  });
});
