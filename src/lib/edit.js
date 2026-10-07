// Structured edits on top of the plain-text schedule.
// The text stays the source of truth (it's what syncs to the worker); these
// helpers let the UI add / change / move / delete items without the user
// touching the text. Every mutation returns { text, line } where `line` is the
// item's line number afterwards, so an open editor can keep tracking it.

import { parseDayHeading, parseItemLine, toISODate, fmtTime, fmtDur } from './parser.js';

const HEADING_RE = /^#{1,3}\s+(.*)$/;
const WD = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function isoToDate(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d);
}

export function shiftISO(iso, days) {
  const d = isoToDate(iso);
  return toISODate(new Date(d.getFullYear(), d.getMonth(), d.getDate() + days));
}

export function headingFor(iso) {
  const d = isoToDate(iso);
  return `## ${WD[d.getDay()]} ${MON[d.getMonth()]} ${d.getDate()} ${d.getFullYear()}`;
}

// { startMin|null, durationMin|null, remindMin: null|false|number, title } -> "09:00 Title 1h !15"
export function serializeItem({ startMin, durationMin, remindMin, title }) {
  const parts = [];
  if (startMin !== null && startMin !== undefined) parts.push(fmtTime(startMin));
  parts.push((title || '').trim() || 'Untitled');
  if (durationMin) parts.push(fmtDur(durationMin));
  if (remindMin === false) parts.push('!off');
  else if (typeof remindMin === 'number') parts.push(`!${remindMin}`);
  return parts.join(' ');
}

// The editable value of a parsed item. Floating items have no explicit start.
export function itemValue(it, dateISO) {
  return {
    dateISO: dateISO ?? null,
    startMin: it.floating ? null : it.startMin,
    durationMin: it.durationMin,
    remindMin: it.remindMin,
    title: it.title === '(untitled)' ? '' : it.title,
  };
}

function sections(lines) {
  const out = [];
  lines.forEach((l, i) => {
    const m = l.trim().match(HEADING_RE);
    if (!m) return;
    const h = parseDayHeading(m[1]);
    out.push({ start: i, dateISO: h.date ? toISODate(h.date) : null });
  });
  out.forEach((s, k) => { s.end = k + 1 < out.length ? out[k + 1].start : lines.length; });
  return out;
}

// Returns the heading line index for `iso`, inserting a new day in date order if needed.
function ensureDay(lines, iso) {
  const secs = sections(lines);
  const hit = secs.find((s) => s.dateISO === iso);
  if (hit) return hit.start;
  const later = secs
    .filter((s) => s.dateISO && s.dateISO > iso)
    .sort((a, b) => a.dateISO.localeCompare(b.dateISO))[0];
  const heading = headingFor(iso);
  if (later) {
    lines.splice(later.start, 0, heading, '');
    return later.start;
  }
  while (lines.length && !lines[lines.length - 1].trim()) lines.pop();
  if (lines.length) lines.push('');
  lines.push(heading);
  return lines.length - 1;
}

// Fixed-time items go before the first item that explicitly starts later;
// everything else is appended to the end of the day.
function insertIntoDay(lines, headingIdx, str, startMin) {
  const sec = sections(lines).find((s) => s.start === headingIdx);
  let at = headingIdx + 1;
  for (let i = headingIdx + 1; i < sec.end; i++) {
    if (!lines[i].trim()) continue;
    if (startMin !== null && startMin !== undefined) {
      const p = parseItemLine(lines[i]);
      if (p && p.startMin !== null && p.startMin > startMin) { at = i; break; }
    }
    at = i + 1;
  }
  lines.splice(at, 0, str);
  return at;
}

export function addItem(text, value) {
  const lines = text.split('\n');
  const h = ensureDay(lines, value.dateISO);
  const at = insertIntoDay(lines, h, serializeItem(value), value.startMin);
  return { text: lines.join('\n'), line: at };
}

export function updateItem(text, line, value, prevDateISO) {
  const lines = text.split('\n');
  const str = serializeItem(value);
  if ((value.dateISO ?? null) === (prevDateISO ?? null)) {
    lines[line] = str;
    return { text: lines.join('\n'), line };
  }
  lines.splice(line, 1);
  const h = ensureDay(lines, value.dateISO);
  const at = insertIntoDay(lines, h, str, value.startMin);
  return { text: lines.join('\n'), line: at };
}

export function deleteItem(text, line) {
  const lines = text.split('\n');
  lines.splice(line, 1);
  return { text: lines.join('\n'), line: null };
}

// Swap with the previous (dir=-1) or next (dir=1) item in the same day.
export function moveItem(text, line, dir) {
  const lines = text.split('\n');
  const secs = sections(lines);
  const sec = secs.find((s) => line > s.start && line < s.end);
  const lo = sec ? sec.start + 1 : 0;
  const hi = sec ? sec.end : (secs[0]?.start ?? lines.length);
  let j = line + dir;
  while (j >= lo && j < hi && !lines[j].trim()) j += dir;
  if (j < lo || j >= hi) return { text, line };
  [lines[line], lines[j]] = [lines[j], lines[line]];
  return { text: lines.join('\n'), line: j };
}
