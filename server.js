import express from 'express';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { db, getSetting, setSetting, seedIfEmpty } from './db.js';
import { todayEAT, daysAgoEAT, nowEATClock, monthPrefix, prevMonthPrefix, round, verifyPw, hashPw } from './lib.js';
import { REPORT_TYPES, defaultPeriod, reportData, exportExcel, exportPdf } from './reports.js';

const serverDir = path.dirname(fileURLToPath(import.meta.url));
seedIfEmpty();

const app = express();
app.use(express.json());
app.use(express.static(path.join(serverDir, 'public')));

// Keep-alive ping — client pings this while the app is open; each request
// counts as sandbox activity and keeps the preview from sleeping.
app.get('/api/ping', (req, res) => res.json({ ok: true, t: Date.now() }));

const PORT = process.env.PORT || 3000;

// ============================== AUTH ==============================
function secret() {
  return getSetting('secret') || 'boqore-dev-secret';
}
function signToken(uid) {
  const payload = Buffer.from(JSON.stringify({ uid, exp: Date.now() + 7 * 86400000 })).toString('base64url');
  const mac = crypto.createHmac('sha256', secret()).update(payload).digest('base64url');
  return payload + '.' + mac;
}
function verifyToken(tok) {
  if (!tok || !tok.includes('.')) return null;
  const [payload, mac] = tok.split('.');
  const expect = crypto.createHmac('sha256', secret()).update(payload).digest('base64url');
  if (mac.length !== expect.length || !crypto.timingSafeEqual(Buffer.from(mac), Buffer.from(expect))) return null;
  try {
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString());
    if (data.exp < Date.now()) return null;
    return data.uid;
  } catch {
    return null;
  }
}
function parseCookies(req) {
  const out = {};
  for (const part of String(req.headers.cookie || '').split(';')) {
    const i = part.indexOf('=');
    if (i > -1) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}
function currentUser(req) {
  const uid = verifyToken(parseCookies(req).bgt_token);
  if (!uid) return null;
  const u = db.prepare('SELECT id, username, name, role FROM users WHERE id = ? AND active = 1').get(uid);
  return u || null;
}
function requireUser(req, res, next) {
  const u = currentUser(req);
  if (!u) return res.status(401).json({ error: 'unauthorized' });
  req.user = u;
  next();
}
function requireRoles(...roles) {
  return (req, res, next) => {
    const u = currentUser(req);
    if (!u) return res.status(401).json({ error: 'unauthorized' });
    if (!roles.includes(u.role)) return res.status(403).json({ error: 'forbidden' });
    req.user = u;
    next();
  };
}

app.post('/api/auth/login', (req, res) => {
  const { username, password } = req.body || {};
  const u = db.prepare('SELECT * FROM users WHERE username = ? AND active = 1').get(String(username || '').trim());
  if (!u || !verifyPw(password || '', u.password_hash)) {
    return res.status(401).json({ error: 'Invalid username or password' });
  }
  res.cookie('bgt_token', signToken(u.id), { httpOnly: true, sameSite: 'lax', maxAge: 7 * 86400000, path: '/' });
  res.json({ user: { id: u.id, username: u.username, name: u.name, role: u.role } });
});

app.post('/api/auth/logout', (req, res) => {
  res.clearCookie('bgt_token', { path: '/' });
  res.json({ ok: true });
});

app.get('/api/auth/me', (req, res) => {
  const u = currentUser(req);
  if (!u) return res.status(401).json({ error: 'unauthorized' });
  res.json({ user: u });
});

// ============================== STATE / CONFIG ==============================
app.get('/api/state', requireUser, (req, res) => {
  res.json({
    user: req.user,
    company: getSetting('company'),
    tagline: getSetting('tagline'),
    currency: getSetting('currency'),
    logo: getSetting('logo') || null,
    market_source: getSetting('market_source'),
    targets: {
      daily_g: Number(getSetting('daily_target', 0) || 0),
      monthly_g: Number(getSetting('monthly_target', 0) || 0),
      recovery_pct: Number(getSetting('recovery_target', 0) || 0),
    },
  });
});

// ============================== HELPERS ==============================
const sum = (sql, ...p) => db.prepare(sql).get(...p)?.v ?? 0;

function deltaPct(cur, prev) {
  if (prev === null || prev === undefined || prev === 0) return null;
  return round(((cur - prev) / prev) * 100, 1);
}

function fillDays(days, rows, key) {
  const map = new Map(rows.map((r) => [r.date, r]));
  return days.map((d) => {
    const r = map.get(d);
    return r ? { date: d, [key]: r.gold ?? 0, ore: r.ore ?? 0 } : { date: d, [key]: 0, ore: 0 };
  });
}

function lastNDays(n) {
  const out = [];
  for (let i = n - 1; i >= 0; i--) out.push(daysAgoEAT(i));
  return out;
}

// ============================== DASHBOARD ==============================
app.get('/api/dashboard', requireRoles('admin', 'manager'), (req, res) => {
  const t = todayEAT();
  const y = daysAgoEAT(1);
  const ym = monthPrefix(t);
  const pym = prevMonthPrefix(ym);
  const dayOfMonth = Number(t.slice(8, 10));
  const pCut = pym + '-' + String(dayOfMonth).padStart(2, '0');

  const goldToday = sum('SELECT COALESCE(SUM(gold_recovered_g),0) v FROM production WHERE date = ?', t);
  const goldYest = sum('SELECT COALESCE(SUM(gold_recovered_g),0) v FROM production WHERE date = ?', y);
  const goldMonth = sum('SELECT COALESCE(SUM(gold_recovered_g),0) v FROM production WHERE date LIKE ?', ym + '%');
  const goldPrevMonthSameDays = sum(
    'SELECT COALESCE(SUM(gold_recovered_g),0) v FROM production WHERE date >= ? AND date <= ?', pym + '-01', pCut
  );
  const oreToday = sum('SELECT COALESCE(SUM(ore_processed_t),0) v FROM production WHERE date = ?', t);
  const oreYest = sum('SELECT COALESCE(SUM(ore_processed_t),0) v FROM production WHERE date = ?', y);

  const rec = db.prepare(
    `SELECT COALESCE(SUM(gold_recovered_g),0) g,
            COALESCE(SUM(CASE WHEN head_grade_gpt IS NOT NULL THEN ore_processed_t * head_grade_gpt ELSE 0 END),0) est,
            COUNT(CASE WHEN head_grade_gpt IS NULL THEN 1 END) missing,
            COUNT(*) n
     FROM production WHERE date = ?`
  ).get(t);
  const recoveryToday = rec.est > 0 && rec.missing === 0 ? round((rec.g / rec.est) * 100, 1) : null;

  const recPrev = db.prepare(
    `SELECT COALESCE(SUM(gold_recovered_g),0) g,
            COALESCE(SUM(CASE WHEN head_grade_gpt IS NOT NULL THEN ore_processed_t * head_grade_gpt ELSE 0 END),0) est,
            COUNT(CASE WHEN head_grade_gpt IS NULL THEN 1 END) missing
     FROM production WHERE date = ?`
  ).get(y);
  const recoveryYest = recPrev.est > 0 && recPrev.missing === 0 ? (recPrev.g / recPrev.est) * 100 : null;

  const inv = db.prepare(
    `SELECT COALESCE(SUM(weight_g),0) w, COUNT(*) n FROM gold_inventory WHERE status != 'Sold'`
  ).get();

  // Market (external) — latest 22K
  const mkt = db.prepare('SELECT * FROM market_prices WHERE karat = 22 ORDER BY ts DESC LIMIT 1').get();
  const mktPrev = mkt
    ? db.prepare('SELECT * FROM market_prices WHERE karat = 22 AND ts < ? ORDER BY ts DESC LIMIT 1').get(mkt.ts)
    : null;
  const mktDelta = mkt && mktPrev ? deltaPct(mkt.price_sos, mktPrev.price_sos) : null;
  const karatPrices = [24, 22, 21, 18].map((k) => {
    const r = db.prepare('SELECT * FROM market_prices WHERE karat = ? ORDER BY ts DESC LIMIT 1').get(k);
    return r ? { karat: k, price_sos: r.price_sos, price_usd: r.price_usd, ts: r.ts } : { karat: k, price_sos: null };
  });

  // Series
  const days30 = lastNDays(30);
  const prodRows = db.prepare(
    'SELECT date, SUM(gold_recovered_g) gold, SUM(ore_processed_t) ore FROM production WHERE date >= ? GROUP BY date'
  ).all(days30[0]);
  const production30 = fillDays(days30, prodRows, 'gold');

  const mktRows = db.prepare(
    'SELECT date, MAX(price_sos) gold FROM market_prices WHERE karat = 22 AND date >= ? GROUP BY date'
  ).all(days30[0]);
  const market30 = fillDays(days30, mktRows, 'price');

  const proc30 = db
    .prepare('SELECT date, ore_feed_t ore, concentrate_kg conc, gold_recovered_g gold, recovery_pct rec FROM processing WHERE date >= ? ORDER BY date')
    .all(days30[0]);
  const recovery30 = days30.map((d) => proc30.find((r) => r.date === d) || null);

  const procToday = db.prepare('SELECT * FROM processing WHERE date = ?').get(t) || null;

  const plant = db.prepare('SELECT * FROM plant_stages ORDER BY position').all();
  const eqStatus = db.prepare('SELECT status, COUNT(*) n FROM equipment GROUP BY status').all();

  // ---- Alerts (computed live from real data)
  const alerts = [];
  const dailyTarget = Number(getSetting('daily_target', 0) || 0);
  const recTarget = Number(getSetting('recovery_target', 0) || 0);

  if (rec.n === 0) {
    alerts.push({ level: 'warning', category: 'Production', message: 'No production recorded today yet' });
  } else if (dailyTarget > 0) {
    if (goldToday >= dailyTarget) {
      alerts.push({ level: 'ok', category: 'Production', message: `Daily target achieved — ${round(goldToday, 1)} g of ${dailyTarget} g` });
    } else if (goldToday >= dailyTarget * 0.9) {
      alerts.push({ level: 'warning', category: 'Production', message: `Production below target — ${round(goldToday, 1)} g of ${dailyTarget} g` });
    } else {
      alerts.push({ level: 'critical', category: 'Production', message: `Production significantly below target — ${round(goldToday, 1)} g of ${dailyTarget} g` });
    }
  }

  if (recoveryToday !== null && recTarget > 0) {
    if (recoveryToday >= recTarget) {
      alerts.push({ level: 'ok', category: 'Recovery', message: `Recovery on target — ${recoveryToday}% (target ${recTarget}%)` });
    } else if (recoveryToday >= recTarget - 10) {
      alerts.push({ level: 'warning', category: 'Recovery', message: `Recovery below target — ${recoveryToday}% (target ${recTarget}%)` });
    } else {
      alerts.push({ level: 'critical', category: 'Recovery', message: `Recovery significantly below normal — ${recoveryToday}% (target ${recTarget}%)` });
    }
  }

  for (const e of db.prepare("SELECT name, notes FROM equipment WHERE status = 'stopped'").all()) {
    alerts.push({ level: 'critical', category: 'Equipment', message: `${e.name} stopped` });
  }
  for (const e of db.prepare("SELECT name, notes FROM equipment WHERE status = 'attention'").all()) {
    alerts.push({ level: 'warning', category: 'Equipment', message: `${e.name} requires attention${e.notes ? ' — ' + e.notes : ''}` });
  }

  if (mkt && mktDelta !== null) {
    if (mktDelta > 0.5) alerts.push({ level: 'ok', category: 'Market', message: `Somaliland gold price up ${mktDelta}% vs previous reading` });
    else if (mktDelta <= -2) alerts.push({ level: 'critical', category: 'Market', message: `Somaliland gold price down ${Math.abs(mktDelta)}% vs previous reading` });
  }

  // Stored (unresolved) alerts
  for (const a of db.prepare('SELECT level, category, message, created_at FROM alerts WHERE resolved = 0 ORDER BY created_at DESC').all()) {
    alerts.push({ ...a, stored: true });
  }

  const lastUpdRows = db.prepare(
    'SELECT MAX(created_at) v FROM production UNION ALL SELECT MAX(ts) FROM market_prices'
  ).all();
  const lastUpdated = lastUpdRows.map((r) => r.v).filter(Boolean).sort().pop() || null;

  res.json({
    today: t,
    lastUpdated,
    kpis: {
      goldToday_g: round(goldToday, 1),
      goldTodayDelta_pct: deltaPct(goldToday, goldYest),
      goldMonth_g: round(goldMonth, 1),
      goldMonthDelta_pct: deltaPct(goldMonth, goldPrevMonthSameDays),
      oreToday_t: round(oreToday, 1),
      oreTodayDelta_pct: deltaPct(oreToday, oreYest),
      recoveryToday_pct: recoveryToday,
      recoveryDelta_pp: recoveryToday !== null && recoveryYest !== null ? round(recoveryToday - recoveryYest, 1) : null,
      inventory_kg: round(inv.w / 1000, 2),
      inventory_batches: inv.n,
      market: mkt
        ? {
            price_sos: mkt.price_sos, karat: 22, delta_pct: mktDelta,
            ts: mkt.ts, source: mkt.source, live: mkt.source_type === 'api',
            usd_per_g: mkt.price_usd,
          }
        : null,
    },
    targets: { daily_g: dailyTarget, recovery_pct: recTarget, monthly_g: Number(getSetting('monthly_target', 0) || 0) },
    production30,
    market30,
    recovery30,
    recoveryToday: procToday,
    karatPrices,
    plant,
    equipmentSummary: eqStatus,
    alerts,
  });
});

// ============================== PRODUCTION ==============================
app.get('/api/production', requireUser, (req, res) => {
  const { from, to, site, shift } = req.query;
  let sql = `
    SELECT p.*, s.name site_name FROM production p
    LEFT JOIN mining_sites s ON s.id = p.site_id WHERE 1=1`;
  const p = [];
  if (from) { sql += ' AND p.date >= ?'; p.push(from); }
  if (to) { sql += ' AND p.date <= ?'; p.push(to); }
  if (site) { sql += ' AND p.site_id = ?'; p.push(Number(site)); }
  if (shift) { sql += ' AND p.shift = ?'; p.push(shift); }
  sql += ' ORDER BY p.date DESC, p.shift DESC';
  const rows = db.prepare(sql).all(...p);
  const sites = db.prepare('SELECT * FROM mining_sites ORDER BY name').all();
  let tot;
  {
    let tsql = `SELECT COALESCE(SUM(ore_processed_t),0) ore, COALESCE(SUM(gold_recovered_g),0) gold,
      COALESCE(SUM(CASE WHEN head_grade_gpt IS NOT NULL THEN ore_processed_t*head_grade_gpt END),0) est,
      COUNT(CASE WHEN head_grade_gpt IS NULL THEN 1 END) missing, COUNT(*) n
      FROM production WHERE 1=1`;
    const tp = [];
    if (from) { tsql += ' AND date >= ?'; tp.push(from); }
    if (to) { tsql += ' AND date <= ?'; tp.push(to); }
    if (site) { tsql += ' AND site_id = ?'; tp.push(Number(site)); }
    if (shift) { tsql += ' AND shift = ?'; tp.push(shift); }
    tot = db.prepare(tsql).get(...tp);
  }
  res.json({
    rows,
    sites,
    totals: {
      ore: round(tot.ore, 1), gold: round(tot.gold, 1),
      recovery_pct: tot.est > 0 && tot.missing === 0 ? round((tot.gold / tot.est) * 100, 1) : null,
      n: tot.n,
    },
  });
});

app.post('/api/production', requireRoles('admin', 'manager', 'operator'), (req, res) => {
  const b = req.body || {};
  if (!b.date) return res.status(400).json({ error: 'Date is required' });
  const ore = Number(b.ore_processed_t) || 0;
  const grade = b.head_grade_gpt === '' || b.head_grade_gpt == null ? null : Number(b.head_grade_gpt);
  const gold = Number(b.gold_recovered_g) || 0;
  const recovery =
    grade && ore > 0 && gold > 0
      ? round((gold / (ore * grade)) * 100, 1)
      : b.recovery_pct ? Number(b.recovery_pct) : null;
  const info = db.prepare(`INSERT INTO production
    (date, site_id, shift, ore_processed_t, head_grade_gpt, concentrate_weight_kg, gold_recovered_g, recovery_pct, operator, notes)
    VALUES(?,?,?,?,?,?,?,?,?,?)`).run(
    b.date,
    b.site_id ? Number(b.site_id) : null,
    b.shift || 'Day',
    ore,
    grade,
    b.concentrate_weight_kg === '' || b.concentrate_weight_kg == null ? null : Number(b.concentrate_weight_kg),
    gold,
    recovery,
    b.operator || req.user.name,
    b.notes || ''
  );
  // keep daily gravity summary in sync
  const d = db.prepare(
    `SELECT COALESCE(SUM(ore_processed_t),0) ore, COALESCE(SUM(concentrate_weight_kg),0) conc,
            COALESCE(SUM(gold_recovered_g),0) gold,
            COALESCE(SUM(CASE WHEN head_grade_gpt IS NOT NULL THEN ore_processed_t*head_grade_gpt END),0) est,
            COUNT(CASE WHEN head_grade_gpt IS NULL THEN 1 END) missing
     FROM production WHERE date = ?`
  ).get(b.date);
  db.prepare('INSERT INTO processing(date, ore_feed_t, concentrate_kg, gold_recovered_g, recovery_pct) VALUES(?,?,?,?,?) ON CONFLICT(date) DO UPDATE SET ore_feed_t=excluded.ore_feed_t, concentrate_kg=excluded.concentrate_kg, gold_recovered_g=excluded.gold_recovered_g, recovery_pct=excluded.recovery_pct')
    .run(b.date, round(d.ore, 1), round(d.conc, 1), round(d.gold, 1), d.est > 0 && d.missing === 0 ? round((d.gold / d.est) * 100, 1) : null);
  res.json({ id: info.lastInsertRowid, ok: true });
});

app.put('/api/production/:id', requireRoles('admin', 'manager', 'operator'), (req, res) => {
  const row = db.prepare('SELECT * FROM production WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Not found' });
  const b = req.body || {};
  const ore = b.ore_processed_t !== undefined ? Number(b.ore_processed_t) || 0 : row.ore_processed_t;
  const grade = b.head_grade_gpt !== undefined ? (b.head_grade_gpt === '' || b.head_grade_gpt == null ? null : Number(b.head_grade_gpt)) : row.head_grade_gpt;
  const gold = b.gold_recovered_g !== undefined ? Number(b.gold_recovered_g) || 0 : row.gold_recovered_g;
  const recovery = grade && ore > 0 && gold > 0 ? round((gold / (ore * grade)) * 100, 1) : row.recovery_pct;
  db.prepare(`UPDATE production SET date=?, site_id=?, shift=?, ore_processed_t=?, head_grade_gpt=?, concentrate_weight_kg=?, gold_recovered_g=?, recovery_pct=?, operator=?, notes=? WHERE id=?`)
    .run(
      b.date || row.date,
      b.site_id !== undefined ? (b.site_id ? Number(b.site_id) : null) : row.site_id,
      b.shift || row.shift,
      ore,
      grade,
      b.concentrate_weight_kg !== undefined ? (b.concentrate_weight_kg === '' || b.concentrate_weight_kg == null ? null : Number(b.concentrate_weight_kg)) : row.concentrate_weight_kg,
      gold,
      recovery,
      b.operator !== undefined ? b.operator : row.operator,
      b.notes !== undefined ? b.notes : row.notes,
      row.id
    );
  res.json({ ok: true });
});

