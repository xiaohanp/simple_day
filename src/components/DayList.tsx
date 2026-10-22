// @ts-nocheck
// Left pane: one compact block per day listing what's planned, without hours.
import { useEffect, useRef } from 'react';
import { fmtDur, dayLabel, toISODate } from '../lib/parser.js';

function total(items) {
  return items.reduce((s, it) => s + (it.durationMin || 0), 0);
}

function Row({ it, open, onClick }) {
  return (
    <button type="button" className={`df-row${open ? ' is-open' : ''}`} onClick={onClick}>
      <span className="df-row-dot" style={{ background: it.floating ? 'transparent' : 'var(--ink)', borderColor: 'var(--ink-3)' }} />
      <span className="flex-1 min-w-0 text-left df-wrap">
        {it.title}
        {it.location && <span className="block" style={{ fontSize: 11.5, color: 'var(--ink-3)' }}>@ {it.location}</span>}
      </span>
      {it.durationMin ? <span className="font-mono shrink-0" style={{ fontSize: 11, color: 'var(--ink-3)' }}>{fmtDur(it.durationMin)}</span> : null}
    </button>
  );
}

export default function DayList({ days, inbox, selectedISO, onSelectDay, editing, onEdit, renderEditor }) {
  const todayISO = toISODate(new Date());
  const selRef = useRef(null);
  const scroller = useRef(null);

  // keep the selected day visible
  useEffect(() => {
    const el = selRef.current, box = scroller.current;
    if (!el || !box) return;
    const top = el.offsetTop;
    if (top < box.scrollTop || top > box.scrollTop + box.clientHeight - 80) {
      box.scrollTo({ top: Math.max(0, top - 12), behavior: 'smooth' });
    }
  }, [selectedISO]);

  const isOpen = (it) => editing?.where === 'list' && editing.line === it.line;
  const items = (list, day) => list.map((it) => (
    <div key={it.line}>
      <Row it={it} open={isOpen(it)} onClick={() => onEdit(isOpen(it) ? null : it, day)} />
      {isOpen(it) && <div style={{ padding: '4px 0 8px' }}>{renderEditor(it, day)}</div>}
    </div>
  ));

  return (
    <div ref={scroller} className="relative h-full overflow-y-auto df-scroll" style={{ padding: '6px 12px 120px' }}>
      {inbox.length > 0 && (
        <section className="df-daycard">
          <div className="df-dayhead"><span style={{ fontSize: 13, fontWeight: 650 }}>Inbox</span>
            <span className="font-mono" style={{ fontSize: 11, color: 'var(--ink-3)' }}>no date</span></div>
          {items(inbox, null)}
        </section>
      )}

      {days.map((day, di) => {
        const sel = day.dateISO && day.dateISO === selectedISO;
        const isToday = day.dateISO === todayISO;
        const isPast = day.dateISO && day.dateISO < todayISO;
        const lbl = day.dateISO ? dayLabel(day.dateISO) : { main: day.label || 'Undated', sub: '' };
        const t = total(day.items);
        return (
          <section
            key={day.dateISO || `n-${di}`}
            ref={sel ? selRef : null}
            className={`df-daycard${sel ? ' is-sel' : ''}`}
            style={{ opacity: isPast && !sel ? 0.5 : 1 }}
          >
            <button type="button" className="df-dayhead" onClick={() => day.dateISO && onSelectDay(day.dateISO)}>
              <span className="flex items-baseline gap-2 min-w-0">
                <span style={{ fontSize: 13, fontWeight: 650, color: isToday ? 'var(--accent)' : 'var(--ink)' }}>{lbl.main}</span>
                {lbl.main === 'Today' || lbl.main === 'Tomorrow'
                  ? <span className="font-mono" style={{ fontSize: 10.5, color: 'var(--ink-3)' }}>{lbl.sub}</span> : null}
                {day.label && (
                  <span className="truncate" style={{ fontSize: 11.5, color: 'var(--ink-3)' }}>{day.label.replace(/^[-—–]\s*/, '')}</span>
                )}
              </span>
              {t > 0 && <span className="font-mono shrink-0" style={{ fontSize: 11, color: 'var(--ink-3)' }}>{fmtDur(t)}</span>}
            </button>
            {day.items.length
              ? items(day.items, day)
              : <div className="font-mono" style={{ fontSize: 11, color: 'var(--ink-3)', padding: '2px 8px 4px' }}>nothing planned</div>}
          </section>
        );
      })}

      {!days.length && !inbox.length && (
        <div style={{ fontSize: 13, color: 'var(--ink-3)', padding: '24px 8px' }}>
          No plans yet — add your first activity above.
        </div>
      )}
    </div>
  );
}
