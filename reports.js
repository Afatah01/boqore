// Report generation: data access + Excel (xlsx) and PDF (pdfkit) exports.
import PDFDocument from 'pdfkit';
import XLSX from 'xlsx';
import { db, getSetting } from './db.js';
import { todayEAT } from './lib.js';

export const REPORT_TYPES = ['daily', 'monthly', 'recovery', 'equipment', 'inventory', 'market'];

export function defaultPeriod(type) {
  if (type === 'equipment' || type === 'inventory') return '';
  if (type === 'daily') return todayEAT();
  return todayEAT().slice(0, 7);
}

function num(v, d = 1) {
  return v === null || v === undefined ? '—' : Number(v).toLocaleString('en-US', { maximumFractionDigits: d });
}

export function reportData(type, period) {
  const p = period || defaultPeriod(type);
  switch (type) {
    case 'daily': {
      const rows = db.prepare(
        'SELECT p.*, s.name site_name FROM production p LEFT JOIN mining_sites s ON s.id=p.site_id WHERE p.date=? ORDER BY p.shift'
      ).all(p);
      const tot = db.prepare('SELECT COALESCE(SUM(ore_processed_t),0) o, COALESCE(SUM(gold_recovered_g),0) g FROM production WHERE date=?').get(p);
      return {
        title: 'Daily Production Report', periodLabel: p,
        head: ['Shift', 'Site', 'Ore (t)', 'Head grade (g/t)', 'Concentrate (kg)', 'Gold (g)', 'Recovery (%)', 'Operator'],
        body: rows.map((r) => [r.shift, r.site_name || '—', num(r.ore_processed_t), num(r.head_grade_gpt, 2), num(r.concentrate_weight_kg), num(r.gold_recovered_g), r.recovery_pct !== null ? num(r.recovery_pct) : 'Insufficient Data', r.operator || '—']),
        totals: ['Total', '', num(tot.o), '', '', num(tot.g), '', ''],
      };
    }
    case 'monthly': {
      const rows = db.prepare(
        `SELECT p.date, s.name site_name, SUM(p.ore_processed_t) ore, SUM(p.gold_recovered_g) gold,
                CASE WHEN SUM(p.ore_processed_t*p.head_grade_gpt) > 0 THEN ROUND(SUM(p.gold_recovered_g)*100.0/SUM(p.ore_processed_t*p.head_grade_gpt),1) END rec
         FROM production p LEFT JOIN mining_sites s ON s.id=p.site_id
         WHERE p.date LIKE ? GROUP BY p.date, s.name ORDER BY p.date`
      ).all(p + '%');
      const tot = db.prepare('SELECT COALESCE(SUM(ore_processed_t),0) o, COALESCE(SUM(gold_recovered_g),0) g FROM production WHERE date LIKE ?').get(p + '%');
      return {
        title: 'Monthly Production Report', periodLabel: p,
        head: ['Date', 'Site', 'Ore (t)', 'Gold (g)', 'Recovery (%)'],
        body: rows.map((r) => [r.date, r.site_name || '—', num(r.ore), num(r.gold), r.rec !== null && r.rec !== undefined ? num(r.rec) : '—']),
        totals: ['Total', '', num(tot.o), num(tot.g), ''],
      };
    }
    case 'recovery': {
      const rows = db.prepare('SELECT * FROM processing WHERE date LIKE ? ORDER BY date').all(p + '%');
      const tot = db.prepare(
        'SELECT COALESCE(SUM(ore_feed_t),0) o, COALESCE(SUM(concentrate_kg),0) c, COALESCE(SUM(gold_recovered_g),0) g, COUNT(CASE WHEN recovery_pct IS NULL THEN 1 END) m FROM processing WHERE date LIKE ?'
      ).get(p + '%');
      const rec = tot.g > 0 ? num((rows.reduce((a, r) => a + (r.recovery_pct || 0) * r.gold_recovered_g, 0) / tot.g), 1) : '—';
      return {
        title: 'Gold Recovery Report (Gravity Circuit)', periodLabel: p,
        head: ['Date', 'Ore feed (t)', 'Concentrate (kg)', 'Gold (g)', 'Recovery (%)'],
        body: rows.map((r) => [r.date, num(r.ore_feed_t), num(r.concentrate_kg), num(r.gold_recovered_g), r.recovery_pct !== null ? num(r.recovery_pct) : '—']),
        totals: ['Total', num(tot.o), num(tot.c), num(tot.g), rec],
      };
    }
    case 'equipment': {
      const rows = db.prepare('SELECT * FROM equipment ORDER BY sort_order').all();
      return {
        title: 'Equipment Status Report', periodLabel: 'Current',
        head: ['#', 'Name', 'Model', 'Capacity', 'Power', 'Qty', 'Status', 'Runtime (h)', 'Notes'],
        body: rows.map((r, i) => [i + 1, r.name, r.model || '—', r.capacity || '—', r.power || '—', r.qty, r.status.toUpperCase(), num(r.runtime_h), r.notes || '—']),
      };
    }
    case 'inventory': {
      const rows = db.prepare('SELECT * FROM gold_inventory ORDER BY date DESC, id DESC').all();
      const bal = db.prepare("SELECT COALESCE(SUM(weight_g),0) v FROM gold_inventory WHERE status != 'Sold'").get().v;
      return {
        title: 'Gold Inventory Report', periodLabel: 'Current',
        head: ['Batch', 'Date', 'Weight (g)', 'Karat', 'Purity (%)', 'Status', 'Sold date', 'Sold price (SOS)'],
        body: rows.map((r) => [r.batch_no, r.date, num(r.weight_g, 0), r.karat + 'K', r.purity_pct !== null ? num(r.purity_pct, 1) : '—', r.status, r.sold_date || '—', r.sold_price_sos ? num(r.sold_price_sos, 0) : '—']),
        totals: ['Balance (unsold)', '', num(bal, 0), '', '', '', '', ''],
      };
    }
    case 'market': {
      const rows = db.prepare('SELECT * FROM market_prices WHERE date LIKE ? ORDER BY ts').all(p + '%');
      return {
        title: 'Somaliland Gold Market Price Report', periodLabel: p,
        head: ['Date', 'Time', 'Karat', 'Price (SOS/g)', 'Price (USD/g)', 'Source', 'Type'],
        body: rows.map((r) => [r.date, (r.ts || '').slice(11, 16) || '—', r.karat + 'K', r.price_sos ? Number(r.price_sos).toLocaleString('en-US') : '—', r.price_usd ? num(r.price_usd, 2) : '—', r.source, r.source_type === 'api' ? 'API' : 'Manual']),
      };
    }
    default:
      throw new Error('unknown report type');
  }
}

