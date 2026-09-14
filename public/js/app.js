/* ============================================================
   BOQORE GOLD TRADE — frontend application (complete)
   ============================================================ */
'use strict';

const appEl = document.getElementById('app');
const state = { user: null, cfg: null, route: 'dashboard', charts: [] };

// Keep the live preview awake while this tab is open (even in the background).
// Each ping is a real request to the server, which keeps the sandbox active.
setInterval(() => {
  fetch('/api/ping', { cache: 'no-store' }).catch(() => { /* offline — ignore */ });
}, 40000);

/* ---------------- API helper (retries transient network/server blips) ---------------- */
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function api(path, opts = {}) {
  let lastErr = new Error('Cannot reach the server');
  for (let attempt = 0; attempt < 4; attempt++) {
    if (attempt) await sleep(1200 * attempt); // 1.2s, 2.4s, 3.6s back-off
    let res;
    try {
      res = await fetch(path, {
        headers: { 'Content-Type': 'application/json' },
        ...opts,
        body: opts.body ? JSON.stringify(opts.body) : undefined,
      });
    } catch (e) {
      lastErr = new Error('Cannot reach the server — please try again in a few seconds');
      continue; // network failure: retry
    }
    if (res.status >= 500) {
      lastErr = new Error('Server is waking up — please try again in a few seconds');
      continue; // transient server error: retry
    }
    if (res.status === 401) {
      state.user = null;
      showLogin();
      throw new Error('unauthorized');
    }
    if (!res.ok) {
      let msg = res.statusText;
      try { msg = (await res.json()).error || msg; } catch { /* ignore */ }
      throw new Error(msg); // real client error (4xx): do not retry
    }
    return res.json();
  }
  throw lastErr;
}

/* ---------------- Formatters ---------------- */
const nf = (n, d = 0) =>
  n === null || n === undefined || Number.isNaN(Number(n))
    ? '—'
    : Number(n).toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
const gStr = (g, d = 1) => (g === null || g === undefined ? 'No Data' : `${nf(g, d)} g`);
const kgStr = (g, d = 2) => (g === null || g === undefined || g === 0 ? 'No Data' : `${nf(g / 1000, d)} kg`);
const localDateStr = (d = new Date()) =>
  d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
const addDaysStr = (s, n) => {
  const d = new Date(s + 'T12:00:00');
  d.setDate(d.getDate() + n);
  return localDateStr(d);
};
const dateShort = (d) => {
  if (!d) return '—';
  const dt = new Date(String(d).length === 10 ? d + 'T12:00:00' : d);
  return dt.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
};
const dateLong = (d) =>
  new Date(String(d).length === 10 ? d + 'T12:00:00' : d).toLocaleDateString('en-GB', {
    weekday: 'short', day: 'numeric', month: 'short', year: 'numeric',
  });
const timeOf = (d) => {
  const m = String(d || '').match(/T(\d{2}:\d{2})/);
  return m ? m[1] : '';
};
const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const initials = (name) => String(name || '?').split(/\s+/).map((w) => w[0]).slice(0, 2).join('').toUpperCase();
const today = () => localDateStr();
const thisMonth = () => today().slice(0, 7);
const can = (...roles) => roles.includes(state.user.role);

/* ---------------- Toast ---------------- */
function toast(msg, ok = true) {
  const t = document.createElement('div');
  t.className = 'toast ' + (ok ? 'ok' : 'err');
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => { t.classList.add('show'); }, 10);
  setTimeout(() => { t.classList.remove('show'); setTimeout(() => t.remove(), 300); }, 3400);
}

/* ---------------- Modal ---------------- */
function closeModal() { document.getElementById('modalBackdrop')?.remove(); }
function openModal(title, bodyHtml, wide = false) {
  closeModal();
  const bd = document.createElement('div');
  bd.className = 'modal-backdrop';
  bd.id = 'modalBackdrop';
  bd.innerHTML = `<div class="modal ${wide ? 'wide' : ''}">
    <h3>${title}<button class="x" type="button" id="modalX">×</button></h3>
    <div id="modalBody">${bodyHtml}</div></div>`;
  document.body.appendChild(bd);
  bd.addEventListener('click', (e) => { if (e.target === bd) closeModal(); });
  document.getElementById('modalX').addEventListener('click', closeModal);
  return document.getElementById('modalBody');
}
function kvRows(pairs) {
  return `<table class="kv"><tbody>${pairs.map(([k, v]) => `<tr><td>${esc(k)}</td><td>${v}</td></tr>`).join('')}</tbody></table>`;
}

/* ---------------- Navigation ---------------- */
const NAV = [
  { id: 'dashboard', ico: '🏠', label: 'Dashboard', roles: ['admin', 'manager'] },
  { id: 'production', ico: '⛏️', label: 'Production', roles: ['admin', 'manager', 'operator'] },
  { id: 'plant', ico: '⚙️', label: 'Processing Plant', roles: ['admin', 'manager', 'operator'] },
  { id: 'equipment', ico: '🏭', label: 'Equipment', roles: ['admin', 'manager', 'operator'] },
  { id: 'gold', ico: '🪙', label: 'Gold', roles: ['admin', 'manager'] },
  { id: 'market', ico: '📈', label: 'Market Price', roles: ['admin', 'manager'] },
  { id: 'reports', ico: '📊', label: 'Reports', roles: ['admin', 'manager'] },
  { id: 'settings', ico: '⚙️', label: 'Settings', roles: ['admin'] },
];

/* ---------------- Login ---------------- */
async function showLogin(err) {
  window.onhashchange = null;
  // Demo helpers (one-tap login + hint) are only shown while demo mode is on.
  const ping = await api('/api/ping').catch(() => null);
  const isDemo = !!(ping && ping.demo);
  appEl.innerHTML = `
  <div class="login-wrap">
    <div class="login-card">
      <img class="login-logo" src="${state.cfg?.logo || '/img/logo.svg'}" alt="BOQORE GOLD TRADE">
      <h1>BOQORE GOLD TRADE</h1>
      <div class="login-sub">Gold Production &amp; Market Control</div>
      ${err ? `<div class="form-err">${esc(err)}</div>` : ''}
      <form class="login-form" id="loginForm">
        <label>Username
          <input name="username" autocomplete="username" required>
        </label>
        <label>Password
          <input name="password" type="password" autocomplete="current-password" required>
        </label>
        <button class="btn primary" type="submit" style="margin-top:6px">Sign in</button>
        ${isDemo ? `<button class="btn ghost" type="button" id="demoLogin">Use demo admin login</button>` : ''}
      </form>
      ${isDemo ? `<div class="login-hint">Demo accounts: <b>admin</b> · <b>manager</b> · <b>operator</b> — password <b>boqore2026</b></div>` : ''}
    </div>
  </div>`;
  const doLogin = async (u, p) => {
    const btn = document.querySelector('#loginForm .btn.primary');
    const demoBtn = document.getElementById('demoLogin');
    if (btn) { btn.disabled = true; btn.textContent = 'Signing in…'; }
    if (demoBtn) demoBtn.disabled = true;
    try {
      const r = await api('/api/auth/login', { method: 'POST', body: { username: u, password: p } });
      state.user = r.user;
      state.cfg = await api('/api/state');
      window.onhashchange = () => route();
      route();
    } catch (e) {
      showLogin(e.message === 'unauthorized' ? 'Invalid username or password' : e.message);
    }
  };
  document.getElementById('loginForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const f = e.target;
    doLogin(f.username.value, f.password.value);
  });
  const demoBtn = document.getElementById('demoLogin');
  if (demoBtn) demoBtn.addEventListener('click', () => doLogin('admin', 'boqore2026'));
}

/* ---------------- App shell ---------------- */
function shell(pageTitle, crumb) {
  const u = state.user;
  const nav = NAV.filter((n) => n.roles.includes(u.role));
  const logo = state.cfg?.logo || '/img/logo.svg';
  appEl.innerHTML = `
  <div class="app">
    <aside class="sidebar">
      <div class="brand">
        <img class="brand-logo" src="${logo}" alt="">
        <div>
          <div class="brand-name">BOQORE GOLD TRADE</div>
          <div class="brand-sub">Gold Production &amp; Market Control</div>
        </div>
      </div>
      <div class="side-divider"></div>
      <nav>
        <div class="nav-section">Control Center</div>
        ${nav.map((n) => `
          <a class="nav-item ${state.route === n.id ? 'active' : ''}" href="#/${n.id}">
            <span class="ico">${n.ico}</span>${n.label}
          </a>`).join('')}
      </nav>
      <div class="side-foot">
        <div class="side-user">
          <div class="avatar">${initials(u.name)}</div>
          <div>
            <div class="u-name">${esc(u.name)}</div>
            <div class="u-role">${u.role}</div>
          </div>
        </div>
        <button class="btn ghost sm icon" id="logoutBtn" style="width:100%">Sign out</button>
      </div>
    </aside>
    <main class="content">
      <header class="topbar">
        <div>
          <div class="page-crumb">${esc(crumb || 'BOQORE GOLD TRADE')}</div>
          <div class="page-title">${esc(pageTitle)}</div>
        </div>
        <div class="topbar-right">
          <div class="tb-item"><span class="tb-label">Today</span><span class="tb-value">${dateLong(today())}</span></div>
          <div class="tb-item"><span class="tb-label">Last Updated</span><span class="tb-value" id="tbUpd">—</span></div>
          <div class="tb-user">
            <div class="avatar">${initials(u.name)}</div>
            <div><div class="u-name">${esc(u.name)}</div><div class="u-role">${u.role}</div></div>
          </div>
        </div>
      </header>
      ${state.cfg?.demo ? `
      <div class="demo-banner">
        <span>⚠️</span>
        <span><b>DEMO DATA</b> &nbsp;Sample records for design review — not real production or market values.</span>
        ${can('admin') ? '<a href="#/settings">Clear in Settings →</a>' : ''}
      </div>` : ''}
      <div id="page"></div>
    </main>
  </div>`;
  document.getElementById('logoutBtn').addEventListener('click', async () => {
    try { await api('/api/auth/logout', { method: 'POST' }); } catch { /* ignore */ }
    state.user = null;
    showLogin();
  });
  return document.getElementById('page');
}
function destroyCharts() {
  state.charts.forEach((c) => { try { c.destroy(); } catch { /* ignore */ } });
  state.charts = [];
}

/* ---------------- Chart helpers ---------------- */
Chart.defaults.font.family = "'Inter', sans-serif";
Chart.defaults.color = '#94a3b8';
Chart.defaults.borderColor = 'rgba(148,163,184,0.08)';

function baseOpts(extra = {}) {
  return {
    responsive: true,
    maintainAspectRatio: false,
    interaction: { mode: 'index', intersect: false },
    plugins: {
      legend: { display: false },
      tooltip: {
        backgroundColor: '#13233d', borderColor: 'rgba(148,163,184,0.2)', borderWidth: 1,
        titleColor: '#f4f7fb', bodyColor: '#cbd5e1', padding: 10, cornerRadius: 8,
      },
    },
    ...extra,
  };
}
const track = (c) => { state.charts.push(c); return c; };
function setTopbarUpdated(v) {
  const el = document.getElementById('tbUpd');
  if (el) el.textContent = v ? `${dateShort(v)} ${timeOf(v)}` : '—';
}

