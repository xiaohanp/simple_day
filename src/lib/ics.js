// Minimal iCalendar (.ics) reader: VEVENTs -> DayFlow items in the user's timezone.
// Handles timed and all-day events, TZID / UTC / floating times, DTEND or
// DURATION, recurring events (RRULE + EXDATE + moved occurrences), cancelled
// events, and maps a "N minutes before" VALARM to the item's reminder.
// Only today onward is imported; recurring events are expanded RECUR_DAYS ahead.

import { zonedTimeToUTC } from './parser.js';

const DAY = 86400000;
const RECUR_DAYS = 90;
const MAX_ALLDAY_SPAN = 14;
const WEEKDAYS = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];

// ---- low-level parsing

function unfold(text) {
  return text.replace(/\r\n?/g, '\n').replace(/\n[ \t]/g, '');
}

// NAME;P=V;P2="V":value (a colon inside quoted params doesn't end the name)
function parseLine(line) {
  let i = 0, inQ = false;
  for (; i < line.length; i++) {
    const c = line[i];
    if (c === '"') inQ = !inQ;
    else if (c === ':' && !inQ) break;
  }
  const [name, ...ps] = line.slice(0, i).split(';');
  const params = {};
  for (const p of ps) {
    const k = p.indexOf('=');
    if (k > 0) params[p.slice(0, k).toUpperCase()] = p.slice(k + 1).replace(/^"|"$/g, '');
  }
  return { name: name.toUpperCase(), params, value: line.slice(i + 1) };
}

const unescape = (v) => v.replace(/\\([\\;,nN])/g, (_, c) => (c === 'n' || c === 'N' ? ' ' : c));

// "20261008" | "20261008T090000" | "20261008T090000Z" -> { date, min|null, utc, tz }
function parseDate(value, params) {
  const m = value.trim().match(/^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})?(Z)?)?$/);
  if (!m) return null;
  return {
    date: `${m[1]}-${m[2]}-${m[3]}`,
    min: m[4] !== undefined ? (+m[4]) * 60 + (+m[5]) : null,
    utc: !!m[7],
    tz: params.TZID || null,
  };
}

// "-PT15M" -> -15, "P1D" -> 1440 (minutes, signed); null if not a duration
function parseDuration(v) {
  const m = v.trim().match(/^([+-])?P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/);
  if (!m) return null;
  const mins = (+m[2] || 0) * 10080 + (+m[3] || 0) * 1440 + (+m[4] || 0) * 60 + (+m[5] || 0) + Math.floor((+m[6] || 0) / 60);
  return m[1] === '-' ? -mins : mins;
}

function parseRule(v) {
  const r = {};
  for (const part of v.split(';')) {
    const [k, val] = part.split('=');
    if (k && val) r[k.toUpperCase()] = val.toUpperCase();
  }
  return r;
}

// ---- time zones

function validTz(tz) {
  try { new Intl.DateTimeFormat('en-US', { timeZone: tz }); return true; } catch { return false; }
}

// Accept "Europe/Paris" and vendor-prefixed forms like "/mozilla.org/.../Europe/Paris".
function resolveTz(tz, fallback) {
  if (!tz) return fallback;
  if (validTz(tz)) return tz;
  const parts = tz.split('/').filter(Boolean);
  for (let i = 0; i < parts.length - 1; i++) {
    const t = parts.slice(i).join('/');
    if (validTz(t)) return t;
  }
  return fallback;
}

function toInstant(d, date, fallbackTz) {
  if (d.utc) {
    const [y, mo, da] = date.split('-').map(Number);
    return Date.UTC(y, mo - 1, da, 0, d.min);
  }
  return zonedTimeToUTC(date, d.min, resolveTz(d.tz, fallbackTz));
}

