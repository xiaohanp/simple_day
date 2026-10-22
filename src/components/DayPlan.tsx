// @ts-nocheck
// Right pane: the selected day laid out hour by hour.
import { useEffect, useMemo, useRef, useState } from 'react';
import * as Popover from '@radix-ui/react-popover';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { fmtTime, fmtDur, dayLabel, toISODate } from '../lib/parser.js';
import { shiftISO } from '../lib/edit.js';
import { DateChip } from './pickers.tsx';

const PPM = 0.9; // pixels per minute
const MIN_H = 24; // smallest block height in px
const SNAP = 15; // drag snaps to this many minutes
const HOLD_MS = 280; // touch: long-press before a block lifts (so swipes still scroll)
const EDGE = 44; // px from the scroller edge where dragging auto-scrolls

function nowMinutes() {
  const d = new Date();
  return d.getHours() * 60 + d.getMinutes();
}

// Assign side-by-side lanes to overlapping blocks.
function layout(items) {
  const minVis = MIN_H / PPM;
  const timed = items
    .filter((i) => i.startMin !== null)
    .map((it) => ({ it, s: it.startMin, e: Math.max(it.endMin ?? it.startMin, it.startMin + minVis) }))
    .sort((a, b) => a.s - b.s || b.e - a.e);
  let cluster = [], laneEnds = [], clusterEnd = -1;
  const flush = () => { cluster.forEach((c) => { c.lanes = laneEnds.length; }); cluster = []; laneEnds = []; };
  for (const t of timed) {
    if (t.s >= clusterEnd) { flush(); clusterEnd = -1; }
    let lane = laneEnds.findIndex((e) => e <= t.s);
    if (lane < 0) { lane = laneEnds.length; laneEnds.push(t.e); } else laneEnds[lane] = t.e;
    t.lane = lane;
    cluster.push(t);
    clusterEnd = Math.max(clusterEnd, t.e);
  }
  flush();
  return timed;
}