function deltaBadge(v, suffix = '%') {
  if (v === null || v === undefined) return '';
  const up = v > 0, flat = v === 0;
  const cls = flat ? 'flat' : up ? 'up' : 'down';
  const arrow = flat ? '■' : up ? '▲' : '▼';
  return `<span class="delta ${cls}">${arrow} ${Math.abs(v)}${suffix}</span>`;
}

function kpiCard(o) {
  const value = o.value ?? 'No Data';
  const noData = value === 'No Data' || value === '—';
  return `
  <div class="kpi ${o.market ? 'market' : ''}">
    <div class="kpi-top">
      <span class="kpi-label">${o.label}</span>
      <span class="kpi-ico">${o.ico || ''}</span>
    </div>
    ${noData
      ? `<div class="no-data">No Data</div>`
      : `<div class="kpi-value ${o.tone || ''}">${o.valueHtml || esc(o.value)} ${o.unit ? `<span class="unit">${esc(o.unit)}</span>` : ''}</div>`}
    ${o.foot || ''}
  </div>`;
}

/* ============================================================
   DASHBOARD
   ============================================================ */
async function pageDashboard() {
  const page = shell('Dashboard', 'Control Center');
  page.innerHTML = '<div class="loading"><div class="spinner"></div>Loading control center…</div>';
  let d;
  try { d = await api('/api/dashboard'); } catch (e) { page.innerHTML = `<div class="form-err">${esc(e.message)}</div>`; return; }

  setTopbarUpdated(d.lastUpdated);
  const k = d.kpis;
  const mkt = k.market;
  const noGold30 = d.production30.every((r) => r.gold === 0);

  page.innerHTML = `
  <div class="kpi-grid">
    ${kpiCard({
      label: 'Gold — Today', ico: '🪙',
      value: k.goldToday_g > 0 ? gStr(k.goldToday_g) : (noGold30 ? 'No Data' : '0 g'),
      foot: `<div class="kpi-foot">${deltaBadge(k.goldTodayDelta_pct)}<span class="kpi-sub">vs yesterday</span></div>`,
    })}
    ${kpiCard({
      label: 'Gold — This Month', ico: '📅',
      value: k.goldMonth_g > 0 ? kgStr(k.goldMonth_g) : 'No Data',
      foot: `<div class="kpi-foot">${deltaBadge(k.goldMonthDelta_pct)}<span class="kpi-sub">vs same days last month</span></div>`,
    })}
    ${kpiCard({
      label: 'Ore Processed', ico: '⛏️',
      value: k.oreToday_t > 0 ? `${nf(k.oreToday_t, 1)} t` : 'No Data',
      foot: `<div class="kpi-foot">${deltaBadge(k.oreTodayDelta_pct)}<span class="kpi-sub">today</span></div>`,
    })}
    ${kpiCard({
      label: 'Recovery Rate', ico: '⚗️',
      value: k.recoveryToday_pct !== null ? nf(k.recoveryToday_pct, 1) : 'No Data',
      unit: k.recoveryToday_pct !== null ? '%' : '',
      tone: k.recoveryToday_pct !== null && k.targets?.recovery_pct > 0 && k.recoveryToday_pct < k.targets.recovery_pct ? 'amber' : '',
      foot: `<div class="kpi-foot">${deltaBadge(k.recoveryDelta_pp, ' pp')}<span class="kpi-sub">${k.targets?.recovery_pct ? 'target ' + k.targets.recovery_pct + '%' : 'gravity circuit'}</span></div>`,
    })}
    ${kpiCard({
      label: 'Gold Inventory', ico: '🏦',
      value: k.inventory_kg > 0 ? nf(k.inventory_kg, 2) : 'No Data',
      unit: k.inventory_kg > 0 ? 'kg' : '',
      foot: `<div class="kpi-foot"><span class="kpi-sub">${k.inventory_batches} batch${k.inventory_batches === 1 ? '' : 'es'} in store</span></div>`,
    })}
    ${kpiCard({
      label: 'Somaliland Gold Price', ico: '📈', market: true,
      value: mkt ? nf(mkt.price_sos) : 'No Data',
      unit: mkt ? 'SOS/g' : '',
      foot: mkt
        ? `<div class="kpi-foot">${deltaBadge(mkt.delta_pct)}<span class="kpi-sub">22K · ${mkt.live ? 'Live' : 'Manually Updated'} ${timeOf(mkt.ts)}</span></div>`
        : '<div class="kpi-foot"><span class="kpi-sub">No market price recorded</span></div>',
    })}
  </div>

  <div class="row-2">
    <div class="panel">
      <div class="panel-head">
        <div class="panel-title">Gold Production — Last 30 Days</div>
        <span class="tag ops">Our Operation</span>
      </div>
      <div class="chart-box"><canvas id="prodChart"></canvas></div>
      <div class="panel-foot">
        <span>Actual gold recovered by our gravity plant (grams/day)</span>
        <span class="gold"><b>${nf(d.production30.reduce((a, r) => a + r.gold, 0), 0)} g</b> in 30 days</span>
      </div>
    </div>

    <div class="panel market-panel">
      <div class="panel-head">
        <div class="panel-title">Somaliland Gold Market</div>
        <span class="tag market">External Market</span>
      </div>
      <div class="mkt-hero">
        <div>
          <div class="mkt-price">${mkt ? nf(mkt.price_sos) : '—'} <span class="mkt-unit">SOS / gram</span></div>
          <div class="mkt-meta" style="margin-top:6px">
            ${deltaBadge(mkt?.delta_pct)}
            <span>22K local price</span>
            ${mkt?.price_usd ? `<span>≈ $${nf(mkt.price_usd, 2)}/g USD ref.</span>` : ''}
          </div>
        </div>
        <div style="display:flex;flex-direction:column;gap:6px;align-items:flex-end">
          <span class="tag ${mkt?.live ? 'live' : 'manual'}">${mkt?.live ? 'Live' : 'Manually Updated'}</span>
          <span class="mkt-meta">Source: ${esc(mkt?.source || state.cfg?.market_source || 'Local Somaliland Market')}</span>
          <span class="mkt-meta">Updated ${mkt ? dateShort(mkt.ts) + ' ' + timeOf(mkt.ts) : '—'}</span>
        </div>
      </div>
      <div class="chart-box sm"><canvas id="mktChart"></canvas></div>
      <div class="karat-chips">
        ${d.karatPrices.map((p) => `
          <div class="kchip">
            <div class="k">${p.karat}K</div>
            <div class="v">${p.price_sos ? nf(p.price_sos) + ' SOS' : '—'}</div>
            ${p.price_usd ? `<div class="usd">≈ $${nf(p.price_usd, 2)}/g</div>` : ''}
          </div>`).join('')}
      </div>
    </div>
  </div>

  <div class="row-2">
    <div class="panel">
      <div class="panel-head">
        <div class="panel-title">Processing Plant — Gravity Circuit</div>
        <span class="tag ops">Plant Status</span>
      </div>
      <div class="plant-summary" id="plantSummary"></div>
      <div class="stage-list">
        ${d.plant.map((s) => `
          <div class="stage">
            <span class="dot ${s.status}"></span>
            <span class="s-name">${esc(s.name)}</span>
            <span class="s-meta">${s.runtime_h ? nf(s.runtime_h, 1) + ' h' : ''}</span>
            <span class="s-status ${s.status}">${s.status === 'idle' ? 'Material' : s.status}</span>
          </div>`).join('')}
      </div>
    </div>

    <div class="panel">
      <div class="panel-head">
        <div class="panel-title">Gold Recovery — Today</div>
        <span class="tag ops">Gravity Separation</span>
      </div>
      ${d.recoveryToday ? `
      <div class="mini-stats">
        <div class="mini-stat"><div class="m-label">Ore Feed</div><div class="m-value">${nf(d.recoveryToday.ore_feed_t, 1)} <small>t</small></div></div>
        <div class="mini-stat"><div class="m-label">Concentrate</div><div class="m-value">${nf(d.recoveryToday.concentrate_kg, 1)} <small>kg</small></div></div>
        <div class="mini-stat"><div class="m-label">Gold Recovered</div><div class="m-value gold">${nf(d.recoveryToday.gold_recovered_g, 0)} <small>g</small></div></div>
        <div class="mini-stat"><div class="m-label">Recovery Rate</div><div class="m-value">${d.recoveryToday.recovery_pct !== null ? nf(d.recoveryToday.recovery_pct, 1) : '—'}<small>%</small></div></div>
      </div>` : '<div class="no-data" style="margin-bottom:14px">No Data — no processing record today</div>'}
      <div class="chart-box sm"><canvas id="recChart"></canvas></div>
      <div class="panel-foot">
        <span>Recovery % = Gold recovered ÷ Estimated gold in feed × 100</span>
        <span>Estimated gold = Ore (t) × Head grade (g/t)</span>
      </div>
    </div>
  </div>

  <div class="panel alerts-panel">
    <div class="panel-head" style="padding:0 0 8px">
      <div class="panel-title">Important Alerts</div>
      <span class="tag ${d.alerts.some((a) => a.level === 'critical') ? 'stopped' : 'manual'}">${d.alerts.length} active</span>
    </div>
    ${d.alerts.length === 0
      ? '<div class="alert-empty">No active alerts — all systems normal.</div>'
      : d.alerts.map((a) => `
        <div class="alert-row ${a.level}">
          <div class="a-ico">${a.level === 'ok' ? '🟢' : a.level === 'warning' ? '🟠' : '🔴'}</div>
          <div class="a-cat">${esc(a.category)}</div>
          <div class="a-msg">${esc(a.message)}</div>
        </div>`).join('')}
  </div>`;

  const counts = {};
  d.plant.forEach((s) => (counts[s.status] = (counts[s.status] || 0) + 1));
  document.getElementById('plantSummary').innerHTML =
    `<span><b>${counts.running || 0}</b> running</span><span><b>${counts.attention || 0}</b> attention</span><span><b>${counts.stopped || 0}</b> stopped</span><span><b>${(counts.offline || 0) + (counts.idle || 0)}</b> offline/material</span>`;

  const prodCtx = document.getElementById('prodChart');
  track(new Chart(prodCtx, {
    type: 'bar',
    data: {
      labels: d.production30.map((r) => dateShort(r.date)),
      datasets: [{
        data: d.production30.map((r) => r.gold),
        backgroundColor: d.production30.map((r) => (r.date === d.today ? '#ffd54a' : 'rgba(240,180,41,0.55)')),
        borderRadius: 4, maxBarThickness: 18,
      }],
    },
    options: baseOpts({
      scales: {
        x: { grid: { display: false }, ticks: { maxTicksLimit: 10, font: { size: 10 } } },
        y: { beginAtZero: true, ticks: { callback: (v) => v + ' g', font: { size: 10 } } },
      },
      plugins: {
        legend: { display: false },
        tooltip: {
          ...baseOpts().plugins.tooltip,
          callbacks: {
            label: (c) => ` ${nf(c.parsed.y, 1)} g gold recovered`,
            afterLabel: (c) => ` ${nf(d.production30[c.dataIndex].ore, 1)} t ore processed`,
          },
        },
      },
    }),
  }));

  const mktCtx = document.getElementById('mktChart');
  const grad = mktCtx.getContext('2d').createLinearGradient(0, 0, 0, 190);
  grad.addColorStop(0, 'rgba(240,180,41,0.28)');
  grad.addColorStop(1, 'rgba(240,180,41,0)');
  track(new Chart(mktCtx, {
    type: 'line',
    data: {
      labels: d.market30.map((r) => dateShort(r.date)),
      datasets: [{
        data: d.market30.map((r) => r.price),
        borderColor: '#f0b429', backgroundColor: grad, fill: true, tension: 0.35,
        pointRadius: 0, pointHoverRadius: 4, borderWidth: 2, spanGaps: true,
      }],
    },
    options: baseOpts({
      scales: {
        x: { grid: { display: false }, ticks: { maxTicksLimit: 8, font: { size: 10 } } },
        y: { ticks: { callback: (v) => (v / 1000).toFixed(0) + 'k', font: { size: 10 } } },
      },
      plugins: {
        legend: { display: false },
        tooltip: {
          ...baseOpts().plugins.tooltip,
          callbacks: { label: (c) => (c.parsed.y ? ` ${nf(c.parsed.y)} SOS/g (22K)` : '') },
        },
      },
    }),
  }));

  const recCtx = document.getElementById('recChart');
  track(new Chart(recCtx, {
    type: 'line',
    data: {
      labels: d.recovery30.map((r) => dateShort(r ? r.date : '')),
      datasets: [
        {
          data: d.recovery30.map((r) => (r && r.rec !== null ? r.rec : null)),
          borderColor: '#2fd07a', backgroundColor: 'rgba(47,208,122,0.10)', fill: true,
          tension: 0.35, pointRadius: 0, pointHoverRadius: 4, borderWidth: 2, spanGaps: true,
        },
        ...(k.targets?.recovery_pct ? [{
          data: d.recovery30.map(() => k.targets.recovery_pct),
          borderColor: 'rgba(245,165,36,0.55)', borderDash: [5, 5], pointRadius: 0, borderWidth: 1.2,
        }] : []),
      ],
    },
    options: baseOpts({
      scales: {
        x: { grid: { display: false }, ticks: { maxTicksLimit: 8, font: { size: 10 } } },
        y: { min: 60, suggestedMax: 100, ticks: { callback: (v) => v + '%', font: { size: 10 } } },
      },
      plugins: {
        legend: { display: false },
        tooltip: {
          ...baseOpts().plugins.tooltip,
          filter: (i) => i.datasetIndex === 0,
          callbacks: { label: (c) => (c.parsed.y ? ` Recovery ${nf(c.parsed.y, 1)}%` : ' No data') },
        },
      },
    }),
  }));
}

