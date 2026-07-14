/**
 * Shared Playwright fixtures for the /admin + /knowledge smoke E2E.
 *
 * Auth model: login (POST /api/auth/login) returns an access token AND sets an
 * httpOnly `refresh_token` cookie. API routes require a `Bearer <accessToken>`
 * header (requireAuth). The browser pages bootstrap the in-memory access token
 * from the cookie via /api/auth/me on layout mount — so for UI tests we log in
 * through the page's request context (shares cookies with the page) and let the
 * layout self-bootstrap; for direct API tests we pass the Bearer explicitly.
 */
import { test as base, expect, type APIRequestContext, type Page } from '@playwright/test';

export const E2E_ADMIN = { username: 'e2e-admin', password: 'e2e-admin-pw-123' };
export const E2E_KADMIN = { username: 'e2e-kadmin', password: 'e2e-kadmin-pw-123' };

async function loginViaApi(
  ctx: APIRequestContext,
  creds: { username: string; password: string },
): Promise<string> {
  const res = await ctx.post('/api/auth/login', { data: creds });
  if (!res.ok())
    throw new Error(`login failed for ${creds.username}: ${res.status()} ${await res.text()}`);
  const json = (await res.json()) as { data: { accessToken: string } };
  return json.data.accessToken;
}

export const test = base.extend<{
  /** Bearer access token for the seeded admin (direct API calls). */
  adminToken: string;
  /** Bearer access token for the seeded knowledge_admin (direct API calls). */
  kadminToken: string;
  /** Browser page logged in as admin (refresh cookie set in the context). */
  authedAdminPage: Page;
  /** Browser page logged in as knowledge_admin (refresh cookie set in the context). */
  authedKadminPage: Page;
}>({
  adminToken: async ({ request }, use) => {
    await use(await loginViaApi(request, E2E_ADMIN));
  },
  kadminToken: async ({ request }, use) => {
    await use(await loginViaApi(request, E2E_KADMIN));
  },
  authedAdminPage: async ({ browser }, use) => {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    // page.request shares the cookie jar with the page — the refresh cookie lands
    // in the browser context, and the (admin) layout bootstraps via /api/auth/me.
    await loginViaApi(page.request, E2E_ADMIN);
    await use(page);
    await ctx.close();
  },
  authedKadminPage: async ({ browser }, use) => {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    await loginViaApi(page.request, E2E_KADMIN);
    await use(page);
    await ctx.close();
  },
});

export { expect };
