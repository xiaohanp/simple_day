// DayFlow plain-text schedule parser.
// Format:
//   ## <date heading>            e.g. "## 2026-10-08", "## Thu Oct 8", "## tomorrow"
//   09:00 Thesis writing 4h !15  -> fixed start, duration 4h, remind 15 min before
//   09:00 Standup                -> remind right at 09:00 (the default)
//   09:00-13:00 Deep work !10    -> fixed start and end
//   French 30m                   -> "floating": starts right after the previous item ends
//   Buy milk                     -> task with no time
//
// Moving a fixed time (e.g. 15:00 -> 15:30) automatically shifts every floating
// item that follows it, and all end times adapt accordingly.

const MONTHS = {
  jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5,
  jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11,
};
const WEEKDAYS = {
  sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6,
};

function pad(n) { return String(n).padStart(2, '0'); }

export function toISODate(d) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function fmtTime(mins) {
  if (mins == null) return '';
  const m = ((mins % 1440) + 1440) % 1440;
  return `${pad(Math.floor(m / 60))}:${pad(m % 60)}`;
}

export function fmtDur(mins) {
  if (!mins) return '';
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  if (h && m) return `${h}h${m}m`;
  if (h) return `${h}h`;
  return `${m}m`;
}

function monthFromName(name) {
  const key = name.slice(0, 3).toLowerCase();
  return MONTHS[key] !== undefined ? MONTHS[key] : null;
}

// Resolve a heading string into { date: Date|null, label: string }
export function parseDayHeading(raw, today = new Date()) {
  let s = raw.trim();
  // ISO: 2026-10-08
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})\b(.*)$/);
  if (m) {
    return { date: new Date(+m[1], +m[2] - 1, +m[3]), label: m[4].trim() };
  }
  const lower = s.toLowerCase();
  if (/^today\b/.test(lower)) {
    return { date: new Date(today.getFullYear(), today.getMonth(), today.getDate()), label: s.replace(/^today/i, '').trim() };
  }
  if (/^tomorrow\b/.test(lower)) {
    const d = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 1);
    return { date: d, label: s.replace(/^tomorrow/i, '').trim() };
  }
  // Weekday prefix is optional decoration: "Thu Oct 8", "Thursday 2026-10-08"
  let rest = s;
  const wd = lower.match(/^(mon|tue|wed|thu|fri|sat|sun)[a-z]*\b[,\s]*/);
  let weekdayOnly = null;
  if (wd) {
    weekdayOnly = WEEKDAYS[wd[1]];
    rest = s.slice(wd[0].length).trim();
  }
  // "Oct 8 [2026]" or "October 8th, 2026"
  m = rest.match(/^([A-Za-z]+)\s+(\d{1,2})(?:st|nd|rd|th)?[,\s]*(\d{4})?(.*)$/);
  if (m && monthFromName(m[1]) !== null) {
    const mon = monthFromName(m[1]);
    let year = m[3] ? +m[3] : today.getFullYear();
    let d = new Date(year, mon, +m[2]);
    if (!m[3]) {
      // no year given: if the date is more than 60 days in the past, roll to next year
      const diff = (d - today) / 86400000;
      if (diff < -60) d = new Date(year + 1, mon, +m[2]);
    }
    return { date: d, label: (m[4] || '').trim() };
  }
  // "8 Oct [2026]"
  m = rest.match(/^(\d{1,2})(?:st|nd|rd|th)?\s+([A-Za-z]+)[,\s]*(\d{4})?(.*)$/);
  if (m && monthFromName(m[2]) !== null) {
    const mon = monthFromName(m[2]);
    let year = m[3] ? +m[3] : today.getFullYear();
    let d = new Date(year, mon, +m[1]);
    if (!m[3]) {
      const diff = (d - today) / 86400000;
      if (diff < -60) d = new Date(year + 1, mon, +m[1]);
    }
    return { date: d, label: (m[4] || '').trim() };
  }
  // Bare weekday: "Friday" -> next occurrence (today if it matches)
  if (weekdayOnly !== null && rest === '') {
    const base = new Date(today.getFullYear(), today.getMonth(), today.getDate());
    const delta = (weekdayOnly - base.getDay() + 7) % 7;
    const d = new Date(base.getFullYear(), base.getMonth(), base.getDate() + delta);
    return { date: d, label: '' };
  }
  return { date: null, label: s };
}

