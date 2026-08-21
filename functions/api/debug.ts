/**
 * /api/debug — temporary diagnostic to check env bindings (no secrets exposed)
 * Returns list of env keys and whether BREVO_API_KEY is set, plus D1/KV status.
 * Remove after debugging.
 */
export const onRequestGet: PagesFunction = async (context) => {
  const { env } = context;
  const e = env as Record<string, any>;
  const keys = Object.keys(e).sort();
  // Redact secrets: only show presence and length
  const hasBrevo = !!e.BREVO_API_KEY;
  const brevoLen = hasBrevo ? String(e.BREVO_API_KEY).length : 0;
  const hasAdmin = !!e.ADMIN_TOKEN;
  const hasDB = !!e.DB;
  const hasKV = !!e.BOOKINGS_KV;
  return new Response(JSON.stringify({
    keys,
    hasBrevo,
    brevoLen,
    brevoPrefix: hasBrevo ? String(e.BREVO_API_KEY).slice(0, 8) + '...' : null,
    hasAdmin,
    hasDB,
    hasKV,
    contactEmail: e.CONTACT_EMAIL || null,
    bookingEmail: e.BOOKING_EMAIL || null,
    slotCapacity: e.SLOT_CAPACITY || null,
  }, null, 2), { headers: { 'Content-Type': 'application/json' } });
};
