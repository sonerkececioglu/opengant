// Zaman ölçeği: zoom seviyesine göre ızgara birimleri, etiketler ve yakalama (snap)
import { HOUR, DAY } from './model.js';

const MIN = 60e3;
const MONTHS = ['Oca', 'Şub', 'Mar', 'Nis', 'May', 'Haz', 'Tem', 'Ağu', 'Eyl', 'Eki', 'Kas', 'Ara'];
const MONTHS_LONG = ['Ocak', 'Şubat', 'Mart', 'Nisan', 'Mayıs', 'Haziran', 'Temmuz', 'Ağustos', 'Eylül', 'Ekim', 'Kasım', 'Aralık'];
const DAYS = ['Paz', 'Pzt', 'Sal', 'Çar', 'Per', 'Cum', 'Cmt'];
const pad = n => String(n).padStart(2, '0');

// Birimler: tür, adım, yaklaşık süre (ms)
const UNITS = [
  { k: 'min', n: 15, ms: 15 * MIN },
  { k: 'min', n: 30, ms: 30 * MIN },
  { k: 'hour', n: 1, ms: HOUR },
  { k: 'hour', n: 3, ms: 3 * HOUR },
  { k: 'hour', n: 6, ms: 6 * HOUR },
  { k: 'hour', n: 12, ms: 12 * HOUR },
  { k: 'day', n: 1, ms: DAY },
  { k: 'week', n: 1, ms: 7 * DAY },
  { k: 'month', n: 1, ms: 30 * DAY },
  { k: 'month', n: 3, ms: 91 * DAY },
  { k: 'year', n: 1, ms: 365 * DAY },
];

export function floorTo(u, t) {
  const d = new Date(t);
  switch (u.k) {
    case 'min': d.setMinutes(Math.floor(d.getMinutes() / u.n) * u.n, 0, 0); break;
    case 'hour': d.setHours(Math.floor(d.getHours() / u.n) * u.n, 0, 0, 0); break;
    case 'day': d.setHours(0, 0, 0, 0); break;
    case 'week': d.setHours(0, 0, 0, 0); d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); break;
    case 'month': d.setHours(0, 0, 0, 0); d.setDate(1); d.setMonth(Math.floor(d.getMonth() / u.n) * u.n); break;
    case 'year': d.setHours(0, 0, 0, 0); d.setMonth(0, 1); break;
  }
  return d.getTime();
}

export function addUnit(u, t) {
  const d = new Date(t);
  switch (u.k) {
    case 'min': d.setMinutes(d.getMinutes() + u.n); break;
    case 'hour': d.setHours(d.getHours() + u.n); break;
    case 'day': d.setDate(d.getDate() + 1); break;
    case 'week': d.setDate(d.getDate() + 7); break;
    case 'month': d.setMonth(d.getMonth() + u.n); break;
    case 'year': d.setFullYear(d.getFullYear() + 1); break;
  }
  return d.getTime();
}

// İnce birim: en az ~minPx genişliğinde olan en küçük birim
export function pickUnits(pxPerMs, minPx = 44) {
  let i = UNITS.findIndex(u => u.ms * pxPerMs >= minPx);
  if (i < 0) i = UNITS.length - 1;
  const fine = UNITS[i];
  let coarse;
  if (fine.k === 'min' || fine.k === 'hour') coarse = { k: 'day', n: 1 };
  else if (fine.k === 'day' || fine.k === 'week') coarse = { k: 'month', n: 1 };
  else coarse = { k: 'year', n: 1 };
  return { fine, coarse };
}

export function ticks(u, from, to) {
  const out = [];
  let t = floorTo(u, from);
  let guard = 0;
  while (t < to && guard++ < 2000) {
    const next = addUnit(u, t);
    out.push([t, next]);
    t = next;
  }
  return out;
}

export function fineLabel(u, t) {
  const d = new Date(t);
  switch (u.k) {
    case 'min':
    case 'hour': return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
    case 'day': return `${DAYS[d.getDay()]} ${d.getDate()}`;
    case 'week': return `${d.getDate()} ${MONTHS[d.getMonth()]}`;
    case 'month': return u.n === 3 ? `Ç${Math.floor(d.getMonth() / 3) + 1}` : MONTHS[d.getMonth()];
    case 'year': return String(d.getFullYear());
  }
}

export function coarseLabel(u, t) {
  const d = new Date(t);
  switch (u.k) {
    case 'day': return `${DAYS[d.getDay()]} ${d.getDate()} ${MONTHS_LONG[d.getMonth()]} ${d.getFullYear()}`;
    case 'month': return `${MONTHS_LONG[d.getMonth()]} ${d.getFullYear()}`;
    case 'year': return String(d.getFullYear());
  }
  return '';
}

// Sürükleme yakalama adımı: zoom'a göre 15 dk / 1 saat / 1 gün
export function snapStep(pxPerMs) {
  const pxPerHour = pxPerMs * HOUR;
  if (pxPerHour >= 16) return 15 * MIN;
  if (pxPerHour >= 1.5) return HOUR;
  return DAY;
}

export function snap(t, step) {
  if (step >= DAY) {
    const d = new Date(t + 12 * HOUR);
    d.setHours(0, 0, 0, 0);
    return d.getTime();
  }
  const off = -new Date(t).getTimezoneOffset() * MIN;
  return Math.round((t + off) / step) * step - off;
}

export function fmtDateTime(t) {
  const d = new Date(t);
  return `${d.getDate()} ${MONTHS[d.getMonth()]} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// "Sonsuz" bitiş: datetime-local alanının gösterebileceği son gün.
export const FOREVER = new Date(9999, 11, 31).getTime();

// Takvim günü ekler (yaz saati değişimlerinde de gece yarısında kalır).
export function addDays(t, n) {
  const d = new Date(t);
  d.setDate(d.getDate() + n);
  return d.getTime();
}

// Takvim ayı ekler; 31 Ocak + 1 ay = 28/29 Şubat (taşmaz).
export function addMonths(t, n) {
  const d = new Date(t);
  const day = d.getDate();
  d.setDate(1);
  d.setMonth(d.getMonth() + n);
  const last = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
  d.setDate(Math.min(day, last));
  return d.getTime();
}

export function fmtRange(s, e) {
  if (e >= FOREVER) return `${fmtDateTime(s)} → ∞ (sonsuz)`;
  const dur = e - s;
  let durTxt;
  if (dur < DAY) {
    const h = Math.floor(dur / HOUR), m = Math.round((dur % HOUR) / MIN);
    durTxt = h ? (m ? `${h} sa ${m} dk` : `${h} sa`) : `${m} dk`;
  } else {
    const days = dur / DAY;
    durTxt = Number.isInteger(days) ? `${days} gün` : `${days.toFixed(1)} gün`;
  }
  return `${fmtDateTime(s)} → ${fmtDateTime(e)} (${durTxt})`;
}

export function toInput(t) {
  if (t == null) return '';
  const d = new Date(t);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function fromInput(v) {
  if (!v) return null;
  const t = new Date(v).getTime();
  return Number.isNaN(t) ? null : t;
}