const TIME_RE = /^(\d{1,2}):(\d{2})(?:\s*[-–]\s*(\d{1,2}):(\d{2}))?\s+/;
const DUR_RE = /(?:^|\s)(\d+(?:\.\d+)?)\s*h(?:\s*(\d{1,2})\s*m)?\+?(?=\s|$)|(?:^|\s)(\d{1,3})\s*m(?:in)?\+?(?=\s|$)/i;
const REMIND_RE = /(?:^|\s)!(\d{1,3})\s*(h|m)?(?=\s|$)|(?:^|\s)!(off)(?=\s|$)/i;

// Parse one item line -> { startMin, endMin, durationMin, remindMin|null|false, title, raw }
export function parseItemLine(line) {
  let s = line.trim();
  if (!s) return null;
  let startMin = null, endMin = null;

  const t = s.match(TIME_RE);
  if (t) {
    startMin = (+t[1]) * 60 + (+t[2]);
    if (t[3] !== undefined) endMin = (+t[3]) * 60 + (+t[4]);
    s = s.slice(t[0].length);
  }

  let remindMin = null; // null = use default, false = disabled, number = minutes
  const r = s.match(REMIND_RE);
  if (r) {
    if (r[3]) remindMin = false;
    else remindMin = r[2] === 'h' ? (+r[1]) * 60 : (+r[1]);
    s = s.replace(REMIND_RE, ' ').trim();
  }

  let durationMin = null;
  const d = s.match(DUR_RE);
  if (d) {
    if (d[1] !== undefined) {
      durationMin = Math.round(parseFloat(d[1]) * 60) + (d[2] ? +d[2] : 0);
    } else {
      durationMin = +d[3];
    }
    s = s.replace(DUR_RE, ' ').trim();
  }

  if (endMin !== null && durationMin === null) {
    durationMin = endMin >= startMin ? endMin - startMin : endMin + 1440 - startMin;
  }
  if (durationMin !== null && endMin === null && startMin !== null) {
    endMin = startMin + durationMin;
  }

  return {
    startMin, endMin, durationMin,
    remindMin,
    title: s.replace(/\s{2,}/g, ' ').trim() || '(untitled)',
    raw: line,
  };
}

// Parse the whole document -> { days: [...], inbox: [...] }
// Each day: { dateISO, date, label, items: [{ ...parsed, startMin, endMin, floating }] }
export function parseSchedule(text, today = new Date()) {
  const lines = text.split('\n');
  const days = [];
  const inbox = [];
  let current = null;
  let lineNo = -1;

  for (const line of lines) {
    lineNo++;
    const trimmed = line.trim();
    const hm = trimmed.match(/^#{1,3}\s+(.*)$/);
    if (hm) {
      const h = parseDayHeading(hm[1], today);
      current = {
        dateISO: h.date ? toISODate(h.date) : null,
        date: h.date,
        label: h.label,
        headingLine: lineNo,
        items: [],
      };
      days.push(current);
      continue;
    }
    const item = parseItemLine(line);
    if (!item) continue;
    item.line = lineNo;
    if (current) current.items.push(item);
    else inbox.push(item);
  }

  // Flow pass: resolve floating start/end times per day
  for (const day of days) {
    let cursor = null;
    for (const it of day.items) {
      if (it.startMin !== null) {
        it.floating = false;
        if (cursor !== null && it.startMin < cursor) {
          // overlapping fixed item: keep its time, but push cursor forward
          cursor = Math.max(cursor, it.endMin !== null ? it.endMin : it.startMin);
        } else {
          cursor = it.endMin !== null ? it.endMin : it.startMin;
        }
      } else if (cursor !== null) {
        it.floating = true;
        it.startMin = cursor;
        if (it.durationMin) {
          it.endMin = it.startMin + it.durationMin;
          cursor = it.endMin;
        } else {
          it.endMin = it.startMin;
        }
      } else {
        it.floating = true; // unanchored task: no time yet
      }
    }
    // day span for display
    const timed = day.items.filter(i => i.startMin !== null);
    day.startMin = timed.length ? Math.min(...timed.map(i => i.startMin)) : null;
    day.endMin = timed.length ? Math.max(...timed.map(i => i.endMin ?? i.startMin)) : null;
  }

  return { days, inbox };
}

export function dayLabel(dateISO, today = new Date()) {
  const todayISO = toISODate(today);
  const tmr = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 1);
  const [y, mo, da] = dateISO.split('-').map(Number);
  const d = new Date(y, mo - 1, da);
  const wd = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][d.getDay()];
  const mon = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][d.getMonth()];
  const base = `${wd} ${mon} ${da}`;
  if (dateISO === todayISO) return { main: 'Today', sub: base };
  if (dateISO === toISODate(tmr)) return { main: 'Tomorrow', sub: base };
  return { main: base, sub: String(y) };
}