/* ============================================================
   PRODUCTION CONTROL
   ============================================================ */
const P = { rows: [], sites: [], range: '30', site: '', shift: '', from: '', to: '' };

function pFiltered() {
  return P.rows.filter((r) =>
    (!P.site || String(r.site_id) === String(P.site)) &&
    (!P.shift || r.shift === P.shift) &&
    (!P.from || r.date >= P.from) &&
    (!P.to || r.date <= P.to));
}
function sumRows(rows, f) { return rows.reduce((a, r) => a + (f(r) || 0), 0); }
function recoveryOf(rows) {
  const est = sumRows(rows, (r) => (r.head_grade_gpt != null ? r.ore_processed_t * r.head_grade_gpt : 0));
  const missing = rows.some((r) => r.head_grade_gpt == null);
  const gold = sumRows(rows, (r) => r.gold_recovered_g);
  return est > 0 && !missing ? (gold / est) * 100 : null;
}

async function pageProduction() {
  const page = shell('Production Control', 'Our Operation');
  page.innerHTML = '<div class="loading"><div class="spinner"></div>Loading production…</div>';
  let data;
  try { data = await api('/api/production'); } catch (e) { page.innerHTML = `<div class="form-err">${esc(e.message)}</div>`; return; }
  P.rows = data.rows;
  P.sites = data.sites;

  const render = () => {
    const rows = pFiltered();
    const t = today();
    const weekFrom = addDaysStr(t, -6);
    const siteName = (id) => P.sites.find((s) => s.id === id)?.name || '—';
    const rec = recoveryOf(rows);

    const kpis = [
      ['Today', sumRows(rows.filter((r) => r.date === t), (r) => r.gold_recovered_g)],
      ['Last 7 Days', sumRows(rows.filter((r) => r.date >= weekFrom), (r) => r.gold_recovered_g)],
      ['This Month', sumRows(rows.filter((r) => r.date.startsWith(thisMonth())), (r) => r.gold_recovered_g)],
      ['Total (filtered)', sumRows(rows, (r) => r.gold_recovered_g)],
    ];

    page.innerHTML = `
    <div class="kpi-grid small">
      ${kpis.map(([l, v]) => kpiCard({ label: l, value: v > 0 ? kgStr(v).replace(' kg', '') + (v < 1000 ? ' g' : ' kg') : (P.rows.length ? '0' : 'No Data'), unit: v >= 1000 ? 'kg' : 'g' })).join('')}
      ${kpiCard({ label: 'Ore Processed', ico: '⛏️', value: sumRows(rows, (r) => r.ore_processed_t) > 0 ? nf(sumRows(rows, (r) => r.ore_processed_t), 1) : (P.rows.length ? '0' : 'No Data'), unit: 't' })}
      ${kpiCard({ label: 'Recovery Rate', ico: '⚗️', value: rec !== null ? nf(rec, 1) : 'No Data', unit: rec !== null ? '%' : '', foot: rec === null ? '<div class="kpi-foot"><span class="kpi-sub">Insufficient Data — head grade missing</span></div>' : '' })}
    </div>

    <div class="panel" style="margin-bottom:16px">
      <div class="panel-head">
        <div class="panel-title">Gold Production Chart</div>
        <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center">
          <div class="seg" id="rangeSeg">
            <button data-r="7">7 Days</button>
            <button data-r="30" class="active">30 Days</button>
            <button data-r="90">3 Months</button>
            <button data-r="365">1 Year</button>
          </div>
        </div>
      </div>
      <div class="filter-row">
        <div class="field"><label>Mining Site</label>
          <select id="fSite"><option value="">All sites</option>${P.sites.map((s) => `<option value="${s.id}" ${P.site == s.id ? 'selected' : ''}>${esc(s.name)}</option>`).join('')}</select>
        </div>
        <div class="field"><label>Shift</label>
          <select id="fShift"><option value="">All shifts</option><option ${P.shift === 'Day' ? 'selected' : ''}>Day</option><option ${P.shift === 'Night' ? 'selected' : ''}>Night</option></select>
        </div>
        <div class="field"><label>From</label><input type="date" id="fFrom" value="${P.from}"></div>
        <div class="field"><label>To</label><input type="date" id="fTo" value="${P.to}"></div>
        <button class="btn ghost sm" id="fClear" style="align-self:flex-end">Clear</button>
      </div>
      <div class="chart-box" style="margin-top:14px"><canvas id="prodPageChart"></canvas></div>
      <div class="panel-foot">
        <span>Our operation — actual production records only</span>
        <span class="gold"><b>${nf(sumRows(rows, (r) => r.gold_recovered_g), 0)} g</b> · ${nf(sumRows(rows, (r) => r.ore_processed_t), 1)} t ore in selection</span>
      </div>
    </div>

    <div class="panel">
      <div class="panel-head">
        <div class="panel-title">Production Records</div>
        <div style="display:flex;gap:8px">
          <span class="tag manual">${rows.length} records</span>
          ${can('admin', 'manager', 'operator') ? '<button class="btn primary sm" id="addProdBtn">+ Add Production</button>' : ''}
        </div>
      </div>
      <div class="tbl-wrap">
        <table class="tbl">
          <thead><tr>
            <th>Date</th><th>Site</th><th>Shift</th><th class="num">Ore (t)</th><th class="num">Head grade (g/t)</th>
            <th class="num">Gold (g)</th><th class="num">Recovery</th><th>Operator</th><th></th>
          </tr></thead>
          <tbody>
            ${rows.slice(0, 80).map((r) => `
              <tr>
                <td>${dateShort(r.date)}</td>
                <td>${esc(siteName(r.site_id))}</td>
                <td>${esc(r.shift)}</td>
                <td class="num">${nf(r.ore_processed_t, 1)}</td>
                <td class="num">${r.head_grade_gpt !== null ? nf(r.head_grade_gpt, 2) : '—'}</td>
                <td class="num"><b class="gold">${nf(r.gold_recovered_g, 1)}</b></td>
                <td class="num">${r.recovery_pct !== null ? nf(r.recovery_pct, 1) + '%' : '—'}</td>
                <td>${esc(r.operator || '—')}</td>
                <td class="num">
                  <button class="btn ghost sm" data-view="${r.id}">View</button>
                  ${can('admin', 'manager', 'operator') ? `<button class="btn ghost sm" data-edit="${r.id}">Edit</button>` : ''}
                </td>
              </tr>`).join('') || '<tr><td colspan="9" style="text-align:center;padding:22px" class="muted">No Data</td></tr>'}
          </tbody>
        </table>
      </div>
      ${rows.length > 80 ? `<div class="panel-foot"><span>Showing first 80 of ${rows.length} — use the filters to narrow down.</span></div>` : ''}
    </div>`;

    // chart
    drawProdChart();

    document.getElementById('rangeSeg').addEventListener('click', (e) => {
      const b = e.target.closest('button[data-r]');
      if (!b) return;
      P.range = b.dataset.r;
      document.querySelectorAll('#rangeSeg button').forEach((x) => x.classList.toggle('active', x === b));
      drawProdChart();
    });
    document.getElementById('fSite').addEventListener('change', (e) => { P.site = e.target.value; render(); });
    document.getElementById('fShift').addEventListener('change', (e) => { P.shift = e.target.value; render(); });
    document.getElementById('fFrom').addEventListener('change', (e) => { P.from = e.target.value; render(); });
    document.getElementById('fTo').addEventListener('change', (e) => { P.to = e.target.value; render(); });
    document.getElementById('fClear').addEventListener('click', () => { P.site = ''; P.shift = ''; P.from = ''; P.to = ''; render(); });

    const addBtn = document.getElementById('addProdBtn');
    if (addBtn) addBtn.addEventListener('click', () => prodForm());
    page.querySelectorAll('[data-view]').forEach((b) => b.addEventListener('click', () => prodView(P.rows.find((r) => r.id == b.dataset.view))));
    page.querySelectorAll('[data-edit]').forEach((b) => b.addEventListener('click', () => prodForm(P.rows.find((r) => r.id == b.dataset.edit))));
  };

  function drawProdChart() {
    const rows = pFiltered();
    const range = Number(P.range);
    const t = today();
    const byKey = new Map();
    rows.forEach((r) => {
      let key;
      if (range <= 30) key = r.date;
      else if (range <= 90) {
        const d = new Date(r.date + 'T12:00:00');
        const dow = (d.getDay() + 6) % 7;
        d.setDate(d.getDate() - dow);
        key = localDateStr(d);
      } else key = r.date.slice(0, 7);
      byKey.set(key, (byKey.get(key) || 0) + r.gold_recovered_g);
    });
    let labels = [], values = [];
    if (range <= 30) {
      for (let i = range - 1; i >= 0; i--) { const k = addDaysStr(t, -i); labels.push(dateShort(k)); values.push(round2(byKey.get(k) || 0)); }
    } else if (range <= 90) {
      const wk = (d) => { const x = new Date(d + 'T12:00:00'); const dow = (x.getDay() + 6) % 7; x.setDate(x.getDate() - dow); return localDateStr(x); };
      for (let i = 12; i >= 0; i--) { const k = wk(addDaysStr(t, -7 * i)); labels.push('Wk ' + dateShort(k)); values.push(round2(byKey.get(k) || 0)); }
    } else {
      const now = new Date(t + 'T12:00:00');
      for (let i = 11; i >= 0; i--) {
        const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1));
        const k = String(d.getUTCFullYear()) + '-' + String(d.getUTCMonth() + 1).padStart(2, '0');
        labels.push(new Date(k + '-01T12:00:00').toLocaleDateString('en-GB', { month: 'short', year: '2-digit' }));
        values.push(round2(byKey.get(k) || 0));
      }
    }
    const ctx = document.getElementById('prodPageChart');
    if (!ctx) return;
    if (state.charts.length) { try { state.charts.find((c) => c.canvas === ctx)?.destroy(); } catch { /* ignore */ } }
    track(new Chart(ctx, {
      type: 'bar',
      data: { labels, datasets: [{ data: values, backgroundColor: 'rgba(240,180,41,0.6)', hoverBackgroundColor: '#ffd54a', borderRadius: 4, maxBarThickness: 26 }] },
      options: baseOpts({
        scales: {
          x: { grid: { display: false }, ticks: { maxTicksLimit: 12, font: { size: 10 } } },
          y: { beginAtZero: true, ticks: { callback: (v) => nf(v, 0) + ' g', font: { size: 10 } } },
        },
        plugins: { legend: { display: false }, tooltip: { ...baseOpts().plugins.tooltip, callbacks: { label: (c) => ` ${nf(c.parsed.y, 1)} g gold` } } },
      }),
    }));
  }

  render();
}
const round2 = (n) => Math.round(n * 10) / 10;

