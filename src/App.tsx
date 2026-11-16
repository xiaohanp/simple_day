// @ts-nocheck
import { useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { parseSchedule, buildNotifications, toISODate, fmtTime, parseItemLine } from './lib/parser.js';
import { addItem, updateItem, deleteItem, moveItem, itemValue, serializeItem } from './lib/edit.js';
import { parseIcs } from './lib/ics.js';
import { loadLocal, saveLocal, pushState, pullState, sendTest, randomKey } from './lib/store.js';
import { DEFAULT_TEXT } from './lib/defaultText.js';
import { archivePastWeeks, mergeArchives, weekStartISO } from './lib/archive.js';
import { merge3 } from './lib/merge.js';

// What a push carries, minus derived notifications: used to skip no-op pushes.
const SYNCED_SETTINGS = ['botToken', 'chatId', 'tz', 'digestOn', 'digestTime'];
const settingsSig = (s = {}) => JSON.stringify(SYNCED_SETTINGS.map((k) => s[k] ?? null));
const syncSig = (text, archive = {}, settings = {}) =>
  JSON.stringify([text, Object.keys(archive).sort().map((k) => [k, archive[k]]), settingsSig(settings)]);
import { Plus } from 'lucide-react';
import Settings from './components/Settings.tsx';
import Composer from './components/Composer.tsx';
import DayList from './components/DayList.tsx';
import DayPlan from './components/DayPlan.tsx';
import TextPanel from './components/TextPanel.tsx';
import { ItemEditor } from './components/pickers.tsx';
import { useIsMobile } from './hooks/use-mobile.ts';
import { backdropProps } from './lib/utils.ts';

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
    return { text: local.text, archive: local.archive || {}, settings: { ...defaultSettings(), ...migrateSettings(local.settings || {}) }, updatedAt: local.updatedAt || 0,
      baseText: local.baseText ?? null, baseUpdatedAt: local.baseUpdatedAt ?? null, baseSig: local.baseSig ?? null, baseSettingsSig: local.baseSettingsSig ?? null };
  }
  return { text: DEFAULT_TEXT, archive: {}, settings: defaultSettings(), updatedAt: 0, baseText: null, baseUpdatedAt: null, baseSig: null, baseSettingsSig: null };
}

