/**
 * /api/bookings/[id] — PATCH / DELETE / GET for a single booking
 * Admin only (Bearer ADMIN_TOKEN)
 */

import { getBookingById, updateBooking, deleteBooking, isValidStatus } from '../../_lib/bookings';
import { isAuthorized, unauthorizedResponse } from '../../_lib/auth';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, PATCH, DELETE, OPTIONS',
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

// GET single booking
export const onRequestGet: PagesFunction = async (context) => {
  const { request, env, params } = context;
  const e = env as Record<string, any>;
  if (!isAuthorized(request, e)) return unauthorizedResponse();
  const id = (params as any)?.id as string;
  if (!id) return jsonResponse({ ok: false, error: 'Missing id' }, 400);
  const booking = await getBookingById(e, id);
  if (!booking) return jsonResponse({ ok: false, error: 'Booking not found' }, 404);
  return jsonResponse({ ok: true, booking });
};

// PATCH update booking (status, notes)
export const onRequestPatch: PagesFunction = async (context) => {
  const { request, env, params } = context;
  const e = env as Record<string, any>;
  if (!isAuthorized(request, e)) return unauthorizedResponse();
  const id = (params as any)?.id as string;
  if (!id) return jsonResponse({ ok: false, error: 'Missing id' }, 400);

  let body: any;
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ ok: false, error: 'Invalid JSON' }, 400);
  }

  const patch: any = {};
  if (body.status !== undefined) {
    if (!isValidStatus(body.status)) return jsonResponse({ ok: false, error: 'Invalid status' }, 422);
    patch.status = body.status;
  }
  if (body.notes !== undefined) {
    patch.notes = String(body.notes).slice(0, 1000);
  }
  if (Object.keys(patch).length === 0) {
    return jsonResponse({ ok: false, error: 'No valid fields to update (status, notes)' }, 422);
  }

  const updated = await updateBooking(e, id, patch);
  if (!updated) return jsonResponse({ ok: false, error: 'Booking not found' }, 404);
  return jsonResponse({ ok: true, booking: updated });
};

// DELETE booking
export const onRequestDelete: PagesFunction = async (context) => {
  const { request, env, params } = context;
  const e = env as Record<string, any>;
  if (!isAuthorized(request, e)) return unauthorizedResponse();
  const id = (params as any)?.id as string;
  if (!id) return jsonResponse({ ok: false, error: 'Missing id' }, 400);
  const ok = await deleteBooking(e, id);
  if (!ok) return jsonResponse({ ok: false, error: 'Booking not found' }, 404);
  return jsonResponse({ ok: true, message: 'Booking deleted' });
};
