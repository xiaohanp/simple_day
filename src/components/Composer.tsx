// @ts-nocheck
import { forwardRef, useEffect, useRef, useState } from 'react';
import { Plus, CalendarArrowDown, X } from 'lucide-react';
import { parseItemLine } from '../lib/parser.js';
import { ItemFields } from './pickers.tsx';

// Quick-add block. `draft` lives in App so clicking an empty slot in the day
// plan can pre-fill the time. Typing "French 30m" or "14:00 Call 1h" in the
// title also works: anything recognised there overrides the chips.
const Composer = forwardRef(function Composer({ draft, setDraft, onAdd, onImport, marked, autoLabel, onClose }, inputRef) {
  const fileRef = useRef(null);
  const [note, setNote] = useState('');
  useEffect(() => {
    if (!note) return;
    const t = setTimeout(() => setNote(''), 3500);
    return () => clearTimeout(t);
  }, [note]);

  const importFile = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = ''; // allow picking the same file again
    if (!file) return;
    try { setNote(onImport(await file.text())); } catch { setNote('Could not read that file'); }
  };

  const submit = () => {
    const raw = draft.title.trim();
    if (!raw) { inputRef.current?.focus(); return; }
    const p = parseItemLine(raw);
    onAdd({
      ...draft,
      title: p.title === '(untitled)' ? raw : p.title,
      startMin: p.startMin ?? draft.startMin,
      durationMin: p.durationMin ?? draft.durationMin,
      remindMin: p.remindMin ?? draft.remindMin,
    });
  };

  return (
    <form className="df-composer" onSubmit={(e) => { e.preventDefault(); submit(); }}>
      <div className="flex items-center gap-2">
        <input
          ref={inputRef}
          className="df-title-input"
          autoComplete="off"
          placeholder="Add an activity…"
          value={draft.title}
          onChange={(e) => setDraft({ ...draft, title: e.target.value })}
        />
        <button type="button" className="df-icon-btn" aria-label="Import calendar (.ics)" title="Import calendar (.ics)"
          onClick={() => fileRef.current?.click()}>
          <CalendarArrowDown size={15} strokeWidth={2} />
        </button>
        <input ref={fileRef} type="file" accept=".ics,text/calendar" hidden onChange={importFile} />
        <button type="submit" className="df-add-btn" aria-label="Add" disabled={!draft.title.trim()}>
          <Plus size={16} strokeWidth={2.4} />
        </button>
        {onClose && (
          <button type="button" className="df-icon-btn" aria-label="Close" onClick={onClose}>
            <X size={17} strokeWidth={2} />
          </button>
        )}
      </div>
      <div style={{ marginTop: 8 }}>
        <ItemFields value={draft} onChange={setDraft} marked={marked} autoLabel={autoLabel} />
      </div>
      {note && <div className="font-mono" style={{ marginTop: 6, fontSize: 11, color: 'var(--ink-3)' }}>{note}</div>}
    </form>
  );
});

export default Composer;
