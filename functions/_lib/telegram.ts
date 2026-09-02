/**
 * telegram.ts — Send booking notifications via Telegram bot.
 *
 * Required secrets (Cloudflare Pages encrypted env vars):
 *   TELEGRAM_BOT_TOKEN  — from @BotFather
 *   TELEGRAM_CHAT_ID    — owner's numeric chat ID
 */

export interface TelegramBookingPayload {
  id: string;
  name: string;
  email: string;
  phone?: string;
  service_label: string;
  price: string;
  date: string;
  slotLabel: string;
  guests: number;
  notes?: string;
}

function escapeMarkdown(str: string): string {
  return str.replace(/_/g, '\\_').replace(/\*/g, '\\*').replace(/`/g, '\\`').replace(/~/g, '\\~');
}

export async function sendTelegramBookingNotification(
  env: Record<string, any>,
  booking: TelegramBookingPayload
): Promise<{ sent: boolean; error?: string }> {
  const token = env.TELEGRAM_BOT_TOKEN as string | undefined;
  const chatId = env.TELEGRAM_CHAT_ID as string | undefined;

  if (!token || !chatId) {
    console.warn('Telegram secrets missing — skipping notification');
    return { sent: false, error: 'TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID not configured' };
  }

  const name = escapeMarkdown(booking.name);
  const email = escapeMarkdown(booking.email);
  const phone = booking.phone ? escapeMarkdown(booking.phone) : '—';
  const notes = booking.notes ? escapeMarkdown(booking.notes) : '—';

  const text = [
    `🔥 *New Booking — Hidden Oak*`,
    ``,
    `*ID:* \`${booking.id}\``,
    `*Guest:* ${name}`,
    `*Email:* ${email}`,
    `*Phone:* ${phone}`,
    `*Service:* ${booking.service_label} \\(${booking.price}\\)`,
    `*Date:* ${booking.date}`,
    `*Time:* ${booking.slotLabel}`,
    `*Guests:* ${booking.guests}`,
    `*Notes:* ${notes}`,
    ``,
    `💰 Cash on arrival`,
  ].join('\n');

  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        parse_mode: 'MarkdownV2',
      }),
    });

    if (!res.ok) {
      const errBody = await res.text();
      console.error('Telegram API error:', res.status, errBody);
      return { sent: false, error: `Telegram ${res.status}: ${errBody}` };
    }

    return { sent: true };
  } catch (err: any) {
    console.error('Telegram send failed:', err);
    return { sent: false, error: String(err?.message || err) };
  }
}
