// DEMO DATA GENERATOR
// Clearly-labelled sample data used only to demonstrate the interface.
// It can be wiped from Settings -> "Clear demo data" to start with real records.
import { db } from './db.js';
import { todayEAT, daysAgoEAT, round } from './lib.js';

function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function seedDemo() {
  const rnd = mulberry32(20260913);
  const today = todayEAT();

  // ---- Mining sites
  const insSite = db.prepare('INSERT INTO mining_sites(name, location, status) VALUES(?,?,?)');
  const siteIds = [
    insSite.run('Site A — Hargeysa', 'Hargeysa, Woqooyi Galbeed', 'Active').lastInsertRowid,
    insSite.run('Site B — Burao', 'Burao, Togdheer', 'Active').lastInsertRowid,
    insSite.run('Site C — Cal Miskaad', 'Cal Miskaad, Woqooyi Galbeed', 'Active').lastInsertRowid,
  ];

  // ---- Production + processing (30 days)
  const insProd = db.prepare(`INSERT INTO production
    (date, site_id, shift, ore_processed_t, head_grade_gpt, concentrate_weight_kg, gold_recovered_g, recovery_pct, operator, notes)
    VALUES(?,?,?,?,?,?,?,?,?,?)`);
  const insProc = db.prepare(`INSERT OR REPLACE INTO processing
    (date, ore_feed_t, concentrate_kg, gold_recovered_g, recovery_pct) VALUES(?,?,?,?,?)`);
  const operators = ['A. Warsame', 'H. Ali', 'M. Ahmed', 'S. Yusuf'];

  const dailyGold = {};
  function addShift(date, ore, grade, rec, shift = 'Day') {
    const site = siteIds[Math.floor(rnd() * siteIds.length)];
    const gold = round(ore * grade * (rec / 100), 1);
    const conc = round(ore * 6.5 * (0.9 + rnd() * 0.2), 1); // ~0.65% of ore mass as concentrate
    insProd.run(date, site, shift, ore, grade, conc, gold, rec, operators[Math.floor(rnd() * operators.length)], '');
    dailyGold[date] = (dailyGold[date] || 0) + gold;
    return { ore, gold, conc, est: ore * grade };
  }

  // 28 regular days (29..2 days ago)
  for (let i = 29; i >= 2; i--) {
    const date = daysAgoEAT(i);
    let oT = 0, gT = 0, cT = 0, eT = 0;
    const shifts = ['Day'];
    if (rnd() < 0.65) shifts.push('Night');
    for (const shift of shifts) {
      const ore = round(7.5 + rnd() * 4, 1);
      const grade = round(15.5 + rnd() * 6, 2);
      const rec = round(77.5 + rnd() * 10, 1);
      const r = addShift(date, ore, grade, rec, shift);
      oT += r.ore; gT += r.gold; cT += r.conc; eT += r.est;
    }
    insProc.run(date, round(oT, 1), round(cT, 1), round(gT, 1), round((gT / eT) * 100, 1));
  }

  // Yesterday (fixed values)
  const yd = daysAgoEAT(1);
  let oT = 0, gT = 0, cT = 0, eT = 0;
  for (const [shift, ore, grade, rec] of [['Day', 9.6, 20.5, 84.3], ['Night', 8.3, 20.7, 85.0]]) {
    const r = addShift(yd, ore, grade, rec, shift);
    oT += r.ore; gT += r.gold; cT += r.conc; eT += r.est;
  }
  insProc.run(yd, round(oT, 1), round(cT, 1), round(gT, 1), round((gT / eT) * 100, 1));

  // Today (fixed values: 18.6 t ore, ~327 g gold, ~83% recovery)
  oT = 0; gT = 0; cT = 0; eT = 0;
  for (const [shift, ore, grade, rec] of [['Day', 10.0, 21.0, 83.0], ['Night', 8.6, 21.5, 83.5]]) {
    const r = addShift(today, ore, grade, rec, shift);
    oT += r.ore; gT += r.gold; cT += r.conc; eT += r.est;
  }
  insProc.run(today, round(oT, 1), round(cT, 1), round(gT, 1), round((gT / eT) * 100, 1));

  // ---- Market prices (external, 30 days, 24K + 22K)
  const insMkt = db.prepare(`INSERT INTO market_prices
    (ts, date, karat, price_sos, price_usd, currency, unit, source, source_type, created_by)
    VALUES(?,?,?,?,?,?,?,?,?,?)`);
  let p24 = 2238000;
  const usdPerG24 = 106.1; // USD reference per gram of 24K gold
  const priceByDate = {};
  for (let i = 29; i >= 0; i--) {
    const date = i === 0 ? today : daysAgoEAT(i);
    p24 = p24 * (1 + (rnd() - 0.44) * 0.014);
    if (i === 1) p24 = 2308000;
    if (i === 0) p24 = 2350000; // +1.8% vs previous day
    priceByDate[date] = { p24, p22: (p24 * 22) / 24 };
    for (const karat of [24, 22, 21, 18]) {
      const price = (p24 * karat) / 24;
      insMkt.run(
        date + 'T14:05', date, karat,
        Math.round(price), round((usdPerG24 * karat) / 24, 2),
        'SOS', 'gram', 'Local Somaliland Market', 'manual', 'admin'
      );
    }
  }

  // ---- Gold inventory batches (group every 3 days)
  const insGold = db.prepare(`INSERT INTO gold_inventory
    (batch_no, date, weight_g, karat, purity_pct, status, sold_date, sold_price_sos, sold_price_usd, notes)
    VALUES(?,?,?,?,?,?,?,?,?,?)`);
  const dates = Object.keys(dailyGold).sort();
  let n = 0;
  for (let i = 0; i < dates.length; i += 3) {
    const chunk = dates.slice(i, i + 3);
    const weight = round(chunk.reduce((s, d) => s + dailyGold[d], 0), 0);
    const date = chunk[chunk.length - 1];
    n++;
    const batchNo = 'BG-2026-' + String(n).padStart(3, '0');
    let status = 'In Storage', soldDate = null, soldSos = null, soldUsd = null;
    if (n <= 2) {
      status = 'Sold';
      soldDate = daysAgoEAT(Math.max(1, Math.floor((dates.length - i) / 3) - 1) || 1);
      const px = priceByDate[date] ? priceByDate[date].p22 : 2150000;
      soldSos = round(weight * px * 0.995, 0);
      soldUsd = round(weight * 97.2, 0);
    } else if (n === dates.length / 3) {
      status = 'Refining';
    }
    insGold.run(batchNo, date, weight, 22, 91.7, status, soldDate, soldSos, soldUsd, status === 'Sold' ? 'Sold to local buyer (recorded transaction)' : '');
  }

  // ---- Equipment (per uploaded specifications)
  const insEq = db.prepare(`INSERT INTO equipment
    (name, model, capacity, power, qty, extra, status, runtime_h, notes, sort_order)
    VALUES(?,?,?,?,?,?,?,?,?,?)`);
  const eq = [
    ['Jaw Crusher', 'PE250 × 400', '5–20 t/h', '15 kW', 1, '{"Feed opening":"250 × 400 mm"}', 'running', 6.5, 'Primary crushing — feeding hammer crusher', 1],
    ['Hammer Crusher', 'PC400 × 300', '5–10 t/h', '≈ 4–11 kW', 1, '{"Discharge":"0–10 mm"}', 'attention', 4.2, 'Belt wear — inspect before night shift', 2],
    ['Belt Conveyor', 'B40 × 6 m', '≈ 1.3–1.6 m/s', '0.55 kW', 2, '{"Belt width":"400 mm"}', 'running', 6.5, 'Crusher to mill transfer', 3],
    ['Vibrating Feeder', 'GZ1', '≈ 5 t/h', '60 W', 1, '{"Type":"vibrating"}', 'running', 6.5, 'Ore feed into jaw crusher', 4],
    ['Ball Mill', 'Ø900 × 1800', '≈ 0.65–2 t/h', '18.5 kW', 1, '{"Grinding":"wet, steel media"}', 'running', 6.5, 'Grinding to slurry for gravity circuit', 5],
    ['Gravity Concentrator', 'STLB20', '≈ 1–3 TPH', '1.5 kW', 1, '{"Feed size":"0–2 mm"}', 'running', 5.8, 'Spiral / gravity concentration', 6],
    ['Shaking Table', '6-S', '≈ 4450 mm length', '0.37 kW', 1, '{"Plates":"6 sections"}', 'running', 5.8, 'Final gravity separation', 7],
    ['Process Pump', '2-inch', '≈ 20 m³/h', '0.75 kW', 2, '{"Type":"submersible"}', 'running', 6.5, 'Slurry transfer', 8],
    ['Generator', '30 kW', '30 kW', 'diesel', 1, '{"Type":"standby + peak"}', 'running', 6.5, 'Main power supply', 9],
  ];
  for (const e of eq) insEq.run(...e);

  // ---- Processing plant stages (gravity separation workflow)
  const insStage = db.prepare(`INSERT INTO plant_stages
    (name, position, status, runtime_h, feed, output, note) VALUES(?,?,?,?,?,?,?)`);
  const stages = [
    ['Ore Feed', 1, 'running', 6.5, '18.6 t today', 'to feeder', 'Truck-fed alluvial ore'],
    ['Vibrating Feeder', 2, 'running', 6.5, '18.6 t/h feed', 'to jaw crusher', 'Even feed rate'],
    ['Jaw Crusher', 3, 'running', 6.5, 'lumps', '≈ 25 mm', 'Primary reduction'],
    ['Hammer Crusher', 4, 'attention', 4.2, '≈ 25 mm', '0–10 mm', 'Belt wear — check before night shift'],
    ['Belt Conveyor', 5, 'running', 6.5, 'crushed ore', 'to ball mill', '2 units in service'],
    ['Ball Mill', 6, 'running', 6.5, '0–10 mm ore', 'slurry -325 mesh', 'Wet grinding'],
    ['Gravity Concentrator', 7, 'running', 5.8, 'slurry', 'concentrate', 'STLB20 in circuit'],
    ['Shaking Table', 8, 'running', 5.8, 'concentrate', 'high-grade mat', '6-S final separation'],
    ['Gold Concentrate', 9, 'idle', null, '—', '≈ 126 kg today', 'Material stage — awaiting batch record'],
    ['Recovered Gold', 10, 'idle', null, '—', '≈ 327 g today', 'Material stage — to inventory'],
  ];
  for (const s of stages) insStage.run(...s);
}
