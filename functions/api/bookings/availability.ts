/**
 * /api/bookings/availability — GET ?date=YYYY-MM-DD
 * Public: returns slots availability for a date (taken/remaining/capacity)
 */

import { isValidDateStr, availabilityForDate, capacityForSlot } from '../../_lib/bookings';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
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

export const onRequestGet: PagesFunction = async (context) => {
  const { request, env } = context;
  const e = env as Record<string, any>;
  const url = new URL(request.url);
  const date = url.searchParams.get('date');

  if (!date || !isValidDateStr(date)) {
    return jsonResponse({ ok: false, error: 'Query param ?date=YYYY-MM-DD is required.' }, 422);
  }

  const slots = await availabilityForDate(e, date);
  return jsonResponse({ ok: true, date, slots, capacity: capacityForSlot(e) });
};