// UTC ms -> wall clock { date, min } in tz
function wallIn(utcMs, tz) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz, hourCycle: 'h23',
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
  }).formatToParts(new Date(utcMs));
  const get = (t) => parts.find((p) => p.type === t).value;
  return { date: `${get('year')}-${get('month')}-${get('day')}`, min: (+get('hour') % 24) * 60 + (+get('minute')) };
}

// ---- date arithmetic on plain "YYYY-MM-DD" (via UTC so DST never interferes)

const isoMs = (iso) => { const [y, m, d] = iso.split('-').map(Number); return Date.UTC(y, m - 1, d); };
const msIso = (ms) => new Date(ms).toISOString().slice(0, 10);
const addDays = (iso, n) => msIso(isoMs(iso) + n * DAY);
const daysBetween = (a, b) => Math.round((isoMs(b) - isoMs(a)) / DAY);

function ymd(y, m, d) { // month may overflow; returns null for invalid days (e.g. Feb 30)
  const dt = new Date(Date.UTC(y, m, d));
  return dt.getUTCDate() === d ? msIso(dt.getTime()) : null;
}

// Days of month m matching weekday wd: the nth one (1..5, or -1..-5 from the end), or all if n is 0.
function weekdaysOfMonth(y, m, n, wd) {
  const days = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  const all = [];
  for (let d = 1; d <= days; d++) if (new Date(Date.UTC(y, m, d)).getUTCDay() === wd) all.push(ymd(y, m, d));
  if (!n) return all;
  const d = n > 0 ? all[n - 1] : all[all.length + n];
  return d ? [d] : [];
}

// Dates (in the event's own calendar) on which a recurring event occurs, up to `horizon`.
function occurrences(first, rule, horizon) {
  const interval = Math.max(1, +rule.INTERVAL || 1);
  const count = rule.COUNT ? +rule.COUNT : Infinity;
  const until = rule.UNTIL ? `${rule.UNTIL.slice(0, 4)}-${rule.UNTIL.slice(4, 6)}-${rule.UNTIL.slice(6, 8)}` : null;
  const byday = rule.BYDAY ? rule.BYDAY.split(',').map((s) => {
    const m = s.match(/^([+-]?\d+)?(SU|MO|TU|WE|TH|FR|SA)$/);
    return m ? { n: m[1] ? +m[1] : 0, wd: WEEKDAYS.indexOf(m[2]) } : null;
  }).filter(Boolean) : null;
  const bymonthday = rule.BYMONTHDAY ? rule.BYMONTHDAY.split(',').map(Number) : null;
  const [fy, fm, fd] = first.split('-').map(Number);
  const firstDow = new Date(isoMs(first)).getUTCDay();

  const out = [];
  for (let k = 0; k < 5000; k++) {
    let cands;
    if (rule.FREQ === 'DAILY') {
      cands = [addDays(first, k * interval)];
    } else if (rule.FREQ === 'WEEKLY') {
      const weekStart = addDays(first, -firstDow + k * 7 * interval);
      cands = (byday || [{ wd: firstDow }]).map((b) => addDays(weekStart, b.wd));
    } else if (rule.FREQ === 'MONTHLY') {
      const y = fy, m = fm - 1 + k * interval;
      if (byday) cands = byday.flatMap((b) => weekdaysOfMonth(y, m, b.n, b.wd));
      else cands = (bymonthday || [fd]).map((d) => (d > 0 ? ymd(y, m, d) : ymd(y, m + 1, d + 1)));
    } else if (rule.FREQ === 'YEARLY') {
      cands = [ymd(fy + k * interval, fm - 1, fd)];
    } else {
      return [first];
    }
    cands = cands.filter(Boolean).sort();
    if (!cands.length) continue;
    for (const c of cands) {
      if (c < first) continue;
      if ((until && c > until) || c > horizon || out.length >= count) return out;
      out.push(c);
    }
  }
  return out;
}

// ---- public