app.delete('/api/production/:id', requireRoles('admin', 'manager'), (req, res) => {
  const info = db.prepare('DELETE FROM production WHERE id = ?').run(Number(req.params.id));
  if (info.changes === 0) return res.status(404).json({ error: 'Record not found' });
  res.json({ ok: true });
});

// ============================== PLANT (processing stages) ==============================
app.get('/api/plant', requireUser, (req, res) => {
  const stages = db.prepare('SELECT * FROM plant_stages ORDER BY position').all();
  const processing = db.prepare('SELECT * FROM processing ORDER BY date DESC LIMIT 90').all().reverse();
  res.json({ stages, processing });
});

app.patch('/api/plant/stages/:id', requireRoles('admin', 'manager', 'operator'), (req, res) => {
  const { status, runtime_h, note, feed, output } = req.body || {};
  db.prepare('UPDATE plant_stages SET status = COALESCE(?, status), runtime_h = COALESCE(?, runtime_h), note = COALESCE(?, note), feed = COALESCE(?, feed), output = COALESCE(?, output) WHERE id = ?')
    .run(status || null, runtime_h !== undefined ? Number(runtime_h) : null, note || null, feed || null, output || null, req.params.id);
  res.json({ ok: true });
});

// ============================== EQUIPMENT ==============================
app.get('/api/equipment', requireUser, (req, res) => {
  const rows = db.prepare('SELECT * FROM equipment ORDER BY sort_order').all();
  for (const r of rows) r.extra = r.extra ? JSON.parse(r.extra) : {};
  res.json({ rows });
});

