/**
 * brevo.ts — Helpers to send transactional emails via Brevo.
 */

const BREVO_BASE = 'https://api.brevo.com/v3';
const DEFAULT_NOTIFY = 'thehiddenoak.goa@gmail.com';

export function escapeHtml(str: string): string {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

export async function sendBookingNotifications(opts: {
  apiKey: string;
  notifyEmail: string;
  booking: {
    id: string;
    name: string;
    email: string;
    phone?: string;
    service_label: string;
    price: string;
    date: string;
    slot: string;
    slotLabel: string;
    guests: number;
    notes?: string;
    status: string;
  };
}): Promise<{ adminSent: boolean; customerSent: boolean; errors: string[] }> {
  const { apiKey, notifyEmail, booking } = opts;
  const errors: string[] = [];
  const headers: Record<string, string> = {
    'api-key': apiKey,
    'Content-Type': 'application/json',
    Accept: 'application/json',
  };

  const adminSubject = `New booking — ${booking.service_label} — ${booking.date} ${booking.slot} — ${booking.name}`;
  const adminHtml = `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 24px; background: #f4ead4;">
      <div style="background: #2B1D14; padding: 28px; border-radius: 12px; border: 1px solid #53412C;">
        <p style="margin:0 0 6px; color:#B5651D; font-size:12px; letter-spacing:0.18em; text-transform:uppercase; font-weight:700;">New Booking · Hidden Oak</p>
        <h1 style="color: #F1E7D0; margin: 0 0 20px; font-size: 22px;">${escapeHtml(booking.service_label)} — ${escapeHtml(booking.date)} · ${escapeHtml(booking.slotLabel)}</h1>
        <table style="width: 100%; color: #c6bcad; font-size: 14px; line-height: 1.6; border-collapse: collapse;">
          <tr><td style="color: #B5651D; font-weight: bold; width: 130px; padding:6px 0; vertical-align: top;">Booking ID:</td><td style="color: #F1E7D0; font-family: monospace;">${escapeHtml(booking.id)}</td></tr>
          <tr><td style="color: #B5651D; font-weight: bold; padding:6px 0; vertical-align: top;">Service:</td><td style="color: #F1E7D0;">${escapeHtml(booking.service_label)} — ${escapeHtml(booking.price)}</td></tr>
          <tr><td style="color: #B5651D; font-weight: bold; padding:6px 0; vertical-align: top;">Date:</td><td style="color: #F1E7D0;">${escapeHtml(booking.date)}</td></tr>
          <tr><td style="color: #B5651D; font-weight: bold; padding:6px 0; vertical-align: top;">Slot (IST):</td><td style="color: #F1E7D0;">${escapeHtml(booking.slotLabel)} (${escapeHtml(booking.slot)})</td></tr>
          <tr><td style="color: #B5651D; font-weight: bold; padding:6px 0; vertical-align: top;">Guests:</td><td style="color: #F1E7D0;">${escapeHtml(String(booking.guests))}</td></tr>
          <tr><td style="color: #B5651D; font-weight: bold; padding:6px 0; vertical-align: top;">Name:</td><td style="color: #F1E7D0;">${escapeHtml(booking.name)}</td></tr>
          <tr><td style="color: #B5651D; font-weight: bold; padding:6px 0; vertical-align: top;">Email:</td><td style="color: #F1E7D0;"><a href="mailto:${escapeHtml(booking.email)}" style="color: #F1E7D0;">${escapeHtml(booking.email)}</a></td></tr>
          <tr><td style="color: #B5651D; font-weight: bold; padding:6px 0; vertical-align: top;">Phone:</td><td style="color: #F1E7D0;">${booking.phone ? `<a href="tel:${escapeHtml(booking.phone)}" style="color:#F1E7D0;">${escapeHtml(booking.phone)}</a>` : '—'}</td></tr>
          <tr><td style="color: #B5651D; font-weight: bold; padding:6px 0; vertical-align: top;">Status:</td><td style="color: #F1E7D0; text-transform: capitalize;">${escapeHtml(booking.status)}</td></tr>
        </table>
        ${
          booking.notes
            ? `<hr style="border:0; border-top:1px solid #53412C; margin:18px 0;" />
               <p style="color: #B5651D; font-weight: bold; font-size: 13px; margin: 0 0 8px; text-transform: uppercase; letter-spacing:0.08em;">Notes</p>
               <p style="color: #F1E7D0; font-size: 14px; line-height: 1.6; white-space: pre-wrap; background: rgba(255,255,255,0.05); padding:12px; border-radius:8px;">${escapeHtml(booking.notes)}</p>`
            : ''
        }
        <hr style="border:0; border-top:1px solid #53412C; margin:20px 0;" />
        <p style="color:#c6bcad; font-size:13px; line-height:1.5; margin:0;">
          <strong style="color:#F1E7D0;">Cash on arrival</strong> — no online payment. Please confirm the booking and prepare the banya.<br/>
          Manage all bookings at your hidden admin dashboard. Reply directly to the customer at <a href="mailto:${escapeHtml(booking.email)}" style="color:#B5651D;">${escapeHtml(booking.email)}</a>.
        </p>
      </div>
      <p style="color: #8c7f68; font-size: 11px; text-align: center; margin-top: 16px;">
        Sent from Hidden Oak booking system · ${escapeHtml(booking.id)} · hiddenoak.pages.dev/book
      </p>
    </div>
  `;

  const adminBody = {
    sender: { name: 'Hidden Oak Bookings', email: notifyEmail },
    to: [{ email: notifyEmail, name: 'Hidden Oak' }],
    replyTo: { email: booking.email, name: booking.name },
    subject: adminSubject,
    htmlContent: adminHtml,
  };

  let adminSent = false;
  try {
    const res = await fetch(`${BREVO_BASE}/smtp/email`, {
      method: 'POST',
      headers,
      body: JSON.stringify(adminBody),
    });
    if (!res.ok) {
      const t = await res.text();
      errors.push(`Admin email failed: ${res.status} ${t}`);
      console.error('Brevo admin email failed', res.status, t);
    } else {
      adminSent = true;
    }
  } catch (e: any) {
    errors.push(`Admin email exception: ${e?.message || String(e)}`);
    console.error('Brevo admin exception', e);
  }

  // Customer confirmation (best-effort, non-blocking for admin success)
  const customerSubject = `Booking received — ${booking.service_label} on ${booking.date} at ${booking.slotLabel} · Hidden Oak`;
  const customerHtml = `
    <div style="font-family: Arial, sans-serif; max-width: 560px; margin: 0 auto; padding: 24px; background: #f6e8d5;">
      <div style="background: #2f2118; padding: 28px; border-radius: 16px;">
        <p style="margin:0 0 8px; color:#c46a28; font-size:11px; letter-spacing:0.18em; text-transform:uppercase; font-weight:700;">Hidden Oak · Arambol, Goa</p>
        <h1 style="color:#f4ead4; margin:0 0 12px; font-size:22px;">Booking received — see you soon.</h1>
        <p style="color:#c6bcad; font-size:14px; line-height:1.6; margin:0 0 18px;">Hi ${escapeHtml(booking.name)}, we have your request. No payment needed now — please pay <strong style="color:#f4ead4;">cash on arrival</strong>.</p>
        <div style="background: rgba(244,234,212,0.07); border: 1px solid rgba(244,234,212,0.14); border-radius: 12px; padding:16px;">
          <table style="width:100%; font-size:14px; line-height:1.6; border-collapse:collapse; color:#c6bcad;">
            <tr><td style="color:#c46a28; font-weight:bold; width:110px; padding:4px 0;">Booking ID</td><td style="color:#f4ead4; font-family:monospace;">${escapeHtml(booking.id)}</td></tr>
            <tr><td style="color:#c46a28; font-weight:bold; padding:4px 0;">Service</td><td style="color:#f4ead4;">${escapeHtml(booking.service_label)} · ${escapeHtml(booking.price)}</td></tr>
            <tr><td style="color:#c46a28; font-weight:bold; padding:4px 0;">Date</td><td style="color:#f4ead4;">${escapeHtml(booking.date)}</td></tr>
            <tr><td style="color:#c46a28; font-weight:bold; padding:4px 0;">Time (IST)</td><td style="color:#f4ead4;">${escapeHtml(booking.slotLabel)} (${escapeHtml(booking.slot)})</td></tr>
            <tr><td style="color:#c46a28; font-weight:bold; padding:4px 0;">Guests</td><td style="color:#f4ead4;">${escapeHtml(String(booking.guests))}</td></tr>
          </table>
        </div>
        <p style="color:#c6bcad; font-size:13px; line-height:1.6; margin:18px 0 0;">Open daily 6 PM – midnight · H. No. 613/2, Madhalawada, Arambol · <a href="https://maps.app.goo.gl/HTjXm77Z5ggcumkR7" style="color:#c46a28;">Map</a> · <a href="https://wa.me/919818083992" style="color:#c46a28;">WhatsApp +91 98180 83992</a></p>
        <p style="color:#8c7f68; font-size:12px; line-height:1.5; margin:14px 0 0; border-top:1px solid rgba(244,234,212,0.12); padding-top:14px;">Bring swimwear & water bottle — towels, soap & tea are on us. Free cancellation up to 24h before your slot.</p>
      </div>
      <p style="color:#8c7f68; font-size:11px; text-align:center; margin-top:14px;">Hidden Oak Banya · Arambol, Goa</p>
    </div>
  `;

  let customerSent = false;
  try {
    const custBody = {
      sender: { name: 'Hidden Oak', email: notifyEmail },
      to: [{ email: booking.email, name: booking.name }],
      replyTo: { email: notifyEmail, name: 'Hidden Oak' },
      subject: customerSubject,
      htmlContent: customerHtml,
    };
    const res2 = await fetch(`${BREVO_BASE}/smtp/email`, {
      method: 'POST',
      headers,
      body: JSON.stringify(custBody),
    });
    if (!res2.ok) {
      const t = await res2.text();
      errors.push(`Customer email failed: ${res2.status} ${t}`);
      console.error('Brevo customer email failed', res2.status, t);
    } else {
      customerSent = true;
    }
  } catch (e: any) {
    errors.push(`Customer email exception: ${e?.message || String(e)}`);
  }

  return { adminSent, customerSent, errors };
}

export function getNotifyEmail(env: Record<string, any>): string {
  // User explicitly wants thehiddenoak.goa@gmail.com for bookings,
  // but we honour env overrides.
  return env.BOOKING_EMAIL || env.BOOKINGS_NOTIFY_EMAIL || env.CONTACT_EMAIL || DEFAULT_NOTIFY;
}