function prodView(r) {
  if (!r) return;
  const site = P.sites.find((s) => s.id === r.site_id)?.name || '—';
  openModal(`Production — ${dateShort(r.date)} (${r.shift})`, `
    ${kvRows([
      ['Date', dateLong(r.date)],
      ['Mining site', esc(site)],
      ['Shift', esc(r.shift)],
      ['Ore processed', nf(r.ore_processed_t, 1) + ' t'],
      ['Head grade', r.head_grade_gpt !== null ? nf(r.head_grade_gpt, 2) + ' g/t' : 'Not recorded'],
      ['Estimated gold in feed', r.head_grade_gpt !== null ? nf(r.ore_processed_t * r.head_grade_gpt, 1) + ' g' : '—'],
      ['Concentrate weight', r.concentrate_weight_kg !== null ? nf(r.concentrate_weight_kg, 1) + ' kg' : '—'],
      ['Gold recovered', `<b class="gold">${nf(r.gold_recovered_g, 1)} g</b>`],
      ['Recovery %', r.recovery_pct !== null ? nf(r.recovery_pct, 1) + ' %' : 'Insufficient Data'],
      ['Operator', esc(r.operator || '—')],
      ['Notes', esc(r.notes || '—')],
    ])}
    <div class="modal-actions">${can('admin', 'manager', 'operator') ? `<button class="btn primary sm" id="mvEdit">Edit</button>` : ''}</div>`);
  document.getElementById('mvEdit')?.addEventListener('click', () => prodForm(r));
}

function prodForm(prefill) {
  const isEdit = !!prefill;
  const body = openModal(isEdit ? 'Edit Production Record' : 'Add Production', `
    <form id="prodForm" class="form-grid">
      <div class="field"><label>Date *</label><input type="date" name="date" value="${prefill?.date || today()}" required></div>
      <div class="field"><label>Mining Site</label>
        <select name="site_id">${P.sites.map((s) => `<option value="${s.id}" ${prefill?.site_id == s.id ? 'selected' : ''}>${esc(s.name)}</option>`).join('')}</select>
      </div>
      <div class="field"><label>Shift</label>
        <select name="shift"><option ${prefill?.shift === 'Day' ? 'selected' : ''}>Day</option><option ${prefill?.shift === 'Night' ? 'selected' : ''}>Night</option></select>
      </div>
      <div class="field"><label>Operator</label><input name="operator" value="${esc(prefill?.operator || state.user.name)}"></div>
      <div class="field"><label>Ore Processed (t) *</label><input type="number" step="0.1" min="0" name="ore_processed_t" value="${prefill?.ore_processed_t ?? ''}" required></div>
      <div class="field"><label>Head Grade (g/t)</label><input type="number" step="0.1" min="0" name="head_grade_gpt" value="${prefill?.head_grade_gpt ?? ''}"><span class="hint">Grams of gold per tonne of ore</span></div>
      <div class="field"><label>Concentrate Weight (kg)</label><input type="number" step="0.1" min="0" name="concentrate_weight_kg" value="${prefill?.concentrate_weight_kg ?? ''}"></div>
      <div class="field"><label>Gold Recovered (g) *</label><input type="number" step="0.1" min="0" name="gold_recovered_g" value="${prefill?.gold_recovered_g ?? ''}" required></div>
      <div class="field"><label>Recovery %</label><input value="auto" disabled><span class="hint" id="recHint">auto = recovered ÷ (ore × head grade)</span></div>
      <div class="field full"><label>Notes</label><textarea name="notes" rows="2">${esc(prefill?.notes || '')}</textarea></div>
      <div class="full modal-actions">
        <button type="button" class="btn ghost" id="pfCancel">Cancel</button>
        <button class="btn primary" type="submit">SAVE PRODUCTION</button>
      </div>
    </form>`, true);
  const f = body.querySelector('#prodForm');
  const hint = body.querySelector('#recHint');
  const recCalc = () => {
    const ore = parseFloat(f.ore_processed_t.value);
    const grade = parseFloat(f.head_grade_gpt.value);
    const gold = parseFloat(f.gold_recovered_g.value);
    if (ore > 0 && grade > 0 && gold > 0) hint.textContent = `Auto-calculated: ${((gold / (ore * grade)) * 100).toFixed(1)} %`;
    else hint.textContent = 'auto = recovered ÷ (ore × head grade) — enter all three values';
  };
  ['ore_processed_t', 'head_grade_gpt', 'gold_recovered_g'].forEach((n) => f[n].addEventListener('input', recCalc));
  body.querySelector('#pfCancel').addEventListener('click', closeModal);
  f.addEventListener('submit', async (e) => {
    e.preventDefault();
    const b = Object.fromEntries(new FormData(f).entries());
    try {
      if (isEdit) await api('/api/production/' + prefill.id, { method: 'PUT', body: b });
      else await api('/api/production', { method: 'POST', body: b });
      toast(isEdit ? 'Production record updated' : 'Production saved');
      closeModal();
      P.rows = (await api('/api/production')).rows;
      pageProduction();
    } catch (err) { toast(err.message, false); }
  });
}

/* ============================================================
   PROCESSING PLANT
   ============================================================ */
let PL = { stages: [], processing: [], range: '30' };