app.post('/api/equipment', requireRoles('admin', 'manager'), (req, res) => {
  const b = req.body || {};
  const name = String(b.name || '').trim();
  if (!name) return res.status(400).json({ error: 'name required' });
  const dup = db.prepare('SELECT id FROM equipment WHERE name = ?').get(name);
  if (dup) return res.status(400).json({ error: 'An equipment with that name already exists' });
  const qty = Math.max(1, parseInt(b.qty, 10) || 1);
  const extra = b.extra && typeof b.extra === 'object' ? JSON.stringify(b.extra) : null;
  const so = db.prepare('SELECT COALESCE(MAX(sort_order),0)+1 n FROM equipment').get().n;
  db.prepare(
    'INSERT INTO equipment(name, model, capacity, power, qty, extra, status, sort_order) VALUES(?,?,?,?,?,?,?,?)'
  ).run(name, String(b.model || '').trim(), String(b.capacity || '').trim(), String(b.power || '').trim(), qty, extra, 'offline', so);
  res.json({ ok: true });
});

app.delete('/api/equipment/:id', requireRoles('admin'), (req, res) => {
  const info = db.prepare('DELETE FROM equipment WHERE id = ?').run(Number(req.params.id));
  if (info.changes === 0) return res.status(404).json({ error: 'Equipment not found' });
  res.json({ ok: true });
});