// Compute absolute notification fire times (UTC ms) for dated days.
// tz conversion: wall-clock time in `tz` -> UTC, via Intl.
export function zonedTimeToUTC(dateISO, minutes, tz) {
  const [y, mo, da] = dateISO.split('-').map(Number);
  // Start from the UTC guess, then correct using the zone's offset at that instant.
  let guess = Date.UTC(y, mo - 1, da, 0, minutes, 0);
  for (let i = 0; i < 3; i++) {
    const offset = tzOffsetMs(guess, tz);
    const corrected = Date.UTC(y, mo - 1, da, 0, minutes, 0) - offset;
    if (corrected === guess) break;
    guess = corrected;
  }
  return guess;
}

function tzOffsetMs(utcMs, tz) {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone: tz, hour12: false,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
  const parts = dtf.formatToParts(new Date(utcMs));
  const get = (t) => +(parts.find(p => p.type === t).value);
  const asUTC = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour') % 24, get('minute'), get('second'));
  return asUTC - utcMs;
}

// Build the notification list the worker will fire.
// settings: { tz, digestOn, digestTime }
export function buildNotifications(parsed, settings, now = Date.now()) {
  const out = [];
  for (const day of parsed.days) {
    if (!day.dateISO) continue;
    for (const it of day.items) {
      if (it.startMin === null) continue;
      const rem = it.remindMin === null ? 0 : it.remindMin; // default: right at the start time
      if (rem === false) continue;
      const fireAt = zonedTimeToUTC(day.dateISO, it.startMin, settings.tz) - rem * 60000;
      if (fireAt < now - 30 * 60000) continue; // long past
      out.push({
        key: `${day.dateISO}|${it.line}|${it.startMin}|${rem}`,
        fireAt,
        text: `${rem ? `in ${fmtDur(rem)} · ` : ''}${fmtTime(it.startMin)}  ${it.title}${it.durationMin ? ` (${fmtDur(it.durationMin)})` : ''}`,
      });
    }
    // daily digest
    if (settings.digestOn && day.items.length) {
      const [hh, mm] = (settings.digestTime || '08:00').split(':').map(Number);
      const fireAt = zonedTimeToUTC(day.dateISO, hh * 60 + mm, settings.tz);
      if (fireAt > now - 30 * 60000) {
        const timed = day.items.filter(i => i.startMin !== null);
        const untimed = day.items.filter(i => i.startMin === null);
        const lines = timed.map(i => `${fmtTime(i.startMin)}  ${i.title}${i.durationMin ? ` (${fmtDur(i.durationMin)})` : ''}`);
        if (untimed.length) lines.push(`anytime: ${untimed.map(i => i.title).join(', ')}`);
        out.push({
          key: `digest|${day.dateISO}|${settings.digestTime}|${day.items.length}|${lines.join('').length}`,
          fireAt,
          text: `Today's plan\n${lines.join('\n')}`,
        });
      }
    }
  }
  out.sort((a, b) => a.fireAt - b.fireAt);
  return out;
}