async function pagePlant() {
  const page = shell('Processing Plant', 'Our Operation — Gravity Separation');
  page.innerHTML = '<div class="loading"><div class="spinner"></div>Loading plant…</div>';
  let data;
  try { data = await api('/api/plant'); } catch (e) { page.innerHTML = `<div class="form-err">${esc(e.message)}</div>`; return; }
  PL.stages = data.stages;
  PL.processing = data.processing;

  const render = () => {
    const counts = {};
    PL.stages.forEach((s) => (counts[s.status] = (counts[s.status] || 0) + 1));
    const range = Number(PL.range);
    const from = addDaysStr(today(), -(range - 1));
    const rows = PL.processing.filter((r) => r.date >= from);
    const ore = sumRows(rows, (r) => r.ore_feed_t);
    const conc = sumRows(rows, (r) => r.concentrate_kg);
    const gold = sumRows(rows, (r) => r.gold_recovered_g);
    const rec = gold > 0 ? rows.reduce((a, r) => a + (r.recovery_pct || 0) * r.gold_recovered_g, 0) / gold : null;

    page.innerHTML = `
    <div class="panel" style="margin-bottom:16px">
      <div class="panel-head">
        <div class="panel-title">Gravity Processing Workflow</div>
        <div class="plant-summary" style="margin:0">
          <span><b>${counts.running || 0}</b> running</span><span><b>${counts.attention || 0}</b> attention</span>
          <span><b>${counts.stopped || 0}</b> stopped</span><span><b>${(counts.offline || 0) + (counts.idle || 0)}</b> offline/material</span>
        </div>
      </div>
      <div class="flow">
        ${PL.stages.map((s, i) => `
          ${i > 0 ? '<div class="flow-arrow">→</div>' : ''}
          <div class="flow-card st-${s.status}">
            <div class="fc-top"><span class="dot ${s.status}"></span><span class="fc-name">${esc(s.name)}</span></div>
            <div class="fc-status ${s.status}">${s.status === 'idle' ? 'Material stage' : s.status}</div>
            <div class="fc-meta">${s.runtime_h ? nf(s.runtime_h, 1) + ' h runtime' : (s.output || '')}</div>
            ${s.feed && s.output && s.status !== 'idle' ? `<div class="fc-io">${esc(s.feed)} → ${esc(s.output)}</div>` : ''}
            ${s.note ? `<div class="fc-note">${esc(s.note)}</div>` : ''}
            <select class="fc-select" data-stage="${s.id}" ${s.status === 'idle' ? 'disabled' : ''}>
              ${['running', 'attention', 'stopped', 'offline'].map((x) => `<option value="${x}" ${s.status === x ? 'selected' : ''}>${x}</option>`).join('')}
            </select>
          </div>`).join('')}
      </div>
      <div class="panel-foot"><span>Tap a stage status to update it (Running / Attention / Stopped / Offline).</span><span>Material stages show today's concentrate and recovered gold.</span></div>
    </div>

    <div class="panel">
      <div class="panel-head">
        <div class="panel-title">Gravity Recovery Performance</div>
        <div class="seg" id="recSeg">
          <button data-r="7" ${PL.range === '7' ? 'class="active"' : ''}>7D</button>
          <button data-r="30" ${PL.range === '30' ? 'class="active"' : ''}>30D</button>
          <button data-r="90" ${PL.range === '90' ? 'class="active"' : ''}>90D</button>
        </div>
      </div>
      <div class="mini-stats big">
        <div class="mini-stat"><div class="m-label">Ore Feed</div><div class="m-value">${rows.length ? nf(ore, 1) : '—'} <small>tonnes</small></div></div>
        <div class="mini-stat"><div class="m-label">Concentrate</div><div class="m-value">${rows.length ? nf(conc, 1) : '—'} <small>kg</small></div></div>
        <div class="mini-stat"><div class="m-label">Gold Recovered</div><div class="m-value gold">${rows.length ? nf(gold, 0) : '—'} <small>g</small></div></div>
        <div class="mini-stat"><div class="m-label">Recovery Rate</div><div class="m-value">${rec !== null ? nf(rec, 1) : '—'}<small>%</small></div></div>
      </div>
      <div class="chart-box"><canvas id="plantRecChart"></canvas></div>
      <div class="panel-foot">
        <span>Recovery % = Gold recovered ÷ Estimated gold in feed × 100 (gravity circuit)</span>
        <span class="gold"><b>${nf(gold, 0)} g</b> recovered in ${range} days</span>
      </div>
    </div>`;

    document.getElementById('recSeg').addEventListener('click', (e) => {
      const b = e.target.closest('button[data-r]');
      if (!b) return;
      PL.range = b.dataset.r;
      render();
    });
    page.querySelectorAll('.fc-select').forEach((sel) => sel.addEventListener('change', async () => {
      try {
        await api('/api/plant/stages/' + sel.dataset.stage, { method: 'PATCH', body: { status: sel.value } });
        toast('Stage status updated');
        PL.stages = (await api('/api/plant')).stages;
        render();
      } catch (err) { toast(err.message, false); }
    }));

    // chart
    const labels = rows.map((r) => dateShort(r.date));
    const ctx = document.getElementById('plantRecChart');
    track(new Chart(ctx, {
      type: 'line',
      data: {
        labels,
        datasets: [
          { label: 'Recovery %', data: rows.map((r) => r.recovery_pct), borderColor: '#2fd07a', backgroundColor: 'rgba(47,208,122,0.12)', fill: true, tension: 0.3, pointRadius: 2, borderWidth: 2, spanGaps: true, yAxisID: 'y' },
          { label: 'Gold (g)', data: rows.map((r) => r.gold_recovered_g), borderColor: '#f0b429', backgroundColor: 'rgba(240,180,41,0.10)', type: 'bar', borderRadius: 3, maxBarThickness: 14, yAxisID: 'y1' },
        ],
      },
      options: baseOpts({
        scales: {
          x: { grid: { display: false }, ticks: { maxTicksLimit: 12, font: { size: 10 } } },
          y: { position: 'left', min: 60, suggestedMax: 100, ticks: { callback: (v) => v + '%', font: { size: 10 } } },
          y1: { position: 'right', beginAtZero: true, grid: { drawOnChartArea: false }, ticks: { callback: (v) => v + ' g', font: { size: 10 } } },
        },
        plugins: {
          legend: { display: true, labels: { boxWidth: 12, font: { size: 11 } } },
          tooltip: baseOpts().plugins.tooltip,
        },
      }),
    }));
  };
  render();
}

/* ============================================================
   EQUIPMENT
   ============================================================ */
const EQ_IMG = {
  'Jaw Crusher': '/img/eq/jaw-crusher.jpg',
  'Hammer Crusher': '/img/eq/hammer-crusher.jpg',
  'Belt Conveyor': '/img/eq/belt-conveyor.jpg',
  'Vibrating Feeder': '/img/eq/vibrating-feeder.jpg',
  'Ball Mill': '/img/eq/ball-mill.jpg',
  'Gravity Concentrator': '/img/eq/gravity-concentrator.jpg',
  'Shaking Table': '/img/eq/shaking-table.jpg',
  'Process Pump': '/img/eq/process-pump.jpg',
  'Generator': '/img/eq/generator.jpg',
};
let EQ = [];

async function pageEquipment() {
  const page = shell('Equipment Status', 'Our Operation — Plant');
  page.innerHTML = '<div class="loading"><div class="spinner"></div>Loading equipment…</div>';
  let data;
  try { data = await api('/api/equipment'); } catch (e) { page.innerHTML = `<div class="form-err">${esc(e.message)}</div>`; return; }
  EQ = data.rows;

  const counts = {};
  EQ.forEach((e) => (counts[e.status] = (counts[e.status] || 0) + 1));

  const specRows = (e) => {
    const rows = [];
    if (e.capacity) rows.push(['Capacity', esc(e.capacity)]);
    if (e.power) rows.push(['Power', esc(e.power)]);
    if (e.qty > 1) rows.push(['Quantity', e.qty]);
    Object.entries(e.extra || {}).forEach(([k, v]) => rows.push([esc(k), esc(v)]));
    return rows;
  };

  page.innerHTML = `
  <div class="panel" style="padding:12px 18px;margin-bottom:16px">
    <div class="plant-summary" style="margin:0">
      <span><span class="dot running" style="margin-right:6px"></span><b>${counts.running || 0}</b> running</span>
      <span><span class="dot attention" style="margin-right:6px"></span><b>${counts.attention || 0}</b> attention</span>
      <span><span class="dot stopped" style="margin-right:6px"></span><b>${counts.stopped || 0}</b> stopped</span>
      <span><span class="dot offline" style="margin-right:6px"></span><b>${counts.offline || 0}</b> offline</span>
    </div>
  </div>
  <div class="eq-grid">
    ${EQ.map((e) => `
      <div class="eq-card ${e.status}">
        <div class="eq-img-wrap">
          <img class="eq-img" src="${EQ_IMG[e.name] || ''}" alt="${esc(e.name)}" onerror="this.style.display='none';this.nextElementSibling.style.display='flex'">
          <div class="eq-ph">⚙️</div>
          <span class="badge ${e.status} eq-badge">${e.status}</span>
        </div>
        <div class="eq-body">
          <div class="eq-name">${esc(e.name)}</div>
          <div class="eq-model">${esc(e.model || '')}${e.qty > 1 ? ' × ' + e.qty : ''}</div>
          <table class="eq-specs">
            ${specRows(e).map(([k, v]) => `<tr><td>${k}</td><td>${v}</td></tr>`).join('')}
            <tr><td>Runtime</td><td>${e.runtime_h ? nf(e.runtime_h, 1) + ' h' : '—'}</td></tr>
          </table>
          ${e.notes ? `<div class="eq-note ${e.status === 'attention' ? 'warn' : ''}">${esc(e.notes)}</div>` : ''}
          <div class="eq-foot">
            <select class="fc-select" data-eq="${e.id}">
              ${['running', 'attention', 'stopped', 'offline'].map((x) => `<option value="${x}" ${e.status === x ? 'selected' : ''}>${x}</option>`).join('')}
            </select>
            <button class="btn ghost sm" data-eqview="${e.id}">VIEW DETAILS</button>
          </div>
        </div>
      </div>`).join('')}
  </div>`;

  page.querySelectorAll('[data-eqview]').forEach((b) => b.addEventListener('click', () => {
    const e = EQ.find((x) => x.id == b.dataset.eqview);
    if (!e) return;
    openModal(e.name, `
      <img class="eq-modal-img" src="${EQ_IMG[e.name] || ''}" alt="" onerror="this.style.display='none'">
      ${kvRows([
        ['Model', esc(e.model || '—')],
        ...specRows(e),
        ['Status', `<span class="badge ${e.status}">${e.status}</span>`],
        ['Runtime today', e.runtime_h ? nf(e.runtime_h, 1) + ' h' : '—'],
        ['Notes', esc(e.notes || '—')],
      ])}
      <div class="modal-actions"><label class="inline-label">Status
        <select id="eqSel">${['running', 'attention', 'stopped', 'offline'].map((x) => `<option ${e.status === x ? 'selected' : ''}>${x}</option>`).join('')}</select>
      </label></div>`);
    document.getElementById('eqSel').addEventListener('change', async (ev) => {
      try { await api('/api/equipment/' + e.id, { method: 'PATCH', body: { status: ev.target.value } }); toast('Status updated'); closeModal(); pageEquipment(); }
      catch (err) { toast(err.message, false); }
    });
  }));
  page.querySelectorAll('[data-eq]').forEach((sel) => sel.addEventListener('change', async () => {
    try {
      await api('/api/equipment/' + sel.dataset.eq, { method: 'PATCH', body: { status: sel.value } });
      toast('Equipment status updated');
      EQ = (await api('/api/equipment')).rows;
      pageEquipment();
    } catch (err) { toast(err.message, false); }
  }));
}

/* ============================================================
   GOLD INVENTORY
   ============================================================ */
let GD = { batches: [], summary: null };

