import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { hashPw } from './lib.js';
import { seedDemo } from './seed.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
fs.mkdirSync(path.join(__dirname, 'data'), { recursive: true });

export const db = new Database(path.join(__dirname, 'data', 'boqore.db'));
db.pragma('journal_mode = WAL');

export function ensureSchema() {
  db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  name TEXT,
  role TEXT NOT NULL CHECK(role IN ('admin','manager','operator')),
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS mining_sites (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  location TEXT,
  status TEXT NOT NULL DEFAULT 'Active'
);

CREATE TABLE IF NOT EXISTS production (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  date TEXT NOT NULL,                      -- YYYY-MM-DD (Hargeysa time)
  site_id INTEGER REFERENCES mining_sites(id),
  shift TEXT NOT NULL DEFAULT 'Day',       -- Day / Night
  ore_processed_t REAL NOT NULL DEFAULT 0,
  head_grade_gpt REAL,                     -- grams of gold per tonne of ore
  concentrate_weight_kg REAL,
  gold_recovered_g REAL NOT NULL DEFAULT 0,
  recovery_pct REAL,
  operator TEXT,
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_production_date ON production(date);

-- Daily gravity-recovery performance (processing plant)
CREATE TABLE IF NOT EXISTS processing (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  date TEXT NOT NULL UNIQUE,
  ore_feed_t REAL NOT NULL DEFAULT 0,
  concentrate_kg REAL NOT NULL DEFAULT 0,
  gold_recovered_g REAL NOT NULL DEFAULT 0,
  recovery_pct REAL,
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS equipment (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  model TEXT,
  capacity TEXT,
  power TEXT,
  qty INTEGER NOT NULL DEFAULT 1,
  extra TEXT,            -- extra spec lines as JSON {label: value}
  status TEXT NOT NULL DEFAULT 'offline' CHECK(status IN ('running','attention','stopped','offline')),
  runtime_h REAL,
  notes TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS plant_stages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  position INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'offline' CHECK(status IN ('running','attention','stopped','offline','idle')),
  runtime_h REAL,
  feed TEXT,
  output TEXT,
  note TEXT
);

CREATE TABLE IF NOT EXISTS gold_inventory (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  batch_no TEXT UNIQUE NOT NULL,
  date TEXT NOT NULL,
  weight_g REAL NOT NULL DEFAULT 0,
  karat INTEGER NOT NULL DEFAULT 22,       -- 24 / 22 / 21 / 18
  purity_pct REAL,
  status TEXT NOT NULL DEFAULT 'In Storage' CHECK(status IN ('In Storage','Refining','Refined','Sold','In Processing')),
  sold_date TEXT,
  sold_price_sos REAL,
  sold_price_usd REAL,
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- External Somaliland market price records (NEVER mixed with production data)
CREATE TABLE IF NOT EXISTS market_prices (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts TEXT NOT NULL,                        -- observation timestamp (local)
  date TEXT NOT NULL,
  karat INTEGER NOT NULL,
  price_sos REAL,
  price_usd REAL,
  currency TEXT NOT NULL DEFAULT 'SOS',
  unit TEXT NOT NULL DEFAULT 'gram',
  source TEXT NOT NULL DEFAULT 'Local Somaliland Market',
  source_type TEXT NOT NULL DEFAULT 'manual' CHECK(source_type IN ('manual','api')),
  created_by TEXT
);
CREATE INDEX IF NOT EXISTS idx_market_date_karat ON market_prices(date, karat);

CREATE TABLE IF NOT EXISTS alerts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  level TEXT NOT NULL CHECK(level IN ('ok','warning','critical')),
  category TEXT NOT NULL,
  message TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  resolved INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS reports (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  type TEXT NOT NULL,
  period TEXT,
  format TEXT,
  generated_by TEXT,
  generated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT
);
`);
}

export function getSetting(key, dflt = null) {
  const r = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  return r ? r.value : dflt;
}

export function setSetting(key, value) {
  db.prepare(
    'INSERT INTO settings(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
  ).run(key, String(value));
}

export function seedIfEmpty() {
  ensureSchema();
  const hasUsers = db.prepare('SELECT COUNT(*) c FROM users').get().c > 0;
  if (!hasUsers) {
    const ins = db.prepare(
      'INSERT INTO users(username, password_hash, name, role) VALUES(?,?,?,?)'
    );
    ins.run('admin', hashPw('boqore2026'), 'Aadan Boqore', 'admin');
    ins.run('manager', hashPw('boqore2026'), 'Sara Mohamed', 'manager');
    ins.run('operator', hashPw('boqore2026'), 'Liban Hussein', 'operator');
  }
  if (!getSetting('company')) {
    setSetting('company', 'BOQORE GOLD TRADE');
    setSetting('tagline', 'Gold Production & Market Control');
    setSetting('currency', 'SOS');
    setSetting('daily_target', '320');     // grams per day
    setSetting('monthly_target', '9000');  // grams per month
    setSetting('recovery_target', '85');   // percent
    setSetting('market_source', 'Local Somaliland Market');
    setSetting('secret', crypto.randomBytes(32).toString('hex'));
    setSetting('demo', '1');
  }
  const hasProd = db.prepare('SELECT COUNT(*) c FROM production').get().c > 0;
  if (!hasProd && getSetting('demo') === '1') {
    seedDemo();
  }
}

export function clearDemoData() {
  const tx = db.transaction(() => {
    for (const t of ['production','processing','gold_inventory','market_prices','alerts','reports','equipment','plant_stages','mining_sites']) {
      db.prepare(`DELETE FROM ${t}`).run();
    }
  });
  tx();
  setSetting('demo', '0');
}