app.patch('/api/equipment/:id', requireRoles('admin', 'manager', 'operator'), (req, res) => {
  const { status, runtime_h, notes } = req.body || {};
  const prev = db.prepare('SELECT * FROM equipment WHERE id = ?').get(req.params.id);
  if (!prev) return res.status(404).json({ error: 'Not found' });
  db.prepare('UPDATE equipment SET status = COALESCE(?, status), runtime_h = COALESCE(?, runtime_h), notes = COALESCE(?, notes) WHERE id = ?')
    .run(status || null, runtime_h !== undefined ? Number(runtime_h) : null, notes !== undefined ? notes : null, req.params.id);
  // store lifecycle alerts
  if (status && status !== prev.status) {
    if (status === 'stopped') {
      db.prepare("INSERT INTO alerts(level, category, message) VALUES('critical','Equipment',?)").run(`${prev.name} stopped`);
    } else if (status === 'attention') {
      db.prepare("INSERT INTO alerts(level, category, message) VALUES('warning','Equipment',?)").run(`${prev.name} requires attention`);
    } else {
      db.prepare("UPDATE alerts SET resolved = 1 WHERE resolved = 0 AND category = 'Equipment' AND message LIKE ?").run('%' + prev.name + '%');
    }
  }
  res.json({ ok: true });
});