async function pageGold() {
  const page = shell('Gold Inventory', 'Our Operation — Vault');
  page.innerHTML = '<div class="loading"><div class="spinner"></div>Loading gold inventory…</div>';
  let data;
  try { data = await api('/api/gold'); } catch (e) { page.innerHTML = `<div class="form-err">${esc(e.message)}</div>`; return; }
  GD.batches = data.batches;
  GD.summary = data.summary;

  const s = GD.summary;
  const statusBadge = (st) => `<span class="badge ${st === 'Sold' ? 'sold' : st === 'In Storage' || st === 'Refined' ? 'storage' : 'refining'}">${esc(st)}</span>`;

  page.innerHTML = `
  <div class="kpi-grid small">
    ${kpiCard({ label: 'Gold Recovered (total)', ico: '⚗️', value: s.recovered_total_g > 0 ? nf(s.recovered_total_g, 0) : 'No Data', unit: s.recovered_total_g > 0 ? 'g' : '', sub: 'all production records' })}
    ${kpiCard({ label: 'Gold in Concentrate', ico: '🧪', value: s.concentrate_kg > 0 ? nf(s.concentrate_kg, 0) : 'No Data', unit: s.concentrate_kg > 0 ? 'kg' : '', sub: 'concentrate mass (not yet refined)' })}
    ${kpiCard({ label: 'Refined / In Storage', ico: '🪙', value: s.in_storage_g > 0 ? nf(s.in_storage_g, 0) : 'No Data', unit: s.in_storage_g > 0 ? 'g' : '' })}
    ${kpiCard({ label: 'Gold Sold', ico: '💰', value: s.sold_g > 0 ? nf(s.sold_g, 0) : 'No Data', unit: s.sold_g > 0 ? 'g' : '', sub: 'recorded transactions only' })}
    ${kpiCard({ label: 'Current Gold Balance', ico: '🏦', market: true, value: s.balance_g > 0 ? nf(s.balance_g, 0) : 'No Data', unit: s.balance_g > 0 ? 'g' : '' })}
  </div>

  <div class="panel">
    <div class="panel-head">
      <div class="panel-title">Gold Batches</div>
      <div style="display:flex;gap:8px;align-items:center">
        <span class="tag manual">${GD.batches.length} batches</span>
        ${can('admin', 'manager') ? '<button class="btn primary sm" id="addBatchBtn">+ Add Batch</button>' : ''}
      </div>
    </div>
    <div class="tbl-wrap">
      <table class="tbl">
        <thead><tr>
          <th>Batch</th><th>Date</th><th class="num">Weight (g)</th><th>Karat</th><th class="num">Purity (%)</th>
          <th>Status</th><th>Sale Status</th><th></th>
        </tr></thead>
        <tbody>
          ${GD.batches.map((b) => `
            <tr>
              <td><b class="gold">${esc(b.batch_no)}</b></td>
              <td>${dateShort(b.date)}</td>
              <td class="num"><b>${nf(b.weight_g, 0)}</b></td>
              <td>${b.karat}K</td>
              <td class="num">${b.purity_pct !== null ? nf(b.purity_pct, 1) : '—'}</td>
              <td>${statusBadge(b.status)}</td>
              <td>${b.status === 'Sold' ? `<span class="muted">${dateShort(b.sold_date)}</span> · <span class="gold">${b.sold_price_sos ? nf(b.sold_price_sos, 0) + ' SOS' : 'recorded'}</span>` : '—'}</td>
              <td class="num">${can('admin', 'manager') && b.status !== 'Sold' ? `<button class="btn ghost sm" data-sell="${b.id}">Mark Sold</button>` : ''}</td>
            </tr>`).join('') || '<tr><td colspan="8" style="text-align:center;padding:22px" class="muted">No Data</td></tr>'}
        </tbody>
      </table>
    </div>
  </div>`;

  document.getElementById('addBatchBtn')?.addEventListener('click', () => batchForm());
  page.querySelectorAll('[data-sell]').forEach((b) => b.addEventListener('click', () => sellForm(GD.batches.find((x) => x.id == b.dataset.sell))));
}

function nextBatchNo() {
  const yr = today().slice(0, 4);
  let n = GD.batches.length ? Math.max(...GD.batches.map((b) => { const m = b.batch_no.match(/(\d+)$/); return m ? Number(m[1]) : 0; })) : 0;
  return `BG-${yr}-${String(n + 1).padStart(3, '0')}`;
}
const PURITY = { 24: 99.9, 22: 91.7, 21: 87.5, 18: 75.0 };

function batchForm() {
  const body = openModal('Add Gold Batch', `
    <form id="batchForm" class="form-grid">
      <div class="field"><label>Batch Number *</label><input name="batch_no" value="${nextBatchNo()}" required></div>
      <div class="field"><label>Date *</label><input type="date" name="date" value="${today()}" required></div>
      <div class="field"><label>Weight (g) *</label><input type="number" step="0.1" min="0" name="weight_g" required></div>
      <div class="field"><label>Karat</label><select name="karat">${[24, 22, 21, 18].map((k) => `<option value="${k}">${k}K</option>`).join('')}</select></div>
      <div class="field"><label>Status</label><select name="status"><option>In Storage</option><option>Refining</option><option>Refined</option></select></div>
      <div class="field"><label>Notes</label><input name="notes" value=""></div>
      <div class="full modal-actions">
        <button type="button" class="btn ghost" id="bfCancel">Cancel</button>
        <button class="btn primary" type="submit">SAVE BATCH</button>
      </div>
    </form>`);
  const f = body.querySelector('#batchForm');
  body.querySelector('#bfCancel').addEventListener('click', closeModal);
  f.addEventListener('submit', async (e) => {
    e.preventDefault();
    const b = Object.fromEntries(new FormData(f).entries());
    try {
      await api('/api/gold', { method: 'POST', body: b });
      toast('Batch saved');
      closeModal();
      pageGold();
    } catch (err) { toast(err.message, false); }
  });
}

function sellForm(b) {
  if (!b) return;
  const body = openModal(`Mark ${esc(b.batch_no)} as Sold`, `
    <div class="hint" style="margin-bottom:12px">Record the <b>actual transaction</b> — this is the only place a market price becomes our sales price.</div>
    <form id="sellForm" class="form-grid">
      <div class="field"><label>Sale Date</label><input type="date" name="sold_date" value="${today()}" required></div>
      <div class="field"><label>Actual Sale Price (SOS)</label><input type="number" step="0" min="0" name="sold_price_sos" placeholder="e.g. 6989167"></div>
      <div class="field"><label>Sale Price (USD, optional)</label><input type="number" step="0" min="0" name="sold_price_usd" placeholder="e.g. 48600"></div>
      <div class="field"><label>Notes / Buyer</label><input name="notes" placeholder="Buyer reference"></div>
      <div class="full modal-actions">
        <button type="button" class="btn ghost" id="sfCancel">Cancel</button>
        <button class="btn primary" type="submit">CONFIRM SALE</button>
      </div>
    </form>`);
  const f = body.querySelector('#sellForm');
  body.querySelector('#sfCancel').addEventListener('click', closeModal);
  f.addEventListener('submit', async (e) => {
    e.preventDefault();
    const b2 = Object.fromEntries(new FormData(f).entries());
    try {
      await api('/api/gold/' + b.id, { method: 'PATCH', body: { status: 'Sold', ...b2, notes: b.notes ? b.notes + ' · ' + (b2.notes || '') : b2.notes } });
      toast('Sale recorded');
      closeModal();
      pageGold();
    } catch (err) { toast(err.message, false); }
  });
}

/* ============================================================
   SOMALILAND GOLD MARKET
   ============================================================ */
let MK = { range: '30', data: null };

async function pageMarket() {
  const page = shell('Somaliland Gold Market', 'External Market — not our production');
  page.innerHTML = '<div class="loading"><div class="spinner"></div>Loading market data…</div>';
  await loadMarket();

  const render = () => {
    const d = MK.data;
    const k22 = d.latest.find((x) => x.karat === 22);
    const st = d.stats;

    page.innerHTML = `
    <div class="panel market-panel" style="margin-bottom:16px">
      <div class="panel-head">
        <div class="panel-title">Current Somaliland Gold Price</div>
        <div style="display:flex;gap:8px;align-items:center">
          <span class="tag ${k22?.live ? 'live' : 'manual'}">${k22?.live ? 'Live' : 'Manually Updated'}</span>
          <span class="tag market">External Market</span>
        </div>
      </div>
      <div class="mkt-hero big">
        <div>
          <div class="mkt-price xl">${k22 ? nf(k22.price_sos) : '—'} <span class="mkt-unit">SOS / gram</span></div>
          <div class="mkt-meta" style="margin-top:8px">
            ${deltaBadge(k22?.delta_pct)}
            <span>22K local market price</span>
            ${k22?.price_usd ? `<span>≈ $${nf(k22.price_usd, 2)}/g USD reference</span>` : ''}
          </div>
        </div>
        <div class="mkt-meta" style="flex-direction:column;align-items:flex-end;gap:4px">
          <span>Last Updated: ${k22 ? dateLong(k22.date) + ' · ' + timeOf(k22.ts) : '—'}</span>
          <span>Source: ${esc(d.source)}</span>
          <span class="muted">${k22?.live ? 'Verified live source' : 'Entered by authorized staff — not a live feed'}</span>
        </div>
      </div>
    </div>

    <div class="karat-cards">
      ${d.latest.map((p) => `
        <div class="kcard ${p.karat === 22 ? 'active' : ''}">
          <div class="kc-k">${p.karat}K</div>
          <div class="kc-v">${p.price_sos ? nf(p.price_sos) : '—'} <span class="kc-u">SOS/g</span></div>
          <div class="kc-d">${deltaBadge(p.delta_pct)} ${p.price_usd ? `<span class="muted">≈ $${nf(p.price_usd, 2)}/g</span>` : ''}</div>
          <div class="kc-t">${p.price_sos ? (p.live ? 'Live' : 'Manually Updated') : 'No Data'}</div>
        </div>`).join('')}
    </div>

    <div class="panel market-panel" style="margin-top:16px">
      <div class="panel-head">
        <div class="panel-title">Somaliland Gold Price — History</div>
        <div class="seg" id="mktSeg">
          <button data-r="7" ${MK.range === '7' ? 'class="active"' : ''}>7D</button>
          <button data-r="30" ${MK.range === '30' ? 'class="active"' : ''}>30D</button>
          <button data-r="90" ${MK.range === '90' ? 'class="active"' : ''}>90D</button>
          <button data-r="365" ${MK.range === '365' ? 'class="active"' : ''}>1Y</button>
        </div>
      </div>
      ${st ? `
      <div class="mkt-stats">
        <div class="ms"><div class="ms-l">Current</div><div class="ms-v gold">${nf(st.current)}</div></div>
        <div class="ms"><div class="ms-l">Highest</div><div class="ms-v">${nf(st.high)}</div></div>
        <div class="ms"><div class="ms-l">Lowest</div><div class="ms-v">${nf(st.low)}</div></div>
        <div class="ms"><div class="ms-l">Average</div><div class="ms-v">${nf(st.avg)}</div></div>
        <div class="ms"><div class="ms-l">Change</div><div class="ms-v">${deltaBadge(st.change_pct)}</div></div>
      </div>` : '<div class="no-data" style="margin-bottom:14px">Market price unavailable — no records in this range</div>'}
      <div class="chart-box"><canvas id="mktPageChart"></canvas></div>
      <div class="panel-foot"><span>22K SOS/gram — external Somaliland market reference</span><span>SOS values, ${Number(MK.range)} days</span></div>
    </div>

    <div class="row-2" style="margin-top:16px">
      <div class="panel">
        <div class="panel-head"><div class="panel-title">Gold Value Calculator</div><span class="tag market">Estimate only</span></div>
        <div class="calc">
          <div class="form-grid">
            <div class="field"><label>Gold Weight (g)</label><input type="number" step="0.1" min="0" id="calcW" value="500"></div>
            <div class="field"><label>Karat</label>
              <select id="calcK">${d.latest.map((p) => `<option value="${p.karat}" ${p.karat === 22 ? 'selected' : ''}>${p.karat}K</option>`).join('')}</select>
            </div>
          </div>
          <div class="calc-result" id="calcRes"></div>
          <div class="hint" style="margin-top:10px">⚠️ <b>Estimated Market Value</b> at the latest recorded local price. This is <b>not</b> a company sale or revenue transaction — record actual sales in Gold Inventory.</div>
        </div>
      </div>

      <div class="panel">
        <div class="panel-head"><div class="panel-title">Manual Price Update</div>${can('admin') ? '<span class="tag manual">Admin only</span>' : '<span class="tag stopped">No access</span>'}</div>
        ${can('admin') ? `
        <form id="mktForm" class="form-grid">
          <div class="field"><label>Karat</label><select name="karat">${d.latest.map((p) => `<option value="${p.karat}">${p.karat}K</option>`).join('')}</select></div>
          <div class="field"><label>Price (SOS / gram) *</label><input type="number" step="0" min="0" name="price_sos" required></div>
          <div class="field"><label>USD / gram (reference)</label><input type="number" step="0.01" min="0" name="price_usd"></div>
          <div class="field"><label>Source</label><input name="source" value="${esc(d.source || 'Local Somaliland Market')}"></div>
          <div class="full"><button class="btn primary" type="submit">SAVE PRICE</button>
            <span class="hint" style="margin-left:10px">Recorded with price · karat · currency · unit · source · date · time</span></div>
        </form>` : '<p class="muted" style="font-size:13px">Only an administrator may enter verified local market prices. Prices are always marked <b>Manually Updated</b> unless connected to a verified live source.</p>'}
      </div>
    </div>

    <div class="panel" style="margin-top:16px">
      <div class="panel-head"><div class="panel-title">Price History</div><span class="tag manual">latest 30 records</span></div>
      <div class="tbl-wrap">
        <table class="tbl">
          <thead><tr><th>Date</th><th>Time</th><th>Karat</th><th class="num">Price (SOS/g)</th><th class="num">USD/g</th><th>Source</th><th>Type</th></tr></thead>
          <tbody id="mktHist"></tbody>
        </table>
      </div>
    </div>`;

    // history table (from series + latest)
    const hist = d.series.filter((s) => s.price_sos != null).slice(-30).reverse();
    document.getElementById('mktHist').innerHTML = hist.length
      ? hist.map((s) => `<tr><td>${dateShort(s.date)}</td><td>—</td><td>22K</td><td class="num"><b>${nf(s.price_sos)}</b></td><td class="num">${k22 ? nf(k22.price_usd, 2) : '—'}</td><td>${esc(d.source)}</td><td><span class="badge idle">Manual</span></td></tr>`).join('')
      : '<tr><td colspan="7" style="text-align:center;padding:22px" class="muted">Market price unavailable</td></tr>';

    // chart
    const ctx = document.getElementById('mktPageChart');
    const series = d.series.filter((s) => s.price_sos != null);
    const grad = ctx.getContext('2d').createLinearGradient(0, 0, 0, 265);
    grad.addColorStop(0, 'rgba(240,180,41,0.30)');
    grad.addColorStop(1, 'rgba(240,180,41,0)');
    track(new Chart(ctx, {
      type: 'line',
      data: {
        labels: series.map((s) => dateShort(s.date)),
        datasets: [{
          data: series.map((s) => s.price_sos),
          borderColor: '#f0b429', backgroundColor: grad, fill: true, tension: 0.3,
          pointRadius: series.length > 40 ? 0 : 2, pointHoverRadius: 4, borderWidth: 2,
        }],
      },
      options: baseOpts({
        scales: {
          x: { grid: { display: false }, ticks: { maxTicksLimit: 10, font: { size: 10 } } },
          y: { ticks: { callback: (v) => (v / 1000).toFixed(0) + 'k', font: { size: 10 } } },
        },
        plugins: { legend: { display: false }, tooltip: { ...baseOpts().plugins.tooltip, callbacks: { label: (c) => ` ${nf(c.parsed.y)} SOS/g (22K)` } } },
      }),
    }));

    // calculator
    const calc = () => {
      const w = parseFloat(document.getElementById('calcW').value) || 0;
      const k = Number(document.getElementById('calcK').value);
      const p = d.latest.find((x) => x.karat === k);
      const res = document.getElementById('calcRes');
      if (!p || !p.price_sos) { res.innerHTML = '<div class="no-data">Market price unavailable for this karat</div>'; return; }
      const derived = !p.price_sos ? true : false;
      res.innerHTML = `
        <div class="cr-row"><span>Estimated Market Value</span><b class="cr-big">${nf(w * p.price_sos)} SOS</b></div>
        ${p.price_usd ? `<div class="cr-row"><span>USD reference</span><b>${nf(w * p.price_usd, 0)} USD</b></div>` : ''}
        <div class="cr-note">at ${nf(p.price_sos)} SOS/g · ${k}K · ${p.live ? 'live' : 'manually updated'} price of ${dateShort(p.date)}</div>`;
    };
    document.getElementById('calcW').addEventListener('input', calc);
    document.getElementById('calcK').addEventListener('change', calc);
    calc();

    document.getElementById('mktSeg').addEventListener('click', async (e) => {
      const b = e.target.closest('button[data-r]');
      if (!b) return;
      MK.range = b.dataset.r;
      await loadMarket();
      render();
    });

    const mf = document.getElementById('mktForm');
    if (mf) mf.addEventListener('submit', async (e) => {
      e.preventDefault();
      const b = Object.fromEntries(new FormData(mf).entries());
      try {
        await api('/api/market', { method: 'POST', body: b });
        toast('Market price recorded');
        await loadMarket();
        render();
      } catch (err) { toast(err.message, false); }
    });
  };

  render();
}
async function loadMarket() {
  MK.data = await api('/api/market?range=' + MK.range);
}

