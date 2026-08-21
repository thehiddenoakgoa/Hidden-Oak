/**
 * /api/admin/login — POST { token }
 * Validates admin token and returns ok if correct.
 * Used by the hidden dashboard to store token client-side before calling other admin APIs.
 */

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Admin-Token',
};

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
  });
}

export const onRequestOptions: PagesFunction = async () => {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
};

export const onRequestPost: PagesFunction = async (context) => {
  const { request, env } = context;
  const e = env as Record<string, any>;
  const expected = e.ADMIN_TOKEN || e.BOOKING_ADMIN_TOKEN || e.ADMIN_PASSWORD;

  // If no token configured, allow any token in dev but warn
  if (!expected) {
    console.warn('ADMIN_TOKEN not set — login auto-approves (dev mode)');
    return jsonResponse({ ok: true, message: 'No admin token configured (dev mode). Any password accepted.' });
  }

  let body: any;
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ ok: false, error: 'Invalid JSON' }, 400);
  }

  const token = String(body?.token || body?.password || '').trim();
  if (!token) return jsonResponse({ ok: false, error: 'Token is required' }, 422);
  if (token !== expected) return jsonResponse({ ok: false, error: 'Invalid token' }, 401);

  return jsonResponse({ ok: true, message: 'Authenticated' });
};
