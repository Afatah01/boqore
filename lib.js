import crypto from 'node:crypto';

// ---- Time helpers (company operates in Hargeysa, Africa/Mogadishu = UTC+3)
export const TZ = 'Africa/Mogadishu';

function fmtParts(date) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ,
    year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(date); // en-CA -> YYYY-MM-DD
}

export function todayEAT(date = new Date()) {
  return fmtParts(date);
}

export function daysAgoEAT(n, base = new Date()) {
  const d = new Date(base.getTime() - n * 86400000);
  return fmtParts(d);
}

export function nowEATClock(date = new Date()) {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: TZ, hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(date);
}

// ---- Password hashing (scrypt, no external deps)
export function hashPw(pw) {
  const salt = crypto.randomBytes(16);
  const h = crypto.scryptSync(String(pw), salt, 64);
  return salt.toString('hex') + ':' + h.toString('hex');
}

export function verifyPw(pw, stored) {
  try {
    const [s, h] = String(stored).split(':');
    const t = crypto.scryptSync(String(pw), Buffer.from(s, 'hex'), 64);
    return crypto.timingSafeEqual(t, Buffer.from(h, 'hex'));
  } catch {
    return false;
  }
}

// ---- Formatting helpers (server side)
export const round = (n, d = 2) => {
  const f = 10 ** d;
  return Math.round((Number(n) + Number.EPSILON) * f) / f;
};

export function monthPrefix(dateStr) {
  return dateStr.slice(0, 7);
}

// Previous month prefix for a YYYY-MM date
export function prevMonthPrefix(ym) {
  const [y, m] = ym.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 2, 1));
  return d.getUTCFullYear() + '-' + String(d.getUTCMonth() + 1).padStart(2, '0');
}
