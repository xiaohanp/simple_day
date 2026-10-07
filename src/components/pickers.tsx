// @ts-nocheck
// Interactive selectors shared by the composer and every item editor:
// date (calendar), start time, duration and reminder. Each one is a chip that
// opens a small popover.
import { useEffect, useRef, useState } from 'react';
import * as Popover from '@radix-ui/react-popover';
import { CalendarDays, Clock, Timer, Bell, BellOff, ChevronLeft, ChevronRight, ArrowUp, ArrowDown, Trash2 } from 'lucide-react';
import { fmtTime, fmtDur, toISODate, dayLabel } from '../lib/parser.js';
import { isoToDate, shiftISO } from '../lib/edit.js';

function Chip({ icon: Icon, label, muted, open, onOpenChange, children, title }) {
  return (
    <Popover.Root open={open} onOpenChange={onOpenChange}>
      <Popover.Trigger asChild>
        <button type="button" className={`df-chip${muted ? ' is-muted' : ''}`} title={title}>
          {Icon && <Icon size={13} strokeWidth={2} />}
          {label && <span>{label}</span>}
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content className="df-pop" align="start" sideOffset={6} collisionPadding={12}>
          {children}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

function Opt({ on, className = '', ...props }) {
  return <button type="button" className={`df-opt${on ? ' is-on' : ''} ${className}`} {...props} />;
}

function Section({ label, children }) {
  return (
    <div style={{ marginTop: 10 }}>
      <div className="label" style={{ fontSize: 10, marginBottom: 6 }}>{label}</div>
      {children}
    </div>
  );
}

function shortDayLabel(iso) {
  return iso ? dayLabel(iso).main : 'No date';
}

/* ---------------- Date ---------------- */

export function MonthGrid({ value, onPick, marked }) {
  const base = value ? isoToDate(value) : new Date();
  const [view, setView] = useState(new Date(base.getFullYear(), base.getMonth(), 1));
  const todayISO = toISODate(new Date());
  const offset = (view.getDay() + 6) % 7; // Monday first
  const daysInMonth = new Date(view.getFullYear(), view.getMonth() + 1, 0).getDate();
  const weeks = Math.ceil((offset + daysInMonth) / 7);
  const cells = Array.from({ length: weeks * 7 }, (_, i) =>
    new Date(view.getFullYear(), view.getMonth(), 1 - offset + i));

  return (
    <div style={{ width: 252 }}>
      <div className="flex items-center justify-between" style={{ marginBottom: 6 }}>
        <button type="button" className="df-icon-btn" aria-label="Previous month"
          onClick={() => setView(new Date(view.getFullYear(), view.getMonth() - 1, 1))}>
          <ChevronLeft size={15} />
        </button>
        <span style={{ fontSize: 13, fontWeight: 600 }}>
          {view.toLocaleString('en', { month: 'long', year: 'numeric' })}
        </span>
        <button type="button" className="df-icon-btn" aria-label="Next month"
          onClick={() => setView(new Date(view.getFullYear(), view.getMonth() + 1, 1))}>
          <ChevronRight size={15} />
        </button>
      </div>
      <div className="grid grid-cols-7 font-mono" style={{ gap: 2, fontSize: 10, color: 'var(--ink-3)', textAlign: 'center', marginBottom: 2 }}>
        {['M', 'T', 'W', 'T', 'F', 'S', 'S'].map((d, i) => <div key={i} style={{ padding: '2px 0' }}>{d}</div>)}
      </div>
      <div className="grid grid-cols-7" style={{ gap: 2 }}>
        {cells.map((d) => {
          const iso = toISODate(d);
          const outside = d.getMonth() !== view.getMonth();
          return (
            <button
              key={iso}
              type="button"
              onClick={() => onPick(iso)}
              className={`df-day${iso === value ? ' is-on' : ''}${iso === todayISO ? ' is-today' : ''}`}
              style={{ opacity: outside ? 0.35 : 1 }}
            >
              {d.getDate()}
              {marked?.has(iso) && <span className="df-day-dot" />}
            </button>
          );
        })}
      </div>
    </div>
  );
}

export function DateChip({ value, onChange, marked }) {
  const [open, setOpen] = useState(false);
  const todayISO = toISODate(new Date());
  const pick = (iso) => { onChange(iso); setOpen(false); };
  return (
    <Chip icon={CalendarDays} label={shortDayLabel(value)} muted={!value} open={open} onOpenChange={setOpen} title="Date">
      <div className="flex gap-1.5" style={{ marginBottom: 10 }}>
        <Opt on={value === todayISO} onClick={() => pick(todayISO)}>Today</Opt>
        <Opt on={value === shiftISO(todayISO, 1)} onClick={() => pick(shiftISO(todayISO, 1))}>Tomorrow</Opt>
        {value && <Opt onClick={() => pick(shiftISO(value, 1))}>+1 day</Opt>}
      </div>
      <MonthGrid value={value} onPick={pick} marked={marked} />
    </Chip>
  );
}

/* ---------------- Start time ---------------- */

const MINUTES = [0, 15, 30, 45];

export function TimeChip({ value, onChange, autoLabel = 'after previous' }) {
  const [open, setOpen] = useState(false);
  const hasTime = value !== null && value !== undefined;
  const h = hasTime ? Math.floor(value / 60) : null;
  const m = hasTime ? value % 60 : null;
  const hourRef = useRef(null);

  // bring the selected (or 08:00) hour into view when opening
  useEffect(() => {
    if (!open) return;
    requestAnimationFrame(() => {
      const el = hourRef.current?.querySelector(`[data-h="${h ?? 8}"]`);
      el?.scrollIntoView({ block: 'nearest' });
    });
  }, [open, h]);

  return (
    <Chip icon={Clock} label={hasTime ? fmtTime(value) : autoLabel} muted={!hasTime} open={open} onOpenChange={setOpen} title="Start time">
      <div style={{ width: 252 }}>
        <Opt on={!hasTime} className="w-full justify-start" style={{ padding: '0 10px' }}
          onClick={() => { onChange(null); setOpen(false); }}>
          No fixed time · {autoLabel}
        </Opt>
        <Section label="Hour">
          <div ref={hourRef} className="grid grid-cols-6 df-scroll" style={{ gap: 3, maxHeight: 132, overflowY: 'auto' }}>
            {Array.from({ length: 24 }, (_, hh) => (
              <Opt key={hh} data-h={hh} on={h === hh} onClick={() => onChange(hh * 60 + (m ?? 0))}>
                {String(hh).padStart(2, '0')}
              </Opt>
            ))}
          </div>
        </Section>
        <Section label="Minute">
          <div className="grid grid-cols-4" style={{ gap: 3 }}>
            {MINUTES.map((mm) => (
              <Opt key={mm} on={m === mm} onClick={() => { onChange((h ?? 9) * 60 + mm); setOpen(false); }}>
                :{String(mm).padStart(2, '0')}
              </Opt>
            ))}
          </div>
        </Section>
        <Section label="Exact">
          <div className="flex gap-2 items-center">
            <input
              type="time"
              className="field font-mono"
              style={{ fontSize: 12.5, padding: '6px 10px' }}
              value={hasTime ? fmtTime(value) : ''}
              onChange={(e) => {
                const [hh, mm] = e.target.value.split(':').map(Number);
                if (!Number.isNaN(hh) && !Number.isNaN(mm)) onChange(hh * 60 + mm);
              }}
            />
            <Opt onClick={() => setOpen(false)} style={{ padding: '0 14px' }}>Done</Opt>
          </div>
        </Section>
      </div>
    </Chip>
  );
}

/* ---------------- Duration ---------------- */

const DURATIONS = [15, 30, 45, 60, 90, 120, 180, 240];

export function DurationChip({ value, onChange }) {
  const [open, setOpen] = useState(false);
  const v = value || 0;
  const pick = (d) => { onChange(d || null); setOpen(false); };
  const setCustom = (hh, mm) => onChange(Math.max(0, hh) * 60 + Math.max(0, Math.min(59, mm)) || null);
  return (
    <Chip icon={Timer} label={v ? fmtDur(v) : 'duration'} muted={!v} open={open} onOpenChange={setOpen} title="Duration">
      <div style={{ width: 252 }}>
        <div className="grid grid-cols-4" style={{ gap: 3 }}>
          {DURATIONS.map((d) => (
            <Opt key={d} on={v === d} onClick={() => pick(d)}>{fmtDur(d)}</Opt>
          ))}
        </div>
        <Section label="Custom">
          <div className="flex items-center gap-2 font-mono" style={{ fontSize: 12 }}>
            <input
              type="number" min="0" max="23" className="field font-mono" style={{ width: 64, padding: '6px 8px', fontSize: 12.5 }}
              value={Math.floor(v / 60)}
              onChange={(e) => setCustom(+e.target.value || 0, v % 60)}
            />
            <span style={{ color: 'var(--ink-3)' }}>h</span>
            <input
              type="number" min="0" max="59" step="5" className="field font-mono" style={{ width: 64, padding: '6px 8px', fontSize: 12.5 }}
              value={v % 60}
              onChange={(e) => setCustom(Math.floor(v / 60), +e.target.value || 0)}
            />
            <span style={{ color: 'var(--ink-3)' }}>m</span>
            <Opt onClick={() => setOpen(false)} style={{ padding: '0 12px', marginLeft: 'auto' }}>Done</Opt>
          </div>
        </Section>
        {v > 0 && (
          <Opt className="w-full" style={{ marginTop: 10 }} onClick={() => pick(null)}>No duration</Opt>
        )}
      </div>
    </Chip>
  );
}

/* ---------------- Reminder ---------------- */

// On time is the default and is stored as null (no "!0" in the text).
const REMINDERS = [null, 5, 10];
const remindLabel = (m) => (m ? `${fmtDur(m)} before` : 'on time');

export function ReminderChip({ value, onChange }) {
  const [open, setOpen] = useState(false);
  const v = value === undefined || value === 0 ? null : value;
  const pick = (r) => { onChange(r); setOpen(false); };
  const label = v === false ? 'off' : v === null ? '' : remindLabel(v);
  const custom = typeof v === 'number' && !REMINDERS.includes(v) ? v : '';
  return (
    <Chip icon={v === false ? BellOff : Bell} label={label} muted={v === null || v === false}
      open={open} onOpenChange={setOpen} title={`Telegram reminder${v === null ? ' (on time)' : ''} — only for timed items`}>
      <div style={{ width: 240 }}>
        <div className="label" style={{ fontSize: 10, marginBottom: 6 }}>Remind me</div>
        <div className="grid grid-cols-2" style={{ gap: 3 }}>
          {REMINDERS.map((r) => <Opt key={r ?? 0} on={v === r} onClick={() => pick(r)}>{remindLabel(r)}</Opt>)}
          <Opt on={v === false} onClick={() => pick(false)}>off</Opt>
        </div>
        <Section label="Custom (minutes before)">
          <div className="flex items-center gap-2 font-mono" style={{ fontSize: 12 }}>
            <input
              type="number" min="0" max="999" placeholder="e.g. 20" className="field font-mono" style={{ width: 80, padding: '6px 8px', fontSize: 12.5 }}
              value={custom}
              onChange={(e) => {
                const n = Math.floor(+e.target.value);
                if (e.target.value !== '' && Number.isFinite(n)) onChange(Math.min(999, n) > 0 ? Math.min(999, n) : null);
              }}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); setOpen(false); } }}
            />
            <span style={{ color: 'var(--ink-3)' }}>m</span>
            <Opt onClick={() => setOpen(false)} style={{ padding: '0 12px', marginLeft: 'auto' }}>Done</Opt>
          </div>
        </Section>
      </div>
    </Chip>
  );
}