export default function App() {
  const [init] = useState(initialState);
  const [text, setText] = useState(init.text);
  const [archive, setArchive] = useState(init.archive); // { weekMondayISO: plain text }
  const [pulled, setPulled] = useState(0); // bumps after a remote pull, to re-run archiving
  const [settings, setSettings] = useState(init.settings);
  const [showSettings, setShowSettings] = useState(false);
  const [showText, setShowText] = useState(false);
  const [mobileView, setMobileView] = useState('days'); // 'days' | 'day'
  const [composerOpen, setComposerOpen] = useState(false); // mobile bottom sheet
  const [selectedISO, setSelectedISO] = useState(() => toISODate(new Date()));
  const [editing, setEditing] = useState(null); // { line, where: 'list' | 'plan' }
  const [draft, setDraft] = useState({ title: '', startMin: null, durationMin: 30, remindMin: null, location: '' });
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

  // ---- sync with the worker
  // `base` is the last version this device saw on the server (text + its updatedAt).
  // Every push says which version it was based on; the worker refuses (409) if the
  // server has moved on, and we then pull, merge our edits on top, and push again.
  // So a tab left open overnight, or a device that was off, can't wipe edits made
  // elsewhere — it merges instead of overwriting.
  const latest = useRef(null);
  latest.current = { text, archive, settings, notifications };
  const base = useRef({ text: init.baseText, updatedAt: init.baseUpdatedAt, sig: init.baseSig, settingsSig: init.baseSettingsSig });
  const readyRef = useRef(false);
  const inflight = useRef(false);
  const lastPull = useRef(0);
  const [ready, setReady] = useState(false);
  const [syncNonce, setSyncNonce] = useState(0);

  const persist = () => {
    const c = latest.current;
    const b = base.current;
    saveLocal({ text: c.text, archive: c.archive, settings: c.settings, updatedAt: Date.now(),
      baseText: b.text, baseUpdatedAt: b.updatedAt, baseSig: b.sig, baseSettingsSig: b.settingsSig });
  };

  // Pull the server copy and fold this device's unsynced edits into it.
  const pullMerge = async () => {
    const remote = await pullState(latest.current.settings);
    lastPull.current = Date.now();
    if (!remote) return null;
    const cur = latest.current; // read after the await: includes anything typed meanwhile
    const b = base.current;
    let merged;
    if (b.text == null) {
      // first run after the update: no known base, so keep both sides (union)
      merged = merge3('', cur.text, remote.text);
    } else {
      merged = merge3(b.text, cur.text, remote.text);
    }
    const remoteSettings = migrateSettings(remote.settings || {});
    const mergedArchive = mergeArchives(cur.archive, remote.archive || {});
    const settingsUnchangedHere = b.settingsSig == null || settingsSig(cur.settings) === b.settingsSig;
    base.current = {
      text: remote.text,
      updatedAt: remote.updatedAt ?? null,
      sig: syncSig(remote.text, remote.archive || {}, remoteSettings),
      settingsSig: settingsSig(remoteSettings),
    };
    if (merged !== cur.text) setText(merged);
    setArchive(mergedArchive);
    if (settingsUnchangedHere) setSettings((s) => ({ ...s, ...remoteSettings }));
    setPulled((n) => n + 1);
    persist();
    return remote;
  };

  // Push now (no debounce). On conflict: merge, then the effect below pushes again.
  const pushNow = async (opts = {}) => {
    const snap = latest.current;
    if (!snap.settings.workerUrl || !readyRef.current || inflight.current) return;
    if (syncSig(snap.text, snap.archive, snap.settings) === base.current.sig) {
      setSyncStatus('synced');
      return;
    }
    inflight.current = true;
    try {
      const r = await pushState(snap.settings, snap.text, snap.notifications, snap.archive, base.current.updatedAt ?? null, opts);
      if (r.ok) {
        base.current = { text: snap.text, updatedAt: r.updatedAt, sig: syncSig(snap.text, snap.archive, snap.settings), settingsSig: settingsSig(snap.settings) };
        persist();
        const c = latest.current;
        const more = syncSig(c.text, c.archive, c.settings) !== base.current.sig;
        setSyncStatus(more ? 'syncing…' : r.encrypted ? 'synced' : 'synced · not encrypted');
        if (more) setSyncNonce((n) => n + 1);
      } else if (r.conflict) {
        setSyncStatus('merging…');
        await pullMerge();
        setSyncNonce((n) => n + 1); // push the merged result
      }
    } catch {
      setSyncStatus('error');
    } finally {
      inflight.current = false;
    }
  };

  // persist locally on every change + debounced push
  useEffect(() => {
    persist();
    if (!settings.workerUrl) {
      setSyncStatus('local only');
      return;
    }
    if (!ready) return; // never push before the first pull has had its chance
    setSyncStatus('syncing…');
    clearTimeout(syncTimer.current);
    syncTimer.current = setTimeout(() => pushNow(), 1500);
    return () => clearTimeout(syncTimer.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text, archive, settings, notifications, ready, syncNonce]);

  // on load: pull + merge before anything is pushed
  useEffect(() => {
    (async () => {
      if (settings.workerUrl) {
        try { await pullMerge(); } catch { /* offline — stay local; a later push merges */ }
      }
      readyRef.current = true;
      setReady(true);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Stay current: pull when the tab comes back, the network returns, the laptop
  // wakes (a long gap between ticks), or every 2 minutes; save right away when hidden.
  useEffect(() => {
    let lastTick = Date.now();
    const refresh = () => {
      if (!readyRef.current || inflight.current || !latest.current.settings.workerUrl) return;
      pullMerge().catch(() => {});
    };
    const onVis = () => {
      if (document.visibilityState === 'hidden') {
        clearTimeout(syncTimer.current);
        pushNow({ keepalive: true });
      } else refresh();
    };
    const iv = setInterval(() => {
      const now = Date.now();
      const woke = now - lastTick > 60000;
      lastTick = now;
      if (document.visibilityState === 'visible' && (woke || now - lastPull.current > 120000)) refresh();
    }, 15000);
    document.addEventListener('visibilitychange', onVis);
    window.addEventListener('online', refresh);
    window.addEventListener('focus', refresh);
    return () => {
      clearInterval(iv);
      document.removeEventListener('visibilitychange', onVis);
      window.removeEventListener('online', refresh);
      window.removeEventListener('focus', refresh);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Weekly archive: once a Mon–Sun week is over, its days move out of the plan.
  // Runs on load, when a new week starts, and after a pull — never while the
  // text panel is open, so a half-typed past date isn't whisked away mid-edit.
  const weekKey = weekStartISO(new Date());
  useEffect(() => {
    if (showText) return;
    const r = archivePastWeeks(text, archive);
    if (!r) return;
    setText(r.text);
    setArchive(r.archive);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [weekKey, showText, pulled]);

  // ---- structured editing (all views share these, so both panes update together)
  const selectDay = (iso, { reveal = true } = {}) => {
    setSelectedISO(iso);
    if (reveal && isMobile) setMobileView('day');
  };

  const onAdd = (value) => {
    const r = addItem(text, value);
    setText(r.text);
    setSelectedISO(value.dateISO);
    setDraft((d) => ({ ...d, title: '', startMin: null, location: '' }));
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

  // clicking an empty slot in the day plan pre-fills the composer's time; dragging also sets the length
  const onSlot = (min, durationMin) => {
    setDraft((d) => ({ ...d, startMin: min, ...(durationMin ? { durationMin } : {}) }));
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
    'synced · not encrypted': 'var(--accent)',
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
            simpleday<span style={{ color: 'var(--accent)' }}>.</span>
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
      <main className="flex-1 min-h-0 grid grid-cols-1 md:grid-cols-[310px_minmax(0,1fr)] lg:grid-cols-[360px_minmax(0,1fr)]">
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
          {...backdropProps(() => setComposerOpen(false))}>
          <div className="df-sheet" onClick={(e) => e.stopPropagation()}>
            <Composer ref={composerRef} {...composerProps} onClose={() => setComposerOpen(false)} />
          </div>
        </div>
      )}

      {showText && <TextPanel text={text} archive={archive} onChange={setText} onClose={() => setShowText(false)} />}

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
