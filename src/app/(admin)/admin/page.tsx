import { redirect } from 'next/navigation';

/**
 * /admin index — there is no dashboard landing page; the admin area is
 * organised as sub-routes (/admin/users, /admin/sessions, …). Without this
 * page the bare /admin URL falls through to Next.js' not-found page (404),
 * which also bypasses the (admin) layout's auth gate. Redirect to the first
 * nav item (matches AdminNav's order) so /admin behaves for both authed
 * admins and unauthed visitors (who then get bounced to /login by the layout).
 */
export default function AdminIndexPage() {
  redirect('/admin/users');
}