// ============================== GOLD INVENTORY ==============================
app.get('/api/gold', requireRoles('admin', 'manager'), (req, res) => {
  const batches = db.prepare('SELECT * FROM gold_inventory ORDER BY date DESC, id DESC').all();
  const agg = (status) => sum('SELECT COALESCE(SUM(weight_g),0) v FROM gold_inventory WHERE status = ?', status);
  const recoveredTotal = sum('SELECT COALESCE(SUM(gold_recovered_g),0) v FROM processing');
  const sold = agg('Sold');
  const inStore = agg('In Storage') + agg('Refined');
  const refining = agg('Refining') + agg('In Processing');
  const conc = sum('SELECT COALESCE(SUM(concentrate_kg),0) v FROM processing');
  res.json({
    batches,
    summary: {
      recovered_total_g: round(recoveredTotal, 1),
      in_storage_g: round(inStore, 1),
      refining_g: round(refining, 1),
      sold_g: round(sold, 1),
      balance_g: round(inStore + refining, 1),
      concentrate_kg: round(conc, 1),
    },
  });
});

app.post('/api/gold', requireRoles('admin', 'manager'), (req, res) => {
  const b = req.body || {};
  if (!b.batch_no || !b.date || !b.weight_g) return res.status(400).json({ error: 'batch_no, date and weight_g are required' });
  const info = db.prepare(`INSERT INTO gold_inventory
    (batch_no, date, weight_g, karat, purity_pct, status, notes)
    VALUES(?,?,?,?,?,?,?)`).run(
    b.batch_no, b.date, Number(b.weight_g),
    Number(b.karat) || 22,
    b.purity_pct === '' || b.purity_pct == null ? null : Number(b.purity_pct),
    b.status || 'In Storage',
    b.notes || ''
  );
  res.json({ id: info.lastInsertRowid, ok: true });
});

