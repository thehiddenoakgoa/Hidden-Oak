/**
 * /api/bookings — Cloudflare Pages Function
 *
 * POST  — create a new booking (public)
 * GET   — list bookings (admin only, requires Bearer ADMIN_TOKEN)
 *
 * Storage: D1 -> KV -> memory (see _lib/bookings.ts)
 * Email: Brevo transactional (admin notification + customer confirmation)
 */

import {
  SERVICES,
  SLOTS,
  GUESTS_MIN,
  GUESTS_MAX,
  generateId,
  isValidDateStr,
  isPastDateIST,
  isValidSlot,
  isValidService,
  createBooking,
  listBookings,
  isSlotAvailable,
  capacityForSlot,
  availabilityForDate,
  slotLabel,
} from '../_lib/bookings';
import { getNotifyEmail, sendBookingNotifications } from '../_lib/brevo';
import { isAuthorized, unauthorizedResponse } from '../_lib/auth';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PATCH, DELETE, OPTIONS',
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

// ---- POST: create booking (public) ---------------------------------------
export const onRequestPost: PagesFunction = async (context) => {
  const { request, env } = context;
  const e = env as Record<string, any>;

  let payload: any;
  try {
    payload = await request.json();
  } catch {
    return jsonResponse({ ok: false, error: 'Invalid JSON body.' }, 400);
  }

  const { name, email, phone, service, date, slot, guests, notes, website } = payload || {};

  // Honeypot
  if (website) {
    // pretend success
    return jsonResponse({ ok: true, message: 'Booking received.', id: generateId() });
  }

  // ---- Validation --------------------------------------------------------
  if (!name || typeof name !== 'string' || name.trim().length < 2) {
    return jsonResponse({ ok: false, error: 'Name is required (at least 2 characters).' }, 422);
  }
  if (!email || typeof email !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return jsonResponse({ ok: false, error: 'Valid email is required.' }, 422);
  }
  if (!service || !isValidService(service)) {
    return jsonResponse({ ok: false, error: 'Please select a service.' }, 422);
  }
  if (!date || !isValidDateStr(date)) {
    return jsonResponse({ ok: false, error: 'Valid date (YYYY-MM-DD) is required.' }, 422);
  }
  if (isPastDateIST(date)) {
    return jsonResponse({ ok: false, error: 'Date cannot be in the past.' }, 422);
  }
  if (!slot || !isValidSlot(slot)) {
    return jsonResponse({ ok: false, error: 'Please select a time slot.' }, 422);
  }
  const guestsNum = guests == null || guests === '' ? 1 : Number(guests);
  if (!Number.isInteger(guestsNum) || guestsNum < GUESTS_MIN || guestsNum > GUESTS_MAX) {
    return jsonResponse({ ok: false, error: `Guests must be between ${GUESTS_MIN} and ${GUESTS_MAX}.` }, 422);
  }
  if (phone && typeof phone === 'string' && phone.trim().length > 0) {
    // loose phone validation
    const cleaned = phone.replace(/[\s\-\(\)\+]/g, '');
    if (cleaned.length < 7 || cleaned.length > 15 || !/^\d+$/.test(cleaned)) {
      return jsonResponse({ ok: false, error: 'Invalid phone number.' }, 422);
    }
  }

  // Capacity check
  const capCheck = await isSlotAvailable(e, date, slot, guestsNum);
  if (!capCheck.ok) {
    return jsonResponse(
      {
        ok: false,
        error: `This slot is full. Only ${capCheck.remaining} spot(s) left for ${slot}. Please choose another time.`,
        remaining: capCheck.remaining,
        capacity: capCheck.capacity,
      },
      409
    );
  }

  // Build booking
  const now = new Date().toISOString();
  const id = generateId();
  const svc = SERVICES[service];
  const booking = {
    id,
    created_at: now,
    updated_at: now,
    name: name.trim(),
    email: email.trim().toLowerCase(),
    phone: phone ? String(phone).trim() : undefined,
    service,
    service_label: svc.label,
    date,
    slot,
    guests: guestsNum,
    notes: notes ? String(notes).trim().slice(0, 1000) : undefined,
    status: 'pending' as const,
    price_label: svc.price,
  };

  try {
    await createBooking(e, booking);
  } catch (err: any) {
    console.error('createBooking failed', err);
    return jsonResponse({ ok: false, error: 'Could not save booking. Please try again.' }, 500);
  }

  // ---- Email notifications (non-blocking for response speed, but we await for now to report errors) ---
  const apiKey = e.BREVO_API_KEY as string | undefined;
  const notifyEmail = getNotifyEmail(e);
  let emailStatus: any = { adminSent: false, customerSent: false, skipped: false };
  if (!apiKey) {
    console.warn('BREVO_API_KEY missing — booking saved but no email sent to', notifyEmail);
    emailStatus = { adminSent: false, customerSent: false, skipped: true, reason: 'BREVO_API_KEY not configured' };
  } else {
    try {
      // slot label in IST — use shared helper (no UTC conversion)
      const slotLabelStr = slotLabel(slot);
      const result = await sendBookingNotifications({
        apiKey,
        notifyEmail,
        booking: {
          id: booking.id,
          name: booking.name,
          email: booking.email,
          phone: booking.phone,
          service_label: booking.service_label,
          price: svc.price,
          date: booking.date,
          slot: booking.slot,
          slotLabel: slotLabelStr,
          guests: booking.guests,
          notes: booking.notes,
          status: booking.status,
        },
      });
      emailStatus = result;
    } catch (err: any) {
      console.error('sendBookingNotifications threw', err);
      emailStatus = { adminSent: false, customerSent: false, error: String(err?.message || err) };
    }
  }

  // Also create Brevo contact for CRM (best-effort, no failure)
  if (apiKey) {
    try {
      const nameParts = booking.name.trim().split(/\s+/);
      const firstName = nameParts[0] || booking.name;
      const lastName = nameParts.slice(1).join(' ') || '';
      const listId = e.BREVO_LIST_ID;
      const listIds: number[] = listId ? [parseInt(String(listId), 10)].filter((n) => !isNaN(n)) : [];
      await fetch('https://api.brevo.com/v3/contacts', {
        method: 'POST',
        headers: { 'api-key': apiKey, 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({
          email: booking.email,
          attributes: {
            FIRSTNAME: firstName,
            LASTNAME: lastName,
            PHONE: booking.phone || '',
            SERVICE: booking.service_label,
            BOOKING_DATE: booking.date,
            BOOKING_SLOT: booking.slot,
            BOOKING_ID: booking.id,
          },
          listIds: listIds.length ? listIds : undefined,
          updateEnabled: true,
        }),
      });
    } catch (e) {
      console.error('Brevo contact upsert failed (non-critical)', e);
    }
  }

  return jsonResponse({ ok: true, message: 'Booking confirmed. Pay cash on arrival.', id: booking.id, booking, email: emailStatus });
};

// ---- GET: list bookings (admin only) -------------------------------------
export const onRequestGet: PagesFunction = async (context) => {
  const { request, env } = context;
  const e = env as Record<string, any>;

  if (!isAuthorized(request, e)) {
    return unauthorizedResponse();
  }

  const url = new URL(request.url);
  const status = url.searchParams.get('status');
  const date = url.searchParams.get('date');
  const service = url.searchParams.get('service');
  const q = (url.searchParams.get('q') || '').trim().toLowerCase();
  const availDate = url.searchParams.get('availability_date');

  // Special mode: if availability_date is provided, return slot availability instead
  if (availDate) {
    if (!isValidDateStr(availDate)) {
      return jsonResponse({ ok: false, error: 'Invalid availability_date' }, 422);
    }
    const avail = await availabilityForDate(e, availDate);
    return jsonResponse({ ok: true, date: availDate, slots: avail, capacity: capacityForSlot(e) });
  }

  let bookings = await listBookings(e);

  // Filters
  if (status && status !== 'all') {
    bookings = bookings.filter((b) => b.status === status);
  }
  if (date) {
    bookings = bookings.filter((b) => b.date === date);
  }
  if (service && service !== 'all') {
    bookings = bookings.filter((b) => b.service === service);
  }
  if (q) {
    bookings = bookings.filter(
      (b) =>
        b.name.toLowerCase().includes(q) ||
        b.email.toLowerCase().includes(q) ||
        (b.phone || '').toLowerCase().includes(q) ||
        b.id.toLowerCase().includes(q) ||
        b.service_label.toLowerCase().includes(q)
    );
  }

  // Stats
  const todayIST = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
  const stats = {
    total: bookings.length,
    pending: bookings.filter((b) => b.status === 'pending').length,
    confirmed: bookings.filter((b) => b.status === 'confirmed').length,
    cancelled: bookings.filter((b) => b.status === 'cancelled').length,
    completed: bookings.filter((b) => b.status === 'completed').length,
    today: bookings.filter((b) => b.date === todayIST).length,
    upcoming: bookings.filter((b) => b.date >= todayIST && b.status !== 'cancelled' && b.status !== 'completed').length,
    // revenue estimate: sum of pending+confirmed * price (cash on arrival)
    revenue_pending: (() => {
      const priceMap: Record<string, number> = { without_ice: 1000, contrast_sound: 1500 };
      return bookings
        .filter((b) => b.status === 'pending' || b.status === 'confirmed')
        .reduce((sum, b) => sum + (priceMap[b.service] || 0) * (b.guests || 1), 0);
    })(),
  };

  return jsonResponse({ ok: true, bookings, stats, capacity: capacityForSlot(e), today: todayIST });
};
