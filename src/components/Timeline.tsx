// @ts-nocheck
import { useEffect, useMemo, useRef } from 'react';
import { fmtTime, fmtDur, dayLabel, toISODate } from '../lib/parser.js';

function nowMinutes() {
  const d = new Date();
  return d.getHours() * 60 + d.getMinutes();
}

function Item({ it, isToday, nowMin }) {
  const timed = it.startMin !== null && it.startMin !== undefined;
  const active = isToday && timed && nowMin >= it.startMin && nowMin < (it.endMin ?? it.startMin);
  const past = isToday && timed && nowMin >= (it.endMin ?? it.startMin);

  return (
    <div
      className="grid items-baseline gap-x-4 py-[9px]"
      style={{
        gridTemplateColumns: '92px 1fr',
        opacity: past ? 0.38 : 1,
        transition: 'opacity .3s',
      }}
    >
      <div className="font-mono text-right leading-tight" style={{ fontSize: 12 }}>
        {timed ? (
          <>
            <div style={{ color: active ? 'var(--accent)' : 'var(--ink)', fontWeight: active ? 700 : 500 }}>
              {fmtTime(it.startMin)}
            </div>
            {it.endMin !== null && it.endMin !== it.startMin && (
              <div style={{ color: 'var(--ink-3)' }}>{fmtTime(it.endMin)}</div>
            )}
          </>
        ) : (
          <div style={{ color: 'var(--ink-3)' }}>anytime</div>
        )}
      </div>

      <div className="min-w-0">
        <div className="flex items-baseline gap-2 flex-wrap">
          {active && (
            <span
              className="df-now-dot inline-block rounded-full"
              style={{ width: 7, height: 7, background: 'var(--accent)', transform: 'translateY(-1px)' }}
            />
          )}
          <span
            className="truncate"
            style={{ fontSize: 14, fontWeight: active ? 600 : 450, color: 'var(--ink)' }}
            title={it.title}
          >
            {it.title}
          </span>
          {it.durationMin ? (
            <span className="font-mono" style={{ fontSize: 11, color: 'var(--ink-3)' }}>
              {fmtDur(it.durationMin)}
            </span>
          ) : null}
          {it.floating && timed && (
            <span className="font-mono" style={{ fontSize: 11, color: 'var(--ink-3)' }} title="Floating: follows the previous item">
              ⤷
            </span>
          )}
          {it.remindMin && timed && (
            <span
              className="font-mono"
              style={{ fontSize: 10, color: 'var(--ink-3)', border: '1px solid var(--line)', borderRadius: 999, padding: '1px 7px' }}
            >
              !{it.remindMin}m
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

export default function Timeline({ parsed, inbox }) {
  const todayISO = toISODate(new Date());
  const nowMin = nowMinutes();
  const todayRef = useRef(null);

  const sortedDays = useMemo(() => {
    const withDate = parsed.days.filter(d => d.dateISO).sort((a, b) => a.dateISO.localeCompare(b.dateISO));
    const noDate = parsed.days.filter(d => !d.dateISO);
    return [...withDate, ...noDate];
  }, [parsed]);

  useEffect(() => {
    todayRef.current?.scrollIntoView({ block: 'start', behavior: 'auto' });
  }, []);

  return (
    <div className="h-full overflow-y-auto df-scroll" style={{ background: 'var(--paper)' }}>
      <div className="mx-auto w-full" style={{ maxWidth: 620, padding: '28px 22px 120px' }}>
        {inbox.length > 0 && (
          <section className="df-in mb-8">
            <div className="label" style={{ marginBottom: 10 }}>Inbox — no date</div>
            <div className="hairline-t">
              {inbox.map((it, i) => (
                <div key={i} className="hairline-b"><Item it={it} isToday={false} nowMin={nowMin} /></div>
              ))}
            </div>
          </section>
        )}

        {sortedDays.map((day, di) => {
          const isToday = day.dateISO === todayISO;
          const isPast = day.dateISO && day.dateISO < todayISO;
          const lbl = day.dateISO ? dayLabel(day.dateISO) : { main: day.label || 'Undated', sub: '' };
          return (
            <section
              key={day.dateISO || `n-${di}`}
              ref={isToday ? todayRef : null}
              className="df-in"
              style={{ marginBottom: 34, opacity: isPast ? 0.45 : 1, animationDelay: `${Math.min(di, 8) * 40}ms`, scrollMarginTop: 12 }}
            >
              <div className="flex items-baseline justify-between flex-wrap gap-x-3" style={{ marginBottom: 8 }}>
                <div className="flex items-baseline gap-3">
                  <h2
                    style={{
                      fontSize: 17,
                      fontWeight: 650,
                      letterSpacing: '-0.015em',
                      color: isToday ? 'var(--accent)' : 'var(--ink)',
                    }}
                  >
                    {lbl.main}
                  </h2>
                  {lbl.sub && <span className="font-mono" style={{ fontSize: 11, color: 'var(--ink-3)' }}>{lbl.sub}</span>}
                  {day.label && (
                    <span style={{ fontSize: 12, color: 'var(--ink-3)' }}>
                      {day.label.replace(/^[-—–]\s*/, '')}
                    </span>
                  )}
                </div>
                {day.startMin !== null && day.startMin !== undefined && (
                  <span className="font-mono" style={{ fontSize: 11, color: 'var(--ink-3)' }}>
                    {fmtTime(day.startMin)}–{fmtTime(day.endMin)} · {fmtDur(day.endMin - day.startMin)}
                  </span>
                )}
              </div>

              {day.items.length ? (
                <div className="hairline-t">
                  {day.items.map((it, i) => (
                    <div key={i} className="hairline-b">
                      <Item it={it} isToday={!!isToday} nowMin={nowMin} />
                    </div>
                  ))}
                </div>
              ) : (
                <div className="hairline-t hairline-b font-mono" style={{ fontSize: 12, color: 'var(--ink-3)', padding: '10px 0' }}>
                  (empty day)
                </div>
              )}
            </section>
          );
        })}

        {!sortedDays.length && !inbox.length && (
          <div className="font-mono" style={{ fontSize: 13, color: 'var(--ink-3)', paddingTop: 40 }}>
            Nothing yet. Add a day in the editor, e.g.{'\n'}## tomorrow{'\n'}09:00 Thesis 4h !15
          </div>
        )}
      </div>
    </div>
  );
}
