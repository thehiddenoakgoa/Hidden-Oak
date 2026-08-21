/**
 * /api/contact — Cloudflare Pages Function
 *
 * Receives contact form submissions from the /location page and:
 *   1. Creates/updates a contact in Brevo CRM
 *   2. Sends a notification email to thehiddenoak@gmail.com via Brevo SMTP
 *
 * Required environment variables (set in Cloudflare Pages dashboard):
 *   BREVO_API_KEY   — Brevo API key (Settings → SMTP & API → API Keys)
 *   BREVO_LIST_ID   — (optional) Brevo contact list ID to add the contact to
 *   CONTACT_EMAIL   — where notifications are sent (default: thehiddenoak@gmail.com)
 *
 * Security:
 *   - POST only
 *   - Honeypot field check (website field must be empty)
 *   - Basic input validation
 *   - API key stored server-side, never exposed to the client
 */

const BREVO_BASE = 'https://api.brevo.com/v3';
const DEFAULT_CONTACT_EMAIL = 'thehiddenoak.goa@gmail.com';

// Allow CORS from the same origin (the Pages site itself).
const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

interface ContactPayload {
  name?: string;
  email?: string;
  phone?: string;
  message?: string;
  website?: string; // honeypot
}

function jsonResponse(body: unknown, status = 200, extra: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json',
      ...CORS_HEADERS,
      ...extra,
    },
  });
}

export const onRequestOptions: PagesFunction = async () => {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
};

export const onRequestPost: PagesFunction = async (context) => {
  const { request, env } = context;

  // ---- Parse and validate --------------------------------------------------
  let payload: ContactPayload;
  try {
    payload = (await request.json()) as ContactPayload;
  } catch {
    return jsonResponse({ ok: false, error: 'Invalid JSON body.' }, 400);
  }

  const { name, email, phone, message, website } = payload;

  // Honeypot: if the hidden "website" field is filled, it's a bot.
  // Pretend success so bots don't retry.
  if (website) {
    return jsonResponse({ ok: true, message: 'Message received.' });
  }

  // Required field validation
  if (!name || !email || !message) {
    return jsonResponse(
      { ok: false, error: 'Name, email, and message are required.' },
      422
    );
  }
  // Basic email format check
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return jsonResponse({ ok: false, error: 'Invalid email address.' }, 422);
  }

  // ---- Check Brevo API key -------------------------------------------------
  const apiKey = (env as Record<string, string>).BREVO_API_KEY;
  const listId = (env as Record<string, string>).BREVO_LIST_ID;
  const notifyEmail = (env as Record<string, string>).CONTACT_EMAIL || DEFAULT_CONTACT_EMAIL;

  if (!apiKey) {
    console.error('BREVO_API_KEY is not set in environment variables.');
    return jsonResponse(
      { ok: false, error: 'Server is not configured. Please contact us directly.' },
      500
    );
  }

  const brevoHeaders: Record<string, string> = {
    'api-key': apiKey,
    'Content-Type': 'application/json',
    Accept: 'application/json',
  };

  // Split name into first/last for Brevo (best-effort)
  const nameParts = name.trim().split(/\s+/);
  const firstName = nameParts[0] || name;
  const lastName = nameParts.slice(1).join(' ') || '';

  // ---- 1. Create/update contact in Brevo CRM -------------------------------
  const listIds: number[] = listId ? [parseInt(listId, 10)].filter((n) => !isNaN(n)) : [];

  const contactBody: Record<string, unknown> = {
    email: email,
    attributes: {
      FIRSTNAME: firstName,
      LASTNAME: lastName,
      PHONE: phone || '',
      // Custom attribute for the source — helps segment in the CRM
      SOURCE: 'Website Contact Form',
    },
    listIds: listIds.length > 0 ? listIds : undefined,
    updateEnabled: true, // update if the contact already exists
  };

  const contactRes = await fetch(`${BREVO_BASE}/contacts`, {
    method: 'POST',
    headers: brevoHeaders,
    body: JSON.stringify(contactBody),
  });

  // 201 = created, 204 = already exists (updated). Both are fine.
  // 400 with "Contact already exists" is also acceptable when updateEnabled
  // didn't catch it — we proceed to send the notification email anyway.
  if (!contactRes.ok && contactRes.status !== 400) {
    console.error(`Brevo contact creation failed: ${contactRes.status} ${await contactRes.text()}`);
    // Don't fail the whole request — still try to send the email.
  }

  // ---- 2. Send notification email via Brevo SMTP ---------------------------
  // This email goes to the business inbox (thehiddenoak@gmail.com) so the
  // team is notified of every enquiry. Uses Brevo's transactional email API.
  const emailBody = {
    sender: {
      name: 'Hidden Oak Website',
      email: notifyEmail, // must be a verified sender in Brevo
    },
    to: [{ email: notifyEmail, name: 'Hidden Oak' }],
    replyTo: { email: email, name: name }, // reply directly to the enquirer
    subject: `New enquiry from ${name} — Hidden Oak website`,
    htmlContent: `
      <div style="font-family: Arial, sans-serif; max-width: 560px; margin: 0 auto; padding: 24px; background: #f4f4f4;">
        <div style="background: #2B1D14; padding: 24px; border-radius: 12px;">
          <h1 style="color: #F1E7D0; margin: 0 0 20px; font-size: 20px;">New enquiry from the website</h1>
          <table style="width: 100%; color: #c6bcad; font-size: 14px; line-height: 1.6;">
            <tr><td style="color: #B5651D; font-weight: bold; width: 80px; vertical-align: top;">Name:</td><td style="color: #F1E7D0;">${escapeHtml(name)}</td></tr>
            <tr><td style="color: #B5651D; font-weight: bold; vertical-align: top;">Email:</td><td style="color: #F1E7D0;"><a href="mailto:${escapeAttr(email)}" style="color: #F1E7D0;">${escapeHtml(email)}</a></td></tr>
            <tr><td style="color: #B5651D; font-weight: bold; vertical-align: top;">Phone:</td><td style="color: #F1E7D0;">${phone ? escapeHtml(phone) : '—'}</td></tr>
          </table>
          <hr style="border: 0; border-top: 1px solid #53412C; margin: 20px 0;" />
          <p style="color: #B5651D; font-weight: bold; font-size: 13px; margin: 0 0 8px;">MESSAGE</p>
          <p style="color: #F1E7D0; font-size: 14px; line-height: 1.6; white-space: pre-wrap;">${escapeHtml(message)}</p>
        </div>
        <p style="color: #888; font-size: 12px; text-align: center; margin-top: 16px;">
          Sent from the Hidden Oak contact form at hiddenoak.pages.dev
        </p>
      </div>
    `,
  };

  const emailRes = await fetch(`${BREVO_BASE}/smtp/email`, {
    method: 'POST',
    headers: brevoHeaders,
    body: JSON.stringify(emailBody),
  });

  if (!emailRes.ok) {
    const errText = await emailRes.text();
    console.error(`Brevo email send failed: ${emailRes.status} ${errText}`);
    return jsonResponse(
      { ok: false, error: 'Could not send message. Please try again or WhatsApp us.' },
      502
    );
  }

  return jsonResponse({ ok: true, message: 'Message sent successfully.' });
};

// ---- HTML escape helpers (prevent injection in the email body) -----------
function escapeHtml(str: string): string {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function escapeAttr(str: string): string {
  return escapeHtml(str);
}
