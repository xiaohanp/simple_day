// @ts-nocheck
// Fallback: the underlying plain text, for bulk edits and day notes.
export default function TextPanel({ text, onChange, onClose }) {
  return (
    <div className="fixed inset-0 z-50 flex justify-end" style={{ background: 'rgba(10,10,10,0.28)' }} onClick={onClose}>
      <div
        className="h-full flex flex-col"
        style={{ width: 'min(520px, 100%)', background: 'var(--paper)', borderLeft: '1px solid var(--line)' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between hairline-b shrink-0" style={{ padding: '14px 20px' }}>
          <div>
            <div style={{ fontSize: 15, fontWeight: 650 }}>Plain text</div>
            <div className="font-mono" style={{ fontSize: 10.5, color: 'var(--ink-3)' }}>## Wed Oct 7 · 09:00 Task 1h !15 · French 30m</div>
          </div>
          <button onClick={onClose} className="btn btn-quiet" style={{ padding: '5px 14px' }}>Done</button>
        </div>
        <textarea
          className="df-editor df-scroll flex-1 w-full resize-none"
          style={{ padding: '12px 20px 40vh', border: 'none' }}
          value={text}
          onChange={(e) => onChange(e.target.value)}
          spellCheck={false}
        />
      </div>
    </div>
  );
}