app.patch('/api/gold/:id', requireRoles('admin', 'manager'), (req, res) => {
  const row = db.prepare('SELECT * FROM gold_inventory WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Not found' });
  const b = req.body || {};
  db.prepare(`UPDATE gold_inventory SET status=?, sold_date=?, sold_price_sos=?, sold_price_usd=?, notes=? WHERE id=?`)
    .run(b.status || row.status, b.sold_date || null, b.sold_price_sos === undefined ? null : b.sold_price_sos, b.sold_price_usd === undefined ? null : b.sold_price_usd, b.notes !== undefined ? b.notes : row.notes, row.id);
  res.json({ ok: true });
});

app.delete('/api/gold/:id', requireRoles('admin', 'manager'), (req, res) => {
  const info = db.prepare('DELETE FROM gold_inventory WHERE id = ?').run(Number(req.params.id));
  if (info.changes === 0) return res.status(404).json({ error: 'Batch not found' });
  res.json({ ok: true });
});

// ============================== MARKET (external Somaliland prices) ==============================
app.get('/api/market', requireRoles('admin', 'manager'), (req, res) => {
  const range = Number(req.query.range || 30);
  const from = daysAgoEAT(range - 1);
  const rows = db.prepare(
    'SELECT * FROM market_prices WHERE date >= ? ORDER BY ts ASC'
  ).all(from);
  const latest = [24, 22, 21, 18].map((k) => {
    const r = db.prepare('SELECT * FROM market_prices WHERE karat = ? ORDER BY ts DESC LIMIT 1').get(k);
    const p = r ? db.prepare('SELECT * FROM market_prices WHERE karat = ? AND ts < ? ORDER BY ts DESC LIMIT 1').get(k, r.ts) : null;
    return r
      ? {
          karat: k, price_sos: r.price_sos, price_usd: r.price_usd, ts: r.ts, date: r.date,
          delta_pct: p ? deltaPct(r.price_sos, p.price_sos) : null,
          live: r.source_type === 'api', source: r.source,
        }
      : { karat: k, price_sos: null, delta_pct: null, live: false };
  });
  // series for 22K
  const byDate = new Map();
  for (const r of rows) {
    if (r.karat === 22) byDate.set(r.date, r);
  }
  const days = lastNDays(range);
  const series = days.map((d) => (byDate.has(d) ? { id: byDate.get(d).id, date: d, price_sos: byDate.get(d).price_sos } : { date: d, price_sos: null }));
  const vals = series.filter((s) => s.price_sos != null).map((s) => s.price_sos);
  const stats = vals.length
    ? {
        high: Math.max(...vals), low: Math.min(...vals),
        avg: round(vals.reduce((a, b) => a + b, 0) / vals.length, 0),
        change_pct: vals.length > 1 ? deltaPct(vals[vals.length - 1], vals[0]) : null,
        current: vals[vals.length - 1],
      }
    : null;
  res.json({ latest, series, stats, source: getSetting('market_source'), source_type: 'manual' });
});