// -> { items: [{ dateISO, startMin|null, durationMin|null, remindMin|null, title }], found }
export function parseIcs(text, tz, now = new Date()) {
  const events = [];
  let ev = null, inAlarm = false;
  for (const raw of unfold(text).split('\n')) {
    if (!raw.trim()) continue;
    const { name, params, value } = parseLine(raw);
    const v = value.trim().toUpperCase();
    if (name === 'BEGIN' && v === 'VEVENT') { ev = { exdates: [] }; continue; }
    if (!ev) continue;
    if (name === 'BEGIN' && v === 'VALARM') { inAlarm = true; continue; }
    if (name === 'END' && v === 'VALARM') { inAlarm = false; continue; }
    if (name === 'END' && v === 'VEVENT') { events.push(ev); ev = null; continue; }
    if (inAlarm) {
      if (name === 'TRIGGER' && params.RELATED !== 'END' && ev.alarm === undefined) {
        const m = parseDuration(value);
        if (m !== null && m <= 0) ev.alarm = -m;
      }
      continue;
    }
    switch (name) {
      case 'SUMMARY': ev.title = unescape(value).trim(); break;
      case 'DTSTART': ev.start = parseDate(value, params); break;
      case 'DTEND': ev.end = parseDate(value, params); break;
      case 'DURATION': ev.duration = parseDuration(value); break;
      case 'RRULE': ev.rule = parseRule(value); break;
      case 'EXDATE': for (const x of value.split(',')) { const d = parseDate(x, params); if (d) ev.exdates.push(d); } break;
      case 'RECURRENCE-ID': ev.recurId = parseDate(value, params); break;
      case 'UID': ev.uid = value.trim(); break;
      case 'STATUS': ev.cancelled = v === 'CANCELLED'; break;
    }
  }

  const todayISO = wallIn(now.getTime(), tz).date;
  const horizon = addDays(todayISO, RECUR_DAYS);
  // An occurrence's identity, so EXDATEs and moved instances (RECURRENCE-ID) can remove it.
  const occKey = (d, date) => (d.min === null ? date : String(toInstant(d, date, tz)));
  const moved = new Set(events.filter((e) => e.recurId && e.uid).map((e) => `${e.uid}|${occKey(e.recurId, e.recurId.date)}`));

  const items = [];
  for (const e of events) {
    if (!e.start || e.cancelled) continue;
    const title = e.title || 'Untitled';
    const exdates = new Set(e.exdates.map((d) => occKey(d, d.date)));
    const dates = e.rule && !e.recurId ? occurrences(e.start.date, e.rule, horizon) : [e.start.date];
    const remindMin = e.alarm > 0 ? e.alarm : null;

    for (const date of dates) {
      const key = occKey(e.start, date);
      if (exdates.has(key) || (e.rule && moved.has(`${e.uid}|${key}`))) continue;

      if (e.start.min === null) { // all-day: one untimed item per day it spans
        const span = e.end ? daysBetween(e.start.date, e.end.date) : e.duration ? Math.ceil(e.duration / 1440) : 1;
        for (let i = 0; i < Math.min(Math.max(span, 1), MAX_ALLDAY_SPAN); i++) {
          const d = addDays(date, i);
          if (d >= todayISO) items.push({ dateISO: d, startMin: null, durationMin: null, remindMin: null, title });
        }
        continue;
      }

      const startMs = toInstant(e.start, date, tz);
      let durationMin = e.duration ?? null;
      if (e.end && e.end.min !== null) {
        durationMin = Math.round((toInstant(e.end, e.end.date, tz) - toInstant(e.start, e.start.date, tz)) / 60000);
      }
      const w = wallIn(startMs, tz);
      if (w.date < todayISO) continue;
      items.push({ dateISO: w.date, startMin: w.min, durationMin: durationMin > 0 ? durationMin : null, remindMin, title });
    }
  }

  items.sort((a, b) => a.dateISO.localeCompare(b.dateISO) || (a.startMin ?? 1e9) - (b.startMin ?? 1e9));
  return { items, found: events.length };
}
