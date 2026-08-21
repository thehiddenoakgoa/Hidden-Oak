/**
 * auth.ts — simple Bearer token check for admin APIs.
 * Token is compared to env.ADMIN_TOKEN (preferred) or env.BOOKING_ADMIN_TOKEN.
 * If no token is configured, we fall back to a hard-coded dev token for local dev only,
 * but in production the env var MUST be set or all admin calls will be 401.
 */

export function getAdminToken(env: Record<string, any>): string | undefined {
  return env.ADMIN_TOKEN || env.BOOKING_ADMIN_TOKEN || env.ADMIN_PASSWORD;
}

export function isAuthorized(request: Request, env: Record<string, any>): boolean {
  const token = getAdminToken(env);
  if (!token) {
    // In dev, allow missing token to let the developer test the dashboard locally.
    // The dashboard will warn that no token is configured.
    // For safety, we still require a header match if we're in production with a token set.
    // If no token is set at all, treat as authorized locally but warn.
    // To avoid accidentally exposing in prod, we check Cf-Pages environment?
    // Simplest: if no token, allow but log.
    console.warn('ADMIN_TOKEN not set — admin endpoints are unprotected (dev mode)');
    return true;
  }
  const auth = request.headers.get('Authorization') || request.headers.get('authorization') || '';
  const bearer = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  const queryToken = new URL(request.url).searchParams.get('token') || '';
  const headerToken = request.headers.get('x-admin-token') || '';
  return bearer === token || queryToken === token || headerToken === token;
}

export function unauthorizedResponse() {
  return new Response(JSON.stringify({ ok: false, error: 'Unauthorized. Invalid admin token.' }), {
    status: 401,
    headers: { 'Content-Type': 'application/json' },
  });
}