app.post('/api/market', requireRoles('admin'), (req, res) => {
  const b = req.body || {};
  if (!b.price_sos || !b.karat) return res.status(400).json({ error: 'price_sos and karat are required' });
  const now = new Date();
  db.prepare(`INSERT INTO market_prices
    (ts, date, karat, price_sos, price_usd, currency, unit, source, source_type, created_by)
    VALUES(?,?,?,?,?,?,?,?,?,?)`).run(
    todayEAT() + 'T' + nowEATClock(now),
    todayEAT(),
    Number(b.karat),
    Number(b.price_sos),
    b.price_usd === '' || b.price_usd == null ? null : Number(b.price_usd),
    b.currency || 'SOS',
    b.unit || 'gram',
    b.source || getSetting('market_source') || 'Local Somaliland Market',
    'manual',
    req.user.username
  );
  res.json({ ok: true });
});

app.delete('/api/market/:id', requireRoles('admin'), (req, res) => {
  const info = db.prepare('DELETE FROM market_prices WHERE id = ?').run(Number(req.params.id));
  if (info.changes === 0) return res.status(404).json({ error: 'Price record not found' });
  res.json({ ok: true });
});

// ============================== REPORTS (data only — export UI later) ==============================
app.get('/api/reports', requireRoles('admin', 'manager'), (req, res) => {
  const type = req.query.type;
  const period = req.query.period || todayEAT(); // YYYY-MM or YYYY-MM-DD
  const out = { type, period, rows: [], totals: {} };
  if (type === 'daily') {
    out.rows = db.prepare(
      `SELECT p.*, s.name site_name FROM production p LEFT JOIN mining_sites s ON s.id=p.site_id
       WHERE p.date = ? ORDER BY p.shift`
    ).all(period);
    out.totals = db.prepare('SELECT SUM(ore_processed_t) ore, SUM(gold_recovered_g) gold FROM production WHERE date = ?').get(period);
  } else if (type === 'monthly') {
    out.rows = db.prepare(
      `SELECT p.date, s.name site_name, SUM(p.ore_processed_t) ore, SUM(p.gold_recovered_g) gold,
              CASE WHEN SUM(p.ore_processed_t*p.head_grade_gpt) > 0 THEN ROUND(SUM(p.gold_recovered_g)*100.0/SUM(p.ore_processed_t*p.head_grade_gpt),1) END rec
       FROM production p LEFT JOIN mining_sites s ON s.id=p.site_id
       WHERE p.date LIKE ? GROUP BY p.date, s.name ORDER BY p.date`
    ).all(period + '%');
    out.totals = db.prepare('SELECT SUM(ore_processed_t) ore, SUM(gold_recovered_g) gold FROM production WHERE date LIKE ?').get(period + '%');
  } else if (type === 'recovery') {
    out.rows = db.prepare('SELECT * FROM processing WHERE date LIKE ? ORDER BY date').all(period + '%');
  } else if (type === 'equipment') {
    out.rows = db.prepare('SELECT * FROM equipment ORDER BY sort_order').all();
  } else if (type === 'inventory') {
    out.rows = db.prepare('SELECT * FROM gold_inventory ORDER BY date DESC').all();
  } else if (type === 'market') {
    out.rows = db.prepare('SELECT * FROM market_prices WHERE date LIKE ? ORDER BY ts').all(period + '%');
  }
  db.prepare('INSERT INTO reports(type, period, format, generated_by) VALUES(?,?,?,?)').run(type, period, 'view', req.user.username);
  res.json(out);
});

