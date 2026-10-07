// @ts-nocheck
import { useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { parseSchedule, buildNotifications, toISODate, fmtTime, parseItemLine } from './lib/parser.js';
import { addItem, updateItem, deleteItem, moveItem, itemValue, serializeItem } from './lib/edit.js';
import { parseIcs } from './lib/ics.js';
import { loadLocal, saveLocal, pushState, pullState, sendTest, randomKey } from './lib/store.js';
import { DEFAULT_TEXT } from './lib/defaultText.js';
import { Plus } from 'lucide-react';
import Settings from './components/Settings.tsx';
import Composer from './components/Composer.tsx';
import DayList from './components/DayList.tsx';
import DayPlan from './components/DayPlan.tsx';
import TextPanel from './components/TextPanel.tsx';
import { ItemEditor } from './components/pickers.tsx';
import { useIsMobile } from './hooks/use-mobile.ts';

const defaultSettings = () => ({
  workerUrl: '',
  key: randomKey(),
  botToken: '',
  chatId: '',
  tz: Intl.DateTimeFormat().resolvedOptions().timeZone || 'Europe/Stockholm',
  digestOn: true,
  digestTime: '08:00',
});

// Reminders are always on time unless an item overrides them; drop the old default setting.
function migrateSettings(s) {
  const out = { ...s };
  delete out.offsetMin;
  delete out.remindV;
  return out;
}

function initialState() {
  const local = loadLocal();
  if (local && local.text !== undefined) {
    return { text: local.text, settings: { ...defaultSettings(), ...migrateSettings(local.settings || {}) }, updatedAt: local.updatedAt || 0 };
  }
  return { text: DEFAULT_TEXT, settings: defaultSettings(), updatedAt: Date.now() };
}

export default function App() {
  const [init] = useState(initialState);
  const [text, setText] = useState(init.text);
  const [settings, setSettings] = useState(init.settings);
  const [updatedAt, setUpdatedAt] = useState(init.updatedAt);
  const [showSettings, setShowSettings] = useState(false);
  const [showText, setShowText] = useState(false);
  const [mobileView, setMobileView] = useState('days'); // 'days' | 'day'
  const [composerOpen, setComposerOpen] = useState(false); // mobile bottom sheet
  const [selectedISO, setSelectedISO] = useState(() => toISODate(new Date()));
  const [editing, setEditing] = useState(null); // { line, where: 'list' | 'plan' }
  const [draft, setDraft] = useState({ title: '', startMin: null, durationMin: 30, remindMin: null });
  const [syncStatus, setSyncStatus] = useState('local only');
  const [, forceTick] = useReducer((x) => x + 1, 0);
  const composerRef = useRef(null);
  const syncTimer = useRef(null);
  const isMobile = useIsMobile();

  const parsed = useMemo(() => parseSchedule(text), [text]);
  const sortedDays = useMemo(() => {
    const withDate = parsed.days.filter((d) => d.dateISO).sort((a, b) => a.dateISO.localeCompare(b.dateISO));
    return [...withDate, ...parsed.days.filter((d) => !d.dateISO)];
  }, [parsed]);
  const marked = useMemo(() => new Set(parsed.days.filter((d) => d.dateISO && d.items.length).map((d) => d.dateISO)), [parsed]);
  const selectedDay = parsed.days.find((d) => d.dateISO === selectedISO);
  const notifications = useMemo(
    () => buildNotifications(parsed, settings),
    [parsed, settings.tz, settings.digestOn, settings.digestTime]
  );

  // tick every 30s so the "now" highlight follows the clock
  useEffect(() => {
    const t = setInterval(forceTick, 30000);
    return () => clearInterval(t);
  }, []);

  // persist locally + debounced push to worker
  useEffect(() => {
    const ts = Date.now();
    setUpdatedAt(ts);
    saveLocal({ text, settings, updatedAt: ts });
    if (!settings.workerUrl) {
      setSyncStatus('local only');
      return;
    }
    setSyncStatus('syncing…');
    clearTimeout(syncTimer.current);
    syncTimer.current = setTimeout(async () => {
      try {
        await pushState(settings, text, notifications);
        setSyncStatus('synced');
      } catch {
        setSyncStatus('error');
      }
    }, 1500);
    return () => clearTimeout(syncTimer.current);
  }, [text, settings, notifications]);

  // on load: pull remote state if newer (cross-device)
  useEffect(() => {
    (async () => {
      if (!settings.workerUrl) return;
      try {
        const remote = await pullState(settings);
        if (remote && remote.updatedAt > updatedAt) {
          setText(remote.text);
          setSettings((s) => ({ ...s, ...migrateSettings(remote.settings || {}) }));
        }
      } catch { /* offline — stay local */ }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---- structured editing (all views share these, so both panes update together)
  const selectDay = (iso, { reveal = true } = {}) => {
    setSelectedISO(iso);
    if (reveal && isMobile) setMobileView('day');
  };

  const onAdd = (value) => {
    const r = addItem(text, value);
    setText(r.text);
    setSelectedISO(value.dateISO);
    setDraft((d) => ({ ...d, title: '', startMin: null }));
    setComposerOpen(false);
  };

  // Add the events of an .ics file; events already in the plan (same day, time, title) are skipped.
  const onImport = (icsText) => {
    const { items, found } = parseIcs(icsText, settings.tz);
    const itemKey = (iso, startMin, title) => `${iso}|${startMin}|${title}`;
    const seen = new Set(parsed.days.flatMap((d) => d.items.map((i) => itemKey(d.dateISO, i.floating ? null : i.startMin, i.title))));
    let next = text, added = 0;
    for (const it of items) {
      const k = itemKey(it.dateISO, it.startMin, parseItemLine(serializeItem(it)).title);
      if (seen.has(k)) continue;
      seen.add(k);
      next = addItem(next, it).text;
      added++;
    }
    if (added) {
      setText(next);
      setSelectedISO(items[0].dateISO);
      setComposerOpen(false);
    }
    if (!found) return 'No events found in that file';
    if (!added) return items.length ? 'Already imported' : 'No upcoming events in that file';
    return `Imported ${added} event${added === 1 ? '' : 's'}`;
  };

  const onUpdate = (line, value, prevISO) => {
    const r = updateItem(text, line, value, prevISO);
    setText(r.text);
    setEditing((e) => (e && e.line === line ? { ...e, line: r.line } : e));
    if (value.dateISO && value.dateISO !== prevISO) setSelectedISO(value.dateISO);
  };

  const onDelete = (line) => {
    setText(deleteItem(text, line).text);
    setEditing(null);
  };

  const onMove = (line, dir) => {
    const r = moveItem(text, line, dir);
    setText(r.text);
    setEditing((e) => (e ? { ...e, line: r.line } : e));
  };

  const onEdit = (where) => (it, day) => {
    setEditing(it ? { line: it.line, where } : null);
    if (it && day?.dateISO) setSelectedISO(day.dateISO);
  };

  // dragging a block in the day plan: give it a fixed start; floating items after it reflow
  const onReschedule = (it, startMin, day) => {
    const dateISO = day?.dateISO ?? null;
    onUpdate(it.line, { ...itemValue(it, dateISO), startMin }, dateISO);
  };

  // clicking an empty slot in the day plan pre-fills the composer's time
  const onSlot = (min) => {
    setDraft((d) => ({ ...d, startMin: min }));
    if (isMobile) setComposerOpen(true);
    else requestAnimationFrame(() => composerRef.current?.focus());
  };

  const renderEditor = (it, day) => {
    const dateISO = day?.dateISO ?? null;
    return (
      <ItemEditor
        key={it.line}
        value={itemValue(it, dateISO)}
        onChange={(v) => onUpdate(it.line, v, dateISO)}
        onDelete={() => onDelete(it.line)}
        onMove={(dir) => onMove(it.line, dir)}
        onClose={() => setEditing(null)}
        marked={marked}
        autoLabel={it.startMin !== null ? `flows · ${fmtTime(it.startMin)}` : 'anytime'}
        compact={isMobile}
      />
    );
  };

  const dayEnd = selectedDay?.endMin;
  const composerProps = {
    draft: { ...draft, dateISO: selectedISO },
    setDraft: ({ dateISO, ...rest }) => { setDraft(rest); if (dateISO && dateISO !== selectedISO) setSelectedISO(dateISO); },
    onAdd,
    onImport,
    marked,
    autoLabel: dayEnd !== null && dayEnd !== undefined ? `after ${fmtTime(dayEnd)}` : 'anytime',
  };

  useEffect(() => {
    if (composerOpen) requestAnimationFrame(() => composerRef.current?.focus());
  }, [composerOpen]);

  const syncDot = {
    'synced': 'var(--ok)',
    'syncing…': 'var(--ink-3)',
    'error': 'var(--accent)',
    'local only': 'var(--line)',
  }[syncStatus] || 'var(--line)';

  return (
    <div className="h-dvh flex flex-col" style={{ background: 'var(--paper)' }}>
      {/* Header */}
      <header className="hairline-b flex items-center justify-between shrink-0" style={{ padding: '0 16px', height: 52 }}>
        <div className="flex items-center gap-3">
          <span className="font-mono" style={{ fontSize: 15, fontWeight: 700, letterSpacing: '-0.02em' }}>
            dayflow<span style={{ color: 'var(--accent)' }}>.</span>
          </span>
          <span className="hidden sm:inline font-mono" style={{ fontSize: 11, color: 'var(--ink-3)' }}>
            day planner
          </span>
        </div>

        <div className="flex items-center gap-2">
          <span className="hidden sm:flex items-center gap-2 font-mono" style={{ fontSize: 11, color: 'var(--ink-3)' }}>
            <span className="inline-block rounded-full" style={{ width: 7, height: 7, background: syncDot }} />
            {syncStatus}
          </span>
          <button className="btn btn-quiet" style={{ padding: '6px 14px' }} onClick={() => setShowText(true)} title="Edit the underlying plain text">
            Text
          </button>
          <button className="btn btn-quiet" style={{ padding: '6px 14px' }} onClick={() => setShowSettings(true)}>
            Settings
          </button>
        </div>
      </header>

      {/* Mobile view switch */}
      <div className="md:hidden hairline-b flex shrink-0" style={{ padding: '8px 16px', gap: 8 }}>
        {[['days', 'Days'], ['day', 'Day plan']].map(([v, label]) => (
          <button
            key={v}
            onClick={() => setMobileView(v)}
            className="btn"
            style={{
              padding: '5px 16px',
              background: mobileView === v ? 'var(--ink)' : 'transparent',
              color: mobileView === v ? 'var(--paper)' : 'var(--ink)',
              borderColor: mobileView === v ? 'var(--ink)' : 'var(--line)',
            }}
          >
            {label}
          </button>
        ))}
      </div>

      {/* Main split: days overview | hour-by-hour plan */}
      <main className="flex-1 min-h-0 grid md:grid-cols-[310px_1fr] lg:grid-cols-[360px_1fr]">
        <section
          className={`min-h-0 flex-col md:border-r ${mobileView === 'days' ? 'flex' : 'hidden'} md:flex`}
          style={{ borderColor: 'var(--line)' }}
        >
          <div className="hidden md:block shrink-0" style={{ padding: '12px 12px 8px' }}>
            <Composer ref={composerRef} {...composerProps} />
          </div>
          <div className="flex-1 min-h-0">
            <DayList
              days={sortedDays}
              inbox={parsed.inbox}
              selectedISO={selectedISO}
              onSelectDay={selectDay}
              editing={editing}
              onEdit={onEdit('list')}
              renderEditor={renderEditor}
            />
          </div>
        </section>

        <section className={`min-h-0 ${mobileView === 'day' ? 'block' : 'hidden'} md:block`}>
          <DayPlan
            day={selectedDay}
            visible={!isMobile || mobileView === 'day'}
            selectedISO={selectedISO}
            onSelectDay={(iso) => selectDay(iso, { reveal: false })}
            editing={editing}
            onEdit={onEdit('plan')}
            renderEditor={renderEditor}
            onSlot={onSlot}
            onReschedule={onReschedule}
            marked={marked}
          />
        </section>
      </main>

      {/* Mobile: floating add button + bottom sheet composer */}
      <button className="md:hidden df-fab" aria-label="Add activity" onClick={() => setComposerOpen(true)}>
        <Plus size={22} strokeWidth={2.4} />
      </button>
      {composerOpen && (
        <div className="md:hidden fixed inset-0 z-40 flex flex-col justify-end" style={{ background: 'rgba(10,10,10,0.28)' }}
          onClick={() => setComposerOpen(false)}>
          <div className="df-sheet" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between" style={{ marginBottom: 10 }}>
              <span className="label" style={{ margin: 0 }}>New activity</span>
              <button className="btn btn-quiet" style={{ padding: '3px 12px', fontSize: 12 }} onClick={() => setComposerOpen(false)}>Close</button>
            </div>
            <Composer ref={composerRef} {...composerProps} />
          </div>
        </div>
      )}

      {showText && <TextPanel text={text} onChange={setText} onClose={() => setShowText(false)} />}

      {showSettings && (
        <Settings
          settings={settings}
          onChange={setSettings}
          onTest={() => sendTest(settings)}
          onClose={() => setShowSettings(false)}
          syncStatus={syncStatus}
        />
      )}
    </div>
  );
}
