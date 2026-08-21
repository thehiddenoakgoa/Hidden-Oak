/**
 * bookings.ts — Shared booking logic for all Pages Functions.
 *
 * Storage abstraction:
 *  1. Cloudflare D1 (preferred) — SQL, durable, queryable. Binding `DB`
 *  2. KV namespace `BOOKINGS_KV` — JSON blob fallback
 *  3. In-memory Map — ephemeral, for local dev before any binding is created
 *
 * All helpers are synchronous in shape but async where storage is involved.
 */

export type ServiceId = 'without_ice' | 'contrast_sound';
export type BookingStatus = 'pending' | 'confirmed' | 'cancelled' | 'completed' | 'no-show';

export interface Booking {
  id: string;
  created_at: string; // ISO
  updated_at: string; // ISO
  name: string;
  email: string;
  phone?: string;
  service: ServiceId;
  service_label: string;
  date: string; // YYYY-MM-DD (IST calendar date)
  slot: string; // e.g. "18:00"
  guests: number;
  notes?: string;
  status: BookingStatus;
  // denormalised convenience
  price_label?: string;
}

export interface CreateBookingInput {
  name: string;
  email: string;
  phone?: string;
  service: ServiceId;
  date: string;
  slot: string;
  guests?: number;
  notes?: string;
  website?: string; // honeypot
}

// ---- Constants matching the site's offer ---------------------------------
export const SERVICES: Record<ServiceId, { label: string; price: string; duration: string }> = {
  without_ice: { label: 'Without Ice Bath', price: '₹1,000', duration: '~75 min' },
  contrast_sound: { label: 'Contrast Therapy & Sound Healing', price: '₹1,500', duration: '~90 min' },
};

export const SLOTS = ['18:00', '19:30', '21:00', '22:30'] as const;
export const GUESTS_MIN = 1;
export const GUESTS_MAX = 6;
export const DEFAULT_CAPACITY = 8; // guests per slot

export function slotLabel(slot: string): string {
  // "18:00" -> "06:00 PM"
  const [h, m] = slot.split(':').map(Number);
  const d = new Date(Date.UTC(2000, 0, 1, h, m));
  return d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true, timeZone: 'Asia/Kolkata' });
}

export function isValidDateStr(s: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(s) && !isNaN(Date.parse(s + 'T12:00:00'));
}

export function isPastDateIST(dateStr: string): boolean {
  // Compare dateStr to today in IST
  const todayIST = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' }); // YYYY-MM-DD
  return dateStr < todayIST;
}

export function isValidSlot(slot: string): boolean {
  return (SLOTS as readonly string[]).includes(slot);
}

export function isValidService(s: string): s is ServiceId {
  return s === 'without_ice' || s === 'contrast_sound';
}

export function isValidStatus(s: string): s is BookingStatus {
  return ['pending', 'confirmed', 'cancelled', 'completed', 'no-show'].includes(s);
}

export function generateId(): string {
  // short readable id: e.g. HO-20260828-A3F9
  const d = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' }).replace(/-/g, '');
  const rand = Math.random().toString(36).slice(2, 6).toUpperCase().padEnd(4, '0');
  return `HO-${d}-${rand}`;
}