// Report export: Excel (.xlsx) or PDF
app.get('/api/reports/export', requireRoles('admin', 'manager'), (req, res) => {
  const type = String(req.query.type || '');
  const format = String(req.query.format || 'pdf').toLowerCase();
  const period = req.query.period ? String(req.query.period) : defaultPeriod(type);
  if (!REPORT_TYPES.includes(type)) return res.status(400).json({ error: 'Unknown report type' });
  if (format !== 'pdf' && format !== 'excel' && format !== 'xlsx') return res.status(400).json({ error: 'Unknown format' });
  try {
    db.prepare('INSERT INTO reports(type, period, format, generated_by) VALUES(?,?,?,?)').run(type, period, format, req.user.username);
    if (format === 'pdf') exportPdf(type, period, req.user, res);
    else exportExcel(type, period, req.user, res);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ============================== SETTINGS ==============================
app.get('/api/settings', requireRoles('admin'), (req, res) => {
  res.json({
    company: getSetting('company'),
    tagline: getSetting('tagline'),
    currency: getSetting('currency'),
    logo: getSetting('logo') || null,
    daily_target: getSetting('daily_target'),
    monthly_target: getSetting('monthly_target'),
    recovery_target: getSetting('recovery_target'),
    market_source: getSetting('market_source'),
    sites: db.prepare('SELECT * FROM mining_sites ORDER BY name').all(),
    equipment: db.prepare('SELECT * FROM equipment ORDER BY sort_order').all(),
    users: db.prepare('SELECT id, username, name, role, active FROM users ORDER BY id').all(),
  });
});

app.post('/api/settings', requireRoles('admin'), (req, res) => {
  const b = req.body || {};
  for (const k of ['company', 'tagline', 'currency', 'daily_target', 'monthly_target', 'recovery_target', 'market_source']) {
    if (b[k] !== undefined) setSetting(k, b[k]);
  }
  if (b.logo !== undefined) setSetting('logo', b.logo || '');
  if (b.site) {
    if (b.site.id) db.prepare('UPDATE mining_sites SET name=?, location=?, status=? WHERE id=?').run(b.site.name, b.site.location || '', b.site.status || 'Active', b.site.id);
    else db.prepare('INSERT INTO mining_sites(name, location, status) VALUES(?,?,?)').run(b.site.name, b.site.location || '', b.site.status || 'Active');
  }
  if (b.user) {
    if (b.user.id) {
      db.prepare('UPDATE users SET name=?, role=?, active=? WHERE id=?').run(b.user.name, b.user.role, b.user.active ? 1 : 0, b.user.id);
      if (b.user.password) db.prepare('UPDATE users SET password_hash=? WHERE id=?').run(hashPw(b.user.password), b.user.id);
    } else {
      if (!b.user.username || !b.user.password) return res.status(400).json({ error: 'username and password required' });
      db.prepare('INSERT INTO users(username, password_hash, name, role) VALUES(?,?,?,?)').run(b.user.username, hashPw(b.user.password), b.user.name || b.user.username, b.user.role || 'operator');
    }
  }
  res.json({ ok: true });
});

app.delete('/api/settings/site/:id', requireRoles('admin'), (req, res) => {
  const info = db.prepare('DELETE FROM mining_sites WHERE id = ?').run(Number(req.params.id));
  if (info.changes === 0) return res.status(404).json({ error: 'Site not found' });
  res.json({ ok: true });
});

// SPA fallback
app.get(/^\/(?!api).*/, (req, res) => res.sendFile(path.join(serverDir, 'public', 'index.html')));

// 404 for unknown API routes
app.use('/api', (req, res) => res.status(404).json({ error: 'Not found' }));

// Central error handler — a bad request must never crash the server
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error('[api error]', req.method, req.path, err.message);
  if (res.headersSent) return;
  res.status(500).json({ error: err.message || 'Internal server error' });
});

process.on('uncaughtException', (err) => {
  console.error('[uncaught]', err.message);
});

// Start the HTTP server only when run directly (`node server.js`).
// When imported by the Netlify function wrapper, the request lifecycle is
// handled by the platform instead.
const isMain = process.argv[1] && process.argv[1] === fileURLToPath(import.meta.url);
if (isMain) {
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`BOQORE GOLD TRADE running on http://0.0.0.0:${PORT}`);
  });
}

export default app;