/* ============================================================
   REPORTS
   ============================================================ */
const REPORTS = [
  { type: 'daily', ico: '📅', title: 'Daily Production Report', desc: 'All production records for one day', period: 'date' },
  { type: 'monthly', ico: '🗓️', title: 'Monthly Production Report', desc: 'Daily totals for one month', period: 'month' },
  { type: 'recovery', ico: '⚗️', title: 'Gold Recovery Report', desc: 'Gravity circuit performance, month', period: 'month' },
  { type: 'equipment', ico: '🏭', title: 'Equipment Status Report', desc: 'All equipment and current status', period: null },
  { type: 'inventory', ico: '🪙', title: 'Gold Inventory Report', desc: 'All batches and balance', period: null },
  { type: 'market', ico: '📈', title: 'Market Price Report', desc: 'Somaliland market records, month', period: 'month' },
];

async function pageReports() {
  const page = shell('Reports', 'Our Operation — History');
  const defaultDate = today();
  const defaultMonth = thisMonth();
  page.innerHTML = `
  <div class="report-grid">
    ${REPORTS.map((r) => `
      <div class="report-card">
        <div class="rc-top"><span class="rc-ico">${r.ico}</span><div><div class="rc-title">${r.title}</div><div class="rc-desc">${r.desc}</div></div></div>
        ${r.period ? `<div class="field" style="margin:12px 0"><label>Period</label><input type="${r.period}" data-rp="${r.type}" value="${r.period === 'date' ? defaultDate : defaultMonth}"></div>` : ''}
        <div class="rc-actions">
          <button class="btn ghost sm" data-rv="${r.type}">View</button>
          <button class="btn sm" data-rd="${r.type}" data-f="pdf">PDF</button>
          <button class="btn sm" data-rx="${r.type}" data-f="excel">Excel</button>
        </div>
      </div>`).join('')}
  </div>
  <div class="panel" style="margin-top:16px">
    <div class="panel-foot" style="margin:6px 0">
      <span>📄 <b>PDF</b> — branded document, prints cleanly, downloads directly.</span>
      <span>📊 <b>Excel</b> — .xlsx file you can filter and re-use.</span>
      ${state.cfg?.demo ? '<span class="gold">⚠️ DEMO DATA is currently active — reports will be stamped DEMO DATA.</span>' : ''}
    </div>
  </div>`;

  const getPeriod = (type) => {
    const el = page.querySelector(`[data-rp="${type}"]`);
    return el ? el.value : '';
  };

  page.querySelectorAll('[data-rv]').forEach((b) => b.addEventListener('click', async () => {
    const type = b.dataset.rv;
    const period = getPeriod(type);
    try {
      const d = await api('/api/reports?type=' + type + (period ? '&period=' + period : ''));
      const cols = {
        daily: ['Shift', 'Site', 'Ore (t)', 'Head grade (g/t)', 'Concentrate (kg)', 'Gold (g)', 'Recovery (%)', 'Operator'],
        monthly: ['Date', 'Site', 'Ore (t)', 'Gold (g)', 'Recovery (%)'],
        recovery: ['Date', 'Ore feed (t)', 'Concentrate (kg)', 'Gold (g)', 'Recovery (%)'],
        equipment: ['#', 'Name', 'Model', 'Capacity', 'Power', 'Qty', 'Status', 'Runtime (h)', 'Notes'],
        inventory: ['Batch', 'Date', 'Weight (g)', 'Karat', 'Purity (%)', 'Status', 'Sold date', 'Sold (SOS)'],
        market: ['Date', 'Time', 'Karat', 'Price (SOS/g)', 'USD/g', 'Source', 'Type'],
      }[type];
      const rowMap = {
        daily: (r) => [r.shift, r.site_name || '—', nf(r.ore_processed_t, 1), r.head_grade_gpt ?? '—', r.concentrate_weight_kg ?? '—', nf(r.gold_recovered_g, 1), r.recovery_pct ?? '—', r.operator || '—'],
        monthly: (r) => [r.date, r.site_name || '—', nf(r.ore, 1), nf(r.gold, 1), r.rec ?? '—'],
        recovery: (r) => [r.date, nf(r.ore_feed_t, 1), nf(r.concentrate_kg, 1), nf(r.gold_recovered_g, 1), r.recovery_pct ?? '—'],
        equipment: (r, i) => [i + 1, r.name, r.model || '—', r.capacity || '—', r.power || '—', r.qty, r.status, r.runtime_h ?? '—', r.notes || '—'],
        inventory: (r) => [r.batch_no, r.date, nf(r.weight_g, 0), r.karat + 'K', r.purity_pct ?? '—', r.status, r.sold_date || '—', r.sold_price_sos ? nf(r.sold_price_sos, 0) : '—'],
        market: (r) => [r.date, (r.ts || '').slice(11, 16), r.karat + 'K', nf(r.price_sos), r.price_usd ? nf(r.price_usd, 2) : '—', r.source, r.source_type],
      }[type];
      const body = openModal(`${REPORTS.find((x) => x.type === type).title}${period ? ' — ' + period : ''}`, `
        ${d.rows.length ? `<div class="tbl-wrap"><table class="tbl"><thead><tr>${cols.map((c) => `<th>${c}</th>`).join('')}</tr></thead>
        <tbody>${d.rows.map((r, i) => `<tr>${rowMap(r, i).map((v) => `<td>${esc(v)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`
        : '<div class="no-data">No Data for this period</div>'}`, true);
    } catch (e) { toast(e.message, false); }
  }));
  const doExport = (b) => {
    const type = b.dataset.rd || b.dataset.rx;
    const period = getPeriod(type);
    window.open('/api/reports/export?type=' + type + (period ? '&period=' + encodeURIComponent(period) : '') + '&format=' + (b.dataset.f || 'pdf'), '_blank');
  };
  page.querySelectorAll('[data-rd]').forEach((b) => b.addEventListener('click', () => doExport(b)));
  page.querySelectorAll('[data-rx]').forEach((b) => b.addEventListener('click', () => doExport(b)));
}

/* ============================================================
   SETTINGS
   ============================================================ */
async function pageSettings() {
  const page = shell('Settings', 'Administration');
  page.innerHTML = '<div class="loading"><div class="spinner"></div>Loading settings…</div>';
  let s;
  try { s = await api('/api/settings'); } catch (e) { page.innerHTML = `<div class="form-err">${esc(e.message)}</div>`; return; }

  page.innerHTML = `
  <div class="settings-grid">
    <div class="panel">
      <div class="panel-head"><div class="panel-title">Company</div></div>
      <form id="coForm" class="form-grid">
        <div class="field full"><label>Company Name</label><input name="company" value="${esc(s.company)}"></div>
        <div class="field full"><label>Tagline</label><input name="tagline" value="${esc(s.tagline)}"></div>
        <div class="field"><label>Currency</label><select name="currency"><option ${s.currency === 'SOS' ? 'selected' : ''}>SOS</option><option ${s.currency === 'USD' ? 'selected' : ''}>USD</option></select></div>
        <div class="field"><label>Logo</label>
          <div class="logo-row">
            <img class="logo-prev" src="${s.logo || '/img/logo.svg'}" alt="logo">
            <div>
              <input type="file" id="logoFile" accept="image/*" class="logo-input">
              <button type="button" class="btn ghost sm" id="logoClear">Remove</button>
            </div>
          </div>
        </div>
        <div class="full"><button class="btn primary" type="submit">SAVE COMPANY</button></div>
      </form>
    </div>

    <div class="panel">
      <div class="panel-head"><div class="panel-title">Production Targets</div></div>
      <form id="tgtForm" class="form-grid">
        <div class="field"><label>Daily Target (g)</label><input type="number" min="0" name="daily_target" value="${esc(s.daily_target)}"></div>
        <div class="field"><label>Monthly Target (g)</label><input type="number" min="0" name="monthly_target" value="${esc(s.monthly_target)}"></div>
        <div class="field"><label>Recovery Target (%)</label><input type="number" min="0" max="100" name="recovery_target" value="${esc(s.recovery_target)}"></div>
        <div class="full"><button class="btn primary" type="submit">SAVE TARGETS</button></div>
      </form>
    </div>

    <div class="panel">
      <div class="panel-head"><div class="panel-title">Mining Sites</div></div>
      <div class="tbl-wrap" style="margin-bottom:12px">
        <table class="tbl">
          <thead><tr><th>Site</th><th>Location</th><th>Status</th><th></th></tr></thead>
          <tbody id="siteRows">
            ${s.sites.map((x) => `<tr><td>${esc(x.name)}</td><td>${esc(x.location || '—')}</td><td><span class="badge ${x.status === 'Active' ? 'running' : 'offline'}">${esc(x.status)}</span></td><td class="num"><button class="btn ghost sm" data-site="${x.id}">Edit</button></td></tr>`).join('')}
          </tbody>
        </table>
      </div>
      <form id="siteForm" class="form-grid">
        <input type="hidden" name="id">
        <div class="field"><label>Site Name</label><input name="name" required></div>
        <div class="field"><label>Location</label><input name="location"></div>
        <div class="field"><label>Status</label><select name="status"><option>Active</option><option>Inactive</option></select></div>
        <div class="full"><button class="btn primary sm" type="submit">SAVE SITE</button></div>
      </form>
    </div>

    <div class="panel">
      <div class="panel-head"><div class="panel-title">Market Price</div></div>
      <form id="mktSrcForm" class="form-grid" style="margin-bottom:14px">
        <div class="field full"><label>Default Market Source</label><input name="market_source" value="${esc(s.market_source)}"></div>
        <div class="full"><button class="btn primary sm" type="submit">SAVE SOURCE</button></div>
      </form>
      <div class="hint">Manual price entry is on the <a href="#/market" class="gold">Market Price</a> page. API source: not connected yet — every price is marked <b>Manually Updated</b> until a verified live source is linked.</div>
    </div>

    <div class="panel">
      <div class="panel-head"><div class="panel-title">Users &amp; Roles</div></div>
      <div class="tbl-wrap" style="margin-bottom:12px">
        <table class="tbl">
          <thead><tr><th>User</th><th>Name</th><th>Role</th><th>Active</th></tr></thead>
          <tbody>
            ${s.users.map((u) => `
              <tr>
                <td><b>${esc(u.username)}</b></td>
                <td>${esc(u.name || '—')}</td>
                <td><select data-urole="${u.id}" ${u.username === state.user.username ? 'disabled' : ''}>
                  ${['admin', 'manager', 'operator'].map((r) => `<option ${u.role === r ? 'selected' : ''}>${r}</option>`).join('')}
                </select></td>
                <td><label class="chk"><input type="checkbox" data-uactive="${u.id}" ${u.active ? 'checked' : ''} ${u.username === state.user.username ? 'disabled' : ''}> </label>
                  <button class="btn ghost sm" data-usave="${u.id}">Save</button></td>
              </tr>`).join('')}
          </tbody>
        </table>
      </div>
      <form id="userForm" class="form-grid">
        <div class="field"><label>Username</label><input name="username" required></div>
        <div class="field"><label>Full Name</label><input name="name"></div>
        <div class="field"><label>Password</label><input type="password" name="password" required></div>
        <div class="field"><label>Role</label><select name="role"><option>operator</option><option>manager</option><option>admin</option></select></div>
        <div class="full"><button class="btn primary sm" type="submit">ADD USER</button></div>
      </form>
    </div>

    <div class="panel">
      <div class="panel-head"><div class="panel-title">Equipment Information</div><span class="tag manual">read only</span></div>
      <div class="tbl-wrap">
        <table class="tbl">
          <thead><tr><th>Equipment</th><th>Model</th><th>Capacity</th><th>Power</th></tr></thead>
          <tbody>
            ${s.equipment.map((e) => `<tr><td><b>${esc(e.name)}</b></td><td>${esc(e.model || '—')}</td><td>${esc(e.capacity || '—')}</td><td>${esc(e.power || '—')}</td></tr>`).join('')}
          </tbody>
        </table>
      </div>
      <div class="hint" style="margin-top:10px">Status and runtime are managed on the <a href="#/equipment" class="gold">Equipment</a> page.</div>
    </div>

    <div class="panel" ${s.demo ? 'style="border-color:rgba(240,180,41,.45)"' : ''}>
      <div class="panel-head"><div class="panel-title">Demo Data</div></div>
      ${s.demo
        ? `<p class="muted" style="font-size:13px;margin-bottom:12px">The application currently contains <b class="gold">DEMO DATA</b> for design review. When you are ready to use real numbers, clear it — the app will start from zero and show “No Data” until you record real values.</p>
           <button class="btn danger" id="clearDemo">CLEAR DEMO DATA</button>`
        : '<p class="muted" style="font-size:13px">Demo data is <b>not</b> active. All values shown in the application are real recorded data.</p>'}
    </div>
  </div>`;

  const saveSection = (formId, key, extra) => {
    const f = document.getElementById(formId);
    f.addEventListener('submit', async (e) => {
      e.preventDefault();
      const b = Object.fromEntries(new FormData(f).entries());
      if (extra) Object.assign(b, extra());
      try {
        await api('/api/settings', { method: 'POST', body: b });
        toast('Saved');
        pageSettings();
      } catch (err) { toast(err.message, false); }
    });
  };

  // logo state
  let logoData = s.logo || '';
  document.getElementById('logoFile').addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;
    if (file.size > 300 * 1024) { toast('Logo must be under 300 KB', false); return; }
    const rd = new FileReader();
    rd.onload = () => { logoData = rd.result; document.querySelector('.logo-prev').src = logoData; };
    rd.readAsDataURL(file);
  });
  document.getElementById('logoClear').addEventListener('click', () => { logoData = ''; document.querySelector('.logo-prev').src = '/img/logo.svg'; });
  saveSection('coForm', 'company', () => ({ logo: logoData }));
  saveSection('tgtForm', 'targets');
  saveSection('mktSrcForm', 'market');

  document.getElementById('siteForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = e.target;
    const b = { site: { id: f.id.value || null, name: f.name.value, location: f.location.value, status: f.status.value } };
    try {
      await api('/api/settings', { method: 'POST', body: b });
      toast('Site saved');
      pageSettings();
    } catch (err) { toast(err.message, false); }
  });
  page.querySelectorAll('[data-site]').forEach((btn) => btn.addEventListener('click', () => {
    const x = s.sites.find((v) => v.id == btn.dataset.site);
    const f = document.getElementById('siteForm');
    f.id.value = x.id; f.name.value = x.name; f.location.value = x.location || ''; f.status.value = x.status;
    f.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }));

  page.querySelectorAll('[data-usave]').forEach((btn) => btn.addEventListener('click', async () => {
    const id = btn.dataset.usave;
    const role = page.querySelector(`[data-urole="${id}"]`).value;
    const active = page.querySelector(`[data-uactive="${id}"]`).checked;
    try {
      await api('/api/settings', { method: 'POST', body: { user: { id: Number(id), role, active } } });
      toast('User updated');
      pageSettings();
    } catch (err) { toast(err.message, false); }
  }));
  document.getElementById('userForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const b = { user: Object.fromEntries(new FormData(e.target).entries()) };
    try {
      await api('/api/settings', { method: 'POST', body: b });
      toast('User added');
      pageSettings();
    } catch (err) { toast(err.message, false); }
  });

  const cd = document.getElementById('clearDemo');
  if (cd) cd.addEventListener('click', async () => {
    if (!confirm('Clear ALL demo data? Production, market prices, gold batches and equipment records will be removed. This cannot be undone.')) return;
    try {
      await api('/api/settings/clear-demo', { method: 'POST' });
      state.cfg.demo = false;
      toast('Demo data cleared — the app now starts from real data (currently empty)');
      pageSettings();
    } catch (err) { toast(err.message, false); }
  });
}

/* ============================================================
   ROUTER
   ============================================================ */
const ROUTES = {
  dashboard: pageDashboard,
  production: pageProduction,
  plant: pagePlant,
  equipment: pageEquipment,
  gold: pageGold,
  market: pageMarket,
  reports: pageReports,
  settings: pageSettings,
};

function parseRoute() {
  return location.hash.replace(/^#\//, '') || 'dashboard';
}

async function route() {
  destroyCharts();
  closeModal();
  const id = parseRoute();
  const allowed = NAV.find((n) => n.id === id && n.roles.includes(state.user.role));
  const key = allowed ? id : (NAV.find((n) => n.roles.includes(state.user.role)) || NAV[0]).id;
  state.route = key;
  try { await ROUTES[key](); } catch (e) {
    const p = document.getElementById('page');
    if (p) p.innerHTML = `<div class="form-err">${esc(e.message)}</div>`;
  }
}

(async () => {
  try {
    const me = await api('/api/auth/me');
    state.user = me.user;
    state.cfg = await api('/api/state');
    window.onhashchange = () => route();
    route();
  } catch {
    showLogin();
  }
})();