export function escapeHtml(str: string): string {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

// ---- Storage abstraction ---------------------------------------------------
type Env = Record<string, any>;

const MEMORY_KEY = '__hidden_oak_bookings_memory__';

function getMemory(): Booking[] {
  const g: any = globalThis as any;
  if (!g[MEMORY_KEY]) g[MEMORY_KEY] = [];
  return g[MEMORY_KEY] as Booking[];
}

async function d1Init(env: Env): Promise<void> {
  if (!env.DB) return;
  try {
    await env.DB.prepare(
      `CREATE TABLE IF NOT EXISTS bookings (
        id TEXT PRIMARY KEY,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        name TEXT NOT NULL,
        email TEXT NOT NULL,
        phone TEXT,
        service TEXT NOT NULL,
        service_label TEXT NOT NULL,
        date TEXT NOT NULL,
        slot TEXT NOT NULL,
        guests INTEGER NOT NULL,
        notes TEXT,
        status TEXT NOT NULL
      )`
    ).run();
    // index for availability queries
    await env.DB.prepare(`CREATE INDEX IF NOT EXISTS idx_bookings_date_slot ON bookings(date, slot)`).run();
    await env.DB.prepare(`CREATE INDEX IF NOT EXISTS idx_bookings_date ON bookings(date)`).run();
  } catch (e) {
    console.error('D1 init failed', e);
  }
}

export async function listBookings(env: Env): Promise<Booking[]> {
  if (env.DB) {
    try {
      await d1Init(env);
      const res = await env.DB.prepare(`SELECT * FROM bookings ORDER BY date DESC, slot ASC, created_at DESC`).all();
      return (res.results as Booking[]) || [];
    } catch (e) {
      console.error('D1 list failed, falling back', e);
    }
  }
  if (env.BOOKINGS_KV) {
    try {
      const raw = await env.BOOKINGS_KV.get('bookings', 'json');
      if (Array.isArray(raw)) return raw as Booking[];
      if (typeof raw === 'string') return JSON.parse(raw) as Booking[];
      return [];
    } catch (e) {
      console.error('KV list failed', e);
      return [];
    }
  }
  return [...getMemory()];
}

export async function saveBookings(env: Env, bookings: Booking[]): Promise<void> {
  if (env.BOOKINGS_KV) {
    try {
      await env.BOOKINGS_KV.put('bookings', JSON.stringify(bookings));
      return;
    } catch (e) {
      console.error('KV save failed', e);
    }
  }
  // in-memory fallback: mutate global
  const mem = getMemory();
  mem.length = 0;
  mem.push(...bookings);
}

export async function getBookingById(env: Env, id: string): Promise<Booking | null> {
  if (env.DB) {
    try {
      await d1Init(env);
      const row = await env.DB.prepare(`SELECT * FROM bookings WHERE id = ? LIMIT 1`).bind(id).first();
      return (row as Booking) || null;
    } catch (e) {
      console.error('D1 get by id failed', e);
    }
  }
  const all = await listBookings(env);
  return all.find((b) => b.id === id) || null;
}

export async function createBooking(env: Env, input: Booking): Promise<void> {
  if (env.DB) {
    try {
      await d1Init(env);
      await env.DB.prepare(
        `INSERT INTO bookings (id, created_at, updated_at, name, email, phone, service, service_label, date, slot, guests, notes, status)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
        .bind(
          input.id,
          input.created_at,
          input.updated_at,
          input.name,
          input.email,
          input.phone || null,
          input.service,
          input.service_label,
          input.date,
          input.slot,
          input.guests,
          input.notes || null,
          input.status
        )
        .run();
      return;
    } catch (e) {
      console.error('D1 insert failed, falling back to KV/memory', e);
    }
  }
  const all = await listBookings(env);
  all.unshift(input);
  await saveBookings(env, all);
}

export async function updateBooking(env: Env, id: string, patch: Partial<Booking>): Promise<Booking | null> {
  if (env.DB) {
    try {
      await d1Init(env);
      const existing = await getBookingById(env, id);
      if (!existing) return null;
      const merged = { ...existing, ...patch, updated_at: new Date().toISOString() } as Booking;
      // Simple approach: delete+insert or update columns
      const fields: string[] = [];
      const values: any[] = [];
      if (patch.status !== undefined) { fields.push('status = ?'); values.push(patch.status); }
      if (patch.notes !== undefined) { fields.push('notes = ?'); values.push(patch.notes); }
      // generic updated_at
      fields.push('updated_at = ?');
      values.push(merged.updated_at);
      if (fields.length) {
        values.push(id);
        await env.DB.prepare(`UPDATE bookings SET ${fields.join(', ')} WHERE id = ?`).bind(...values).run();
      }
      return merged;
    } catch (e) {
      console.error('D1 update failed', e);
    }
  }
  const all = await listBookings(env);
  const idx = all.findIndex((b) => b.id === id);
  if (idx === -1) return null;
  const updated = { ...all[idx], ...patch, updated_at: new Date().toISOString() } as Booking;
  all[idx] = updated;
  await saveBookings(env, all);
  return updated;
}

export async function deleteBooking(env: Env, id: string): Promise<boolean> {
  if (env.DB) {
    try {
      await d1Init(env);
      const res = await env.DB.prepare(`DELETE FROM bookings WHERE id = ?`).bind(id).run();
      // D1 run result has meta.changes
      return ((res as any).meta?.changes ?? 0) > 0;
    } catch (e) {
      console.error('D1 delete failed', e);
    }
  }
  const all = await listBookings(env);
  const filtered = all.filter((b) => b.id !== id);
  if (filtered.length === all.length) return false;
  await saveBookings(env, filtered);
  return true;
}

export function capacityForSlot(env: Env): number {
  const raw = env.SLOT_CAPACITY || env.BOOKINGS_CAPACITY;
  const n = parseInt(String(raw || ''), 10);
  if (!isNaN(n) && n > 0) return n;
  return DEFAULT_CAPACITY;
}

export async function availabilityForDate(env: Env, dateStr: string): Promise<Array<{ slot: string; label: string; taken: number; remaining: number; capacity: number; full: boolean }>> {
  const all = await listBookings(env);
  const capacity = capacityForSlot(env);
  // only count pending/confirmed (cancelled/no-show shouldn't block)
  const blockStatuses: BookingStatus[] = ['pending', 'confirmed'];
  return SLOTS.map((slot) => {
    const taken = all
      .filter((b) => b.date === dateStr && b.slot === slot && blockStatuses.includes(b.status))
      .reduce((sum, b) => sum + (b.guests || 1), 0);
    const remaining = Math.max(0, capacity - taken);
    return { slot, label: slotLabel(slot), taken, remaining, capacity, full: remaining <= 0 };
  });
}

export async function isSlotAvailable(env: Env, dateStr: string, slot: string, guests: number): Promise<{ ok: boolean; remaining: number; capacity: number }> {
  const avail = await availabilityForDate(env, dateStr);
  const info = avail.find((a) => a.slot === slot);
  if (!info) return { ok: false, remaining: 0, capacity: capacityForSlot(env) };
  return { ok: info.remaining >= guests, remaining: info.remaining, capacity: info.capacity };
}
