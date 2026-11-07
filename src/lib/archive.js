// Weekly archive. Once a calendar week (Mon–Sun) is over, its days are cut from
// the plan text and kept as plain text in a per-week chunk:
//   archive = { '2026-10-26': '## Mon Oct 26 2026\n09:00 ...\n\n## Tue Oct 27 2026\n...' }
// The key is that week's Monday. Archived headings always carry the year, so they
// never get re-read as a future date.
import { parseSchedule, toISODate } from './parser.js';

const WD = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function fromISO(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d);
}

// Monday of the week that contains the date (local time).
export function weekStartISO(date = new Date()) {
  const d = typeof date === 'string' ? fromISO(date) : date;
  const back = (d.getDay() + 6) % 7;
  return toISODate(new Date(d.getFullYear(), d.getMonth(), d.getDate() - back));
}

// "Oct 26 – Nov 1 2026"
export function weekLabel(mondayISO) {
  const a = fromISO(mondayISO);
  const b = new Date(a.getFullYear(), a.getMonth(), a.getDate() + 6);
  return `${MON[a.getMonth()]} ${a.getDate()} – ${MON[b.getMonth()]} ${b.getDate()} ${b.getFullYear()}`;
}

function heading(day) {
  const d = fromISO(day.dateISO);
  return `## ${WD[d.getDay()]} ${MON[d.getMonth()]} ${d.getDate()} ${d.getFullYear()}${day.label ? ` ${day.label}` : ''}`;
}

// Each day section of a text: its line range and its normalized text.
function sections(text, today) {
  const lines = text.split('\n');
  const { days } = parseSchedule(text, today);
  return days.map((day, i) => {
    const start = day.headingLine;
    const end = i + 1 < days.length ? days[i + 1].headingLine : lines.length;
    const body = lines.slice(start + 1, end);
    while (body.length && !body[body.length - 1].trim()) body.pop();
    return { dateISO: day.dateISO, start, end, text: day.dateISO ? [heading(day), ...body].join('\n') : null };
  });
}

// Add sections to one week's chunk: sorted by date, exact duplicates skipped.
function mergeWeek(chunk, adds) {
  const all = chunk ? sections(chunk).filter((s) => s.dateISO) : [];
  for (const s of adds) {
    if (!all.some((x) => x.dateISO === s.dateISO && x.text === s.text)) all.push(s);
  }
  all.sort((a, b) => a.dateISO.localeCompare(b.dateISO)); // stable: same-day sections keep their order
  return all.map((s) => s.text).join('\n\n') + '\n';
}

// Move every day before this week's Monday from `text` into `archive`.
// Returns null when nothing needs to move.
export function archivePastWeeks(text, archive, today = new Date()) {
  const cutoff = weekStartISO(today);
  const secs = sections(text, today).filter((s) => s.dateISO && s.dateISO < cutoff);
  if (!secs.length) return null;

  const drop = new Set();
  const byWeek = {};
  for (const s of secs) {
    for (let l = s.start; l < s.end; l++) drop.add(l);
    (byWeek[weekStartISO(s.dateISO)] ||= []).push(s);
  }
  const next = { ...archive };
  for (const [wk, adds] of Object.entries(byWeek)) next[wk] = mergeWeek(next[wk], adds);

  const rest = text
    .split('\n')
    .filter((_, i) => !drop.has(i))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/^\n+/, '');
  return { text: rest, archive: next };
}

// Combine two archives (e.g. local and synced from another device).
export function mergeArchives(a = {}, b = {}) {
  const out = { ...a };
  for (const [wk, chunk] of Object.entries(b)) {
    if (typeof chunk !== 'string') continue;
    out[wk] = out[wk] ? mergeWeek(out[wk], sections(chunk).filter((s) => s.dateISO)) : chunk;
  }
  return out;
}
