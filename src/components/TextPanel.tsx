// @ts-nocheck
import { useState } from 'react';
import { backdropProps } from '../lib/utils.ts';
import { weekLabel } from '../lib/archive.js';

// Fallback: the underlying plain text, for bulk edits and day notes.
// The Archive tab shows finished weeks, read-only, one Mon–Sun week at a time.
export default function TextPanel({ text, archive = {}, onChange, onClose }) {
  const [tab, setTab] = useState('plan');
  const weeks = Object.keys(archive).sort().reverse();
  const [week, setWeek] = useState(weeks[0] || '');

  const tabBtn = (v, label) => (
    <button
      key={v}
      onClick={() => setTab(v)}
      className="btn"
      style={{
        padding: '4px 14px',
        background: tab === v ? 'var(--ink)' : 'transparent',
        color: tab === v ? 'var(--paper)' : 'var(--ink)',
        borderColor: tab === v ? 'var(--ink)' : 'var(--line)',
      }}
    >
      {label}
    </button>
  );

  return (
    <div className="fixed inset-0 z-50 flex justify-end" style={{ background: 'rgba(10,10,10,0.28)' }} {...backdropProps(onClose)}>
      <div
        className="h-full flex flex-col"
        style={{ width: 'min(520px, 100%)', background: 'var(--paper)', borderLeft: '1px solid var(--line)' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between hairline-b shrink-0" style={{ padding: '14px 20px' }}>
          <div>
            <div style={{ fontSize: 15, fontWeight: 650 }}>Plain text</div>
            <div className="font-mono" style={{ fontSize: 10.5, color: 'var(--ink-3)' }}>
              {tab === 'plan' ? '## Wed Oct 7 · 09:00 Task 1h !15 · French 30m' : 'finished weeks move here every Monday'}
            </div>
          </div>
          <button onClick={onClose} className="btn btn-quiet" style={{ padding: '5px 14px' }}>Done</button>
        </div>

        <div className="hairline-b flex items-center shrink-0" style={{ padding: '8px 20px', gap: 8 }}>
          {tabBtn('plan', 'Plan')}
          {tabBtn('archive', `Archive${weeks.length ? ` · ${weeks.length}` : ''}`)}
          {tab === 'archive' && weeks.length > 0 && (
            <select
              className="font-mono ml-auto min-w-0"
              style={{ fontSize: 12, padding: '4px 6px', border: '1px solid var(--line)', borderRadius: 6, background: 'var(--paper)', color: 'var(--ink)' }}
              value={week}
              onChange={(e) => setWeek(e.target.value)}
            >
              {weeks.map((w) => <option key={w} value={w}>{weekLabel(w)}</option>)}
            </select>
          )}
        </div>

        {tab === 'plan' ? (
          <textarea
            className="df-editor df-scroll flex-1 w-full resize-none"
            style={{ padding: '12px 20px 40vh', border: 'none' }}
            value={text}
            onChange={(e) => onChange(e.target.value)}
            spellCheck={false}
          />
        ) : weeks.length ? (
          <textarea
            className="df-editor df-scroll flex-1 w-full resize-none"
            style={{ padding: '12px 20px 40vh', border: 'none', color: 'var(--ink-2, var(--ink))' }}
            value={archive[week] || ''}
            readOnly
            spellCheck={false}
          />
        ) : (
          <div style={{ fontSize: 13, color: 'var(--ink-3)', padding: '24px 20px' }}>
            Nothing archived yet. When a week (Mon–Sun) is over, its days move here.
          </div>
        )}
      </div>
    </div>
  );
}