/* ---------------- Field row ---------------- */

// value: { dateISO, startMin, durationMin, remindMin, title }
export function ItemFields({ value, onChange, marked, autoLabel }) {
  const set = (k) => (v) => onChange({ ...value, [k]: v });
  return (
    <div className="flex flex-wrap" style={{ gap: 5 }}>
      <DateChip value={value.dateISO} onChange={set('dateISO')} marked={marked} />
      <TimeChip value={value.startMin} onChange={set('startMin')} autoLabel={autoLabel} />
      <DurationChip value={value.durationMin} onChange={set('durationMin')} />
      <ReminderChip value={value.remindMin} onChange={set('remindMin')} />
    </div>
  );
}

/* ---------------- Editor for an existing item ---------------- */

// Changes apply immediately; the title commits on Enter / blur.
export function ItemEditor({ value, onChange, onDelete, onMove, onClose, marked, autoLabel, compact }) {
  const [title, setTitle] = useState(value.title);
  const [seen, setSeen] = useState(value.title);
  if (seen !== value.title) { setSeen(value.title); setTitle(value.title); } // item changed underneath

  const commitTitle = () => { if (title.trim() && title.trim() !== value.title) onChange({ ...value, title: title.trim() }); };

  return (
    <div className="df-editor-card" onClick={(e) => e.stopPropagation()}>
      <input
        className="df-title-input"
        value={title}
        autoFocus={!compact}
        placeholder="What is it?"
        onChange={(e) => setTitle(e.target.value)}
        onBlur={commitTitle}
        onKeyDown={(e) => {
          if (e.key === 'Enter') { commitTitle(); onClose(); }
          if (e.key === 'Escape') { setTitle(value.title); onClose(); }
        }}
      />
      <div style={{ marginTop: 8 }}>
        <ItemFields value={value} onChange={onChange} marked={marked} autoLabel={autoLabel} />
      </div>
      <div className="flex items-center justify-between" style={{ marginTop: 10 }}>
        <div className="flex gap-1">
          <button type="button" className="df-icon-btn" title="Move earlier in the day" onClick={() => onMove(-1)}><ArrowUp size={14} /></button>
          <button type="button" className="df-icon-btn" title="Move later in the day" onClick={() => onMove(1)}><ArrowDown size={14} /></button>
          <button type="button" className="df-icon-btn df-danger" title="Delete" onClick={onDelete}><Trash2 size={14} /></button>
        </div>
        <button type="button" className="btn btn-quiet" style={{ padding: '4px 14px', fontSize: 12 }}
          onClick={() => { commitTitle(); onClose(); }}>
          Done
        </button>
      </div>
    </div>
  );
}