// ---------------- EXCEL ----------------
export function exportExcel(type, period, user, res) {
  const d = reportData(type, period);
  const demo = getSetting('demo') === '1';
  const aoa = [
    ['BOQORE GOLD TRADE'],
    ['Gold Production & Market Control'],
    [d.title + (d.periodLabel ? ' — ' + d.periodLabel : '')],
    ['Generated ' + new Date().toISOString().replace('T', ' ').slice(0, 16) + ' UTC  ·  by ' + (user?.name || user?.username || 'system')],
    demo ? ['DEMO DATA — sample records for design review, not real business data'] : [],
    [],
    d.head,
    ...d.body,
    ...(d.totals ? [d.totals] : []),
  ];
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  ws['!cols'] = d.head.map((h, i) => ({
    wch: Math.min(40, Math.max(String(h).length + 3, ...d.body.map((r) => String(r[i] ?? '').length + 3))),
  }));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, type.slice(0, 28));
  const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="boqore-${type}-${period || 'now'}.xlsx"`);
  res.send(buf);
}

// ---------------- PDF ----------------
const NAVY = '#101E35';
const GOLD = '#C9920E';
const GRAY = '#6B7280';
const LIGHT = '#F2F5FA';

function drawHeader(doc, d, demo, user) {
  // gold diamond mark
  doc.save();
  doc.fillColor(GOLD);
  doc.moveTo(46, 46).lineTo(58, 52).lineTo(46, 70).lineTo(34, 52).closePath().fill();
  doc.restore();
  doc.font('Helvetica-Bold').fontSize(15).fillColor(NAVY).text('BOQORE GOLD TRADE', 70, 47, { lineBreak: false });
  doc.font('Helvetica').fontSize(8.5).fillColor(GRAY).text('Gold Production & Market Control', 70, 65, { lineBreak: false });
  doc.moveTo(40, 82).lineTo(555, 82).strokeColor(GOLD).lineWidth(1.2).stroke();
  doc.font('Helvetica-Bold').fontSize(12).fillColor(NAVY).text(d.title + (d.periodLabel ? '   —   ' + d.periodLabel : ''), 40, 94);
  doc.font('Helvetica').fontSize(8.5).fillColor(GRAY)
    .text('Generated ' + new Date().toISOString().replace('T', ' ').slice(0, 16) + ' UTC   ·   by ' + (user?.name || user?.username || 'system'), 40, doc.y + 1);
  if (demo) {
    doc.font('Helvetica-Bold').fontSize(9).fillColor('#B45309').text('DEMO DATA — sample records for design review, not real business data.', 40, doc.y + 3);
  }
  doc.y += 12;
}

function drawFooter(doc, demo) {
  const range = doc.bufferedPageRange();
  for (let i = 0; i < range.count; i++) {
    doc.switchToPage(range.start + i);
    doc.font('Helvetica').fontSize(7.5).fillColor(GRAY);
    doc.text('BOQORE GOLD TRADE — Gold Production & Market Control', 40, 814, { align: 'left', lineBreak: false });
    doc.text(`Page ${i + 1} of ${range.count}`, 555, 814, { align: 'right', lineBreak: false });
    if (demo) doc.fillColor(GOLD).font('Helvetica-Bold').text('DEMO DATA', 297, 814, { align: 'center', lineBreak: false });
  }
}

export function exportPdf(type, period, user, res) {
  const d = reportData(type, period);
  const demo = getSetting('demo') === '1';
  const doc = new PDFDocument({ size: 'A4', margin: 40, bufferPages: true });
  const chunks = [];
  doc.on('data', (c) => chunks.push(c));
  doc.on('end', () => {
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="boqore-${type}-${period || 'now'}.pdf"`);
    res.send(Buffer.concat(chunks));
  });

  drawHeader(doc, d, demo, user);

  const pageW = doc.page.width - 80;
  const x0 = 40;
  const maxLen = (i) => Math.max(String(d.head[i]).length, ...d.body.map((r) => String(r[i] ?? '').length), d.totals ? String(d.totals[i] ?? '').length : 0);
  const raw = d.head.map((_, i) => Math.max(5, maxLen(i) + 2));
  const rawTotal = raw.reduce((a, b) => a + b, 0);
  const widths = raw.map((w) => (w / rawTotal) * pageW);

  const ROW_H = 15;
  const bottom = 786;

  const drawHeadRow = (yy) => {
    doc.rect(x0, yy, pageW, ROW_H + 2).fill(NAVY);
    let x = x0;
    d.head.forEach((h, i) => {
      doc.font('Helvetica-Bold').fontSize(7.5).fillColor('#FFFFFF').text(h, x + 4, yy + 4, { width: widths[i] - 8, lineBreak: false, ellipsis: true });
      x += widths[i];
    });
    doc.fillColor('#111827');
    return yy + ROW_H + 2;
  };

  let y = doc.y + 6;
  y = drawHeadRow(y);
  d.body.forEach((row, ri) => {
    if (y > bottom) { doc.addPage(); y = 50; y = drawHeadRow(y); }
    if (ri % 2 === 1) { doc.rect(x0, y, pageW, ROW_H).fill(LIGHT); doc.fillColor('#111827'); }
    let x = x0;
    d.head.forEach((_, i) => {
      doc.font('Helvetica').fontSize(8).fillColor('#111827');
      doc.text(String(row[i] ?? '—'), x + 4, y + 4, { width: widths[i] - 8, lineBreak: false, ellipsis: true });
      x += widths[i];
    });
    y += ROW_H;
  });
  if (d.totals) {
    if (y > bottom) { doc.addPage(); y = 50; }
    doc.moveTo(x0, y).lineTo(x0 + pageW, y).strokeColor(GOLD).lineWidth(1).stroke();
    let x = x0;
    d.totals.forEach((v, i) => {
      doc.font('Helvetica-Bold').fontSize(8).fillColor(NAVY);
      doc.text(String(v ?? ''), x + 4, y + 4, { width: widths[i] - 8, lineBreak: false, ellipsis: true });
      x += widths[i];
    });
    y += ROW_H;
  }

  if (d.body.length === 0) {
    doc.font('Helvetica-Oblique').fontSize(9).fillColor(GRAY).text('No Data — no records found for this period.', x0, y + 8);
  }

  drawFooter(doc, demo);
  doc.end();
}
