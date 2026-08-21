-- Hidden Oak bookings — D1 schema
-- Run: npx wrangler d1 execute hidden-oak-bookings --file=scripts/init-d1.sql
-- Or:  npx wrangler d1 execute hidden-oak-bookings --local --file=scripts/init-d1.sql

CREATE TABLE IF NOT EXISTS bookings (
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
);

CREATE INDEX IF NOT EXISTS idx_bookings_date_slot ON bookings(date, slot);
CREATE INDEX IF NOT EXISTS idx_bookings_date ON bookings(date);
CREATE INDEX IF NOT EXISTS idx_bookings_status ON bookings(status);
CREATE INDEX IF NOT EXISTS idx_bookings_email ON bookings(email);