function EditPopover({ open, onOpenChange, children, editor, side = 'bottom' }) {
  return (
    <Popover.Root open={open} onOpenChange={onOpenChange}>
      <Popover.Trigger asChild>{children}</Popover.Trigger>
      <Popover.Portal>
        <Popover.Content className="df-pop" side={side} align="start" sideOffset={8} collisionPadding={12}
          style={{ width: 340 }} onOpenAutoFocus={(e) => e.preventDefault()} onClick={(e) => e.stopPropagation()}>
          {editor}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

export default function DayPlan({ day, visible = true, selectedISO, onSelectDay, editing, onEdit, renderEditor, onSlot, onReschedule, marked }) {
  const scroller = useRef(null);
  const [drag, setDrag] = useState(null); // { line, min } while a block is dragged; { create, s, e } while a new one is drawn
  const gesture = useRef(null);
  const suppressClick = useRef(false);
  const todayISO = toISODate(new Date());
  const isToday = selectedISO === todayISO;
  const nowMin = nowMinutes();
  const items = useMemo(() => day?.items || [], [day]);
  const blocks = useMemo(() => layout(items), [items]);
  const anytime = items.filter((i) => i.startMin === null);

  const startH = Math.min(7, ...blocks.map((b) => Math.floor(b.s / 60)));
  const endH = Math.min(30, Math.max(22, isToday ? Math.ceil(nowMin / 60) + 1 : 0, ...blocks.map((b) => Math.ceil(b.e / 60))));
  const height = (endH - startH) * 60 * PPM;
  const y = (min) => (min - startH * 60) * PPM;

  useEffect(() => {
    const box = scroller.current;
    if (!box || !visible) return;
    const focus = isToday ? nowMin : (blocks[0]?.s ?? 8 * 60);
    box.scrollTo({ top: Math.max(0, y(focus - 60)) });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedISO, visible]);

  const isOpen = (it) => editing?.where === 'plan' && editing.line === it.line;
  const openChange = (it) => (o) => onEdit(o ? it : null, day);

  // ---- drag a block to a new start time, or drag across empty slots to draw a new one
  // (mouse, pen and touch via pointer events)
  const latest = useRef({});
  latest.current = { day, editing, onEdit, onReschedule, onSlot };

  const dragMin = (g) => {
    const box = scroller.current;
    const dy = g.y - g.y0 + (box.scrollTop - g.scroll0);
    const min = Math.round((g.it.startMin + dy / PPM) / SNAP) * SNAP;
    return Math.max(0, Math.min(min, 24 * 60 - SNAP));
  };

  // the range being drawn: from the slot the press started in to the slot under the pointer
  const createRange = (g) => {
    const cur = g.startMin0 + (g.y - g.grid.getBoundingClientRect().top) / PPM;
    const s = cur >= g.anchor ? g.anchor : Math.floor(cur / SNAP) * SNAP;
    const e = cur >= g.anchor ? Math.max(g.anchor + SNAP, Math.ceil(cur / SNAP) * SNAP) : g.anchor + SNAP;
    return { create: true, s: Math.max(0, s), e: Math.min(24 * 60, e) };
  };

  const dragState = (g) => (g.it ? { line: g.it.line, min: dragMin(g) } : createRange(g));

  const endGesture = (commit) => {
    const g = gesture.current;
    if (!g) return;
    gesture.current = null;
    clearTimeout(g.timer);
    cancelAnimationFrame(g.raf);
    window.removeEventListener('pointermove', onPointerMove);
    window.removeEventListener('pointerup', onPointerUp);
    window.removeEventListener('pointercancel', onPointerCancel);
    window.removeEventListener('touchmove', onTouchMove);
    if (!g.active) return;
    setDrag(null);
    suppressClick.current = true;
    setTimeout(() => { suppressClick.current = false; }, g.type === 'mouse' ? 0 : 400);
    if (!commit) return;
    if (!g.it) {
      const r = createRange(g);
      latest.current.onSlot?.(r.s, r.e - r.s);
      return;
    }
    const min = dragMin(g);
    if (min !== g.it.startMin) latest.current.onReschedule?.(g.it, min, latest.current.day);
  };

  const activate = () => {
    const g = gesture.current;
    if (!g || g.active) return;
    g.active = true;
    const { editing: ed, onEdit: edit, day: d } = latest.current;
    if (ed?.where === 'plan') edit(null, d);
    if (g.type !== 'mouse') navigator.vibrate?.(8);
    setDrag(dragState(g));
    // auto-scroll while the pointer rests near the top/bottom edge
    const tick = () => {
      const box = scroller.current;
      if (!gesture.current || !box) return;
      const r = box.getBoundingClientRect();
      const v = g.y < r.top + EDGE ? -(r.top + EDGE - g.y) : g.y > r.bottom - EDGE ? g.y - (r.bottom - EDGE) : 0;
      if (v) {
        box.scrollTop += Math.max(-14, Math.min(14, v / 3));
        setDrag(dragState(g));
      }
      g.raf = requestAnimationFrame(tick);
    };
    g.raf = requestAnimationFrame(tick);
  };

  function onPointerMove(e) {
    const g = gesture.current;
    if (!g || e.pointerId !== g.pointerId) return;
    g.y = e.clientY;
    const moved = Math.hypot(e.clientX - g.x0, e.clientY - g.y0);
    if (!g.active) {
      if (g.type === 'mouse') { if (moved > 4) activate(); }
      else if (moved > 8) endGesture(false); // finger moved before the hold: it's a scroll
      return;
    }
    setDrag(dragState(g));
  }
  function onPointerUp(e) { if (gesture.current?.pointerId === e.pointerId) endGesture(true); }
  function onPointerCancel(e) { if (gesture.current?.pointerId === e.pointerId) endGesture(false); }
  // once a block is lifted on touch, stop the page/grid from scrolling under the finger
  function onTouchMove(e) { if (gesture.current?.active && e.cancelable) e.preventDefault(); }

  const startGesture = (e, extra) => {
    const g = {
      pointerId: e.pointerId, type: e.pointerType, active: false,
      x0: e.clientX, y0: e.clientY, y: e.clientY, scroll0: scroller.current.scrollTop, ...extra,
    };
    gesture.current = g;
    if (g.type !== 'mouse') g.timer = setTimeout(activate, HOLD_MS);
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
    window.addEventListener('pointercancel', onPointerCancel);
    window.addEventListener('touchmove', onTouchMove, { passive: false });
  };

  const onBlockPointerDown = (it) => (e) => {
    if (!onReschedule || gesture.current) return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    startGesture(e, { it });
  };

  // press on an empty slot: drag (mouse) or hold then drag (touch) to draw a new block
  const onGridPointerDown = (e) => {
    if (!onSlot || gesture.current || e.target !== e.currentTarget) return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    const startMin0 = startH * 60;
    const min = startMin0 + (e.clientY - e.currentTarget.getBoundingClientRect().top) / PPM;
    startGesture(e, { grid: e.currentTarget, startMin0, anchor: Math.max(0, Math.min(Math.floor(min / SNAP) * SNAP, 24 * 60 - SNAP)) });
  };

  useEffect(() => () => endGesture(false), []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { endGesture(false); }, [selectedISO]); // eslint-disable-line react-hooks/exhaustive-deps

  const lbl = dayLabel(selectedISO);
  const spent = items.reduce((s, it) => s + (it.durationMin || 0), 0);

  const onGridClick = (e) => {
    if (!e.currentTarget.contains(e.target)) return; // clicks bubbling out of portaled popovers
    if (suppressClick.current) return; // a new block was just drawn
    const r = e.currentTarget.getBoundingClientRect();
    const min = startH * 60 + Math.floor((e.clientY - r.top) / PPM / 15) * 15;
    onSlot(Math.max(0, Math.min(min, 23 * 60 + 45)));
  };

  return (
    <div className="h-full flex flex-col min-h-0">
      {/* header */}
      <div className="hairline-b shrink-0 flex items-center flex-wrap gap-x-3 gap-y-2" style={{ padding: '10px 16px' }}>
        <div className="flex items-center gap-1">
          <button type="button" className="df-icon-btn" aria-label="Previous day" onClick={() => onSelectDay(shiftISO(selectedISO, -1))}><ChevronLeft size={16} /></button>
          <button type="button" className="df-icon-btn" aria-label="Next day" onClick={() => onSelectDay(shiftISO(selectedISO, 1))}><ChevronRight size={16} /></button>
        </div>
        <div className="flex items-baseline gap-2 min-w-0">
          <h2 style={{ fontSize: 17, fontWeight: 650, letterSpacing: '-0.015em', color: isToday ? 'var(--accent)' : 'var(--ink)' }}>{lbl.main}</h2>
          <span className="font-mono" style={{ fontSize: 11, color: 'var(--ink-3)' }}>{lbl.sub}</span>
          {day?.label && <span className="truncate" style={{ fontSize: 12, color: 'var(--ink-3)' }}>{day.label.replace(/^[-—–]\s*/, '')}</span>}
        </div>
        <div className="flex items-center gap-2 ml-auto">
          {spent > 0 && <span className="font-mono hidden sm:inline" style={{ fontSize: 11, color: 'var(--ink-3)' }}>{fmtDur(spent)} planned</span>}
          {!isToday && <button type="button" className="df-chip" onClick={() => onSelectDay(todayISO)}>Today</button>}
          <DateChip value={selectedISO} onChange={onSelectDay} marked={marked} />
        </div>
      </div>

      {/* anytime tray */}
      {anytime.length > 0 && (
        <div className="hairline-b shrink-0 flex items-center flex-wrap gap-1.5" style={{ padding: '8px 16px' }}>
          <span className="label" style={{ margin: '0 4px 0 0', fontSize: 10 }}>Anytime</span>
          {anytime.map((it) => (
            <EditPopover key={it.line} open={isOpen(it)} onOpenChange={openChange(it)} editor={renderEditor(it, day)}>
              <button type="button" className="df-chip" style={{ fontFamily: 'inherit' }}>
                {it.title}{it.durationMin ? <span className="font-mono" style={{ color: 'var(--ink-3)' }}>{fmtDur(it.durationMin)}</span> : null}
              </button>
            </EditPopover>
          ))}
        </div>
      )}

      {/* hour grid */}
      <div ref={scroller} className="flex-1 min-h-0 overflow-y-auto df-scroll">
        {!items.length && (
          <div className="font-mono text-center" style={{ fontSize: 12, color: 'var(--ink-3)', padding: '14px 16px 0' }}>
            Nothing planned — click or drag across a time slot, or use “Add”.
          </div>
        )}
        <div className="relative" style={{ height: height + 24, margin: '12px 16px 0 0' }}>
          {Array.from({ length: endH - startH + 1 }, (_, i) => (
            <div key={i} className="absolute left-0 right-0 flex items-start" style={{ top: i * 60 * PPM }}>
              <span className="font-mono text-right shrink-0" style={{ width: 52, paddingRight: 8, fontSize: 10.5, color: 'var(--ink-3)', transform: 'translateY(-6px)' }}>
                {fmtTime((startH + i) * 60)}
              </span>
              <span className="flex-1" style={{ borderTop: '1px solid var(--line)' }} />
            </div>
          ))}

          <div className="absolute df-grid" style={{ left: 52, right: 0, top: 0, height, cursor: 'cell' }}
            onClick={onGridClick} onPointerDown={onGridPointerDown}
            onContextMenu={(ev) => { if (gesture.current) ev.preventDefault(); }}
            title="Click an empty slot to add something at that time, or drag to set its length">
            {drag?.create && (
              <div className="df-block is-dragging is-ghost" style={{ top: y(drag.s) + 1, height: Math.max(MIN_H, (drag.e - drag.s) * PPM) - 2, left: 4, right: 2 }}>
                <span className="font-mono truncate" style={{ fontSize: 10.5, color: 'var(--ink-3)' }}>
                  {fmtTime(drag.s)}–{fmtTime(drag.e)} · {fmtDur(drag.e - drag.s)}
                </span>
              </div>
            )}
            {blocks.map(({ it, s, e, lane, lanes }) => {
              const active = isToday && nowMin >= it.startMin && nowMin < (it.endMin ?? it.startMin);
              const past = isToday && nowMin >= (it.endMin ?? it.startMin) && !active;
              const h = Math.max(MIN_H, (e - s) * PPM) - 2;
              const dragging = drag?.line === it.line;
              const shownStart = dragging ? drag.min : it.startMin;
              const shownEnd = dragging ? drag.min + ((it.endMin ?? it.startMin) - it.startMin) : it.endMin;
              return (
                <EditPopover key={it.line} open={isOpen(it)} onOpenChange={openChange(it)} editor={renderEditor(it, day)}>
                  <button
                    type="button"
                    className={`df-block${h < 34 ? ' is-short' : ''}${active ? ' is-active' : ''}${it.floating ? ' is-floating' : ''}${isOpen(it) ? ' is-open' : ''}${dragging ? ' is-dragging' : ''}`}
                    style={{
                      top: y(s) + 1, height: h,
                      left: `calc(${(lane / lanes) * 100}% + 4px)`,
                      width: `calc(${100 / lanes}% - 6px)`,
                      opacity: past && !dragging ? 0.45 : 1,
                      transform: dragging ? `translateY(${(drag.min - it.startMin) * PPM}px)` : undefined,
                    }}
                    onPointerDown={onBlockPointerDown(it)}
                    onContextMenu={(ev) => { if (gesture.current) ev.preventDefault(); }}
                    onClick={(ev) => {
                      ev.stopPropagation();
                      if (suppressClick.current) ev.preventDefault(); // a drag just ended: don't open the editor
                    }}
                  >
                    <Popover.Anchor asChild>
                      <span className="truncate" style={{ fontWeight: active ? 650 : 550 }}>{it.title}</span>
                    </Popover.Anchor>
                    {h >= 34 ? (
                      <span className="font-mono truncate" style={{ fontSize: 10.5, color: 'var(--ink-3)' }}>
                        {fmtTime(shownStart)}{shownEnd !== shownStart ? `–${fmtTime(shownEnd)}` : ''}
                        {it.durationMin ? ` · ${fmtDur(it.durationMin)}` : ''}
                        {it.floating && !dragging ? ' · flows' : ''}
                        {it.location ? ` · @ ${it.location}` : ''}
                      </span>
                    ) : (
                      <span className="font-mono shrink-0" style={{ fontSize: 10.5, color: 'var(--ink-3)' }}>{fmtTime(shownStart)}</span>
                    )}
                  </button>
                </EditPopover>
              );
            })}

            {isToday && nowMin >= startH * 60 && nowMin <= endH * 60 && (
              <div className="absolute pointer-events-none" style={{ left: -6, right: 0, top: y(nowMin), height: 0, borderTop: '1.5px solid var(--accent)' }}>
                <span className="df-now-dot absolute rounded-full" style={{ left: -3, top: -4.5, width: 8, height: 8, background: 'var(--accent)' }} />
              </div>
            )}
          </div>
        </div>

      </div>
    </div>
  );
}
