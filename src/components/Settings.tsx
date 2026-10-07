// @ts-nocheck
import { useState } from 'react';
import { detectChatId } from '../lib/store.js';

function Row({ label, children, hint }) {
  return (
    <div style={{ marginBottom: 18 }}>
      <span className="label">{label}</span>
      {children}
      {hint && <div style={{ fontSize: 12, color: 'var(--ink-3)', marginTop: 5, lineHeight: 1.5 }}>{hint}</div>}
    </div>
  );
}

function Guide({ title, children, open, onToggle }) {
  return (
    <div className="hairline-b">
      <button
        onClick={onToggle}
        className="w-full flex items-center justify-between cursor-pointer"
        style={{ padding: '13px 0', background: 'none', border: 'none', textAlign: 'left' }}
      >
        <span style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--ink)' }}>{title}</span>
        <span className="font-mono" style={{ color: 'var(--ink-3)', fontSize: 14 }}>{open ? '−' : '+'}</span>
      </button>
      {open && (
        <div style={{ fontSize: 13, color: 'var(--ink-2)', lineHeight: 1.65, paddingBottom: 16 }}>
          {children}
        </div>
      )}
    </div>
  );
}

export default function Settings({ settings, onChange, onTest, onClose, syncStatus }) {
  const [busy, setBusy] = useState('');
  const [msg, setMsg] = useState('');
  const [openGuide, setOpenGuide] = useState('');

  const set = (k, v) => onChange({ ...settings, [k]: v });

  const flash = (m) => { setMsg(m); setTimeout(() => setMsg(''), 5000); };

  const doDetect = async () => {
    setBusy('detect');
    try {
      const id = await detectChatId(settings.botToken);
      set('chatId', id);
      flash(`Chat ID detected: ${id}`);
    } catch (e) {
      flash(e.message);
    } finally {
      setBusy('');
    }
  };

  const doTest = async () => {
    setBusy('test');
    try {
      await onTest();
      flash('Test message sent — check Telegram.');
    } catch (e) {
      flash(e.message);
    } finally {
      setBusy('');
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex justify-end"
      style={{ background: 'rgba(10,10,10,0.28)' }}
      onClick={onClose}
    >
      <div
        className="h-full overflow-y-auto df-scroll"
        style={{ width: 'min(460px, 100%)', background: 'var(--paper)', borderLeft: '1px solid var(--line)' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between hairline-b" style={{ padding: '18px 24px' }}>
          <span style={{ fontSize: 15, fontWeight: 650, letterSpacing: '-0.01em' }}>Settings</span>
          <button onClick={onClose} className="btn-quiet btn" style={{ padding: '5px 14px' }}>Done</button>
        </div>

        <div style={{ padding: '22px 24px 80px' }}>
          {msg && (
            <div className="font-mono" style={{ fontSize: 12, background: 'var(--paper-2)', borderRadius: 10, padding: '10px 12px', marginBottom: 18, color: 'var(--ink-2)' }}>
              {msg}
            </div>
          )}

          <div className="label" style={{ fontSize: 12, marginBottom: 14, color: 'var(--ink)' }}>Telegram</div>

          <Row label="Bot token" hint="From @BotFather → /newbot. Keep it private.">
            <input
              className="field font-mono"
              style={{ fontSize: 12.5 }}
              type="password"
              placeholder="123456789:AAE…"
              value={settings.botToken}
              onChange={(e) => set('botToken', e.target.value.trim())}
            />
          </Row>

          <Row label="Chat ID" hint="Send any message to your bot first, then use Detect.">
            <div className="flex gap-2">
              <input
                className="field font-mono"
                style={{ fontSize: 12.5 }}
                placeholder="e.g. 528171234"
                value={settings.chatId}
                onChange={(e) => set('chatId', e.target.value.trim())}
              />
              <button className="btn btn-quiet" style={{ whiteSpace: 'nowrap' }} disabled={!settings.botToken || busy === 'detect'} onClick={doDetect}>
                {busy === 'detect' ? '…' : 'Detect'}
              </button>
            </div>
          </Row>

          <div style={{ marginBottom: 28 }}>
            <button className="btn btn-solid" disabled={!settings.botToken || !settings.chatId || !settings.workerUrl || busy === 'test'} onClick={doTest}>
              {busy === 'test' ? 'Sending…' : 'Send test notification'}
            </button>
          </div>

          <div className="label" style={{ fontSize: 12, marginBottom: 14, color: 'var(--ink)' }}>Notification server</div>

          <Row label="Worker URL" hint="Your Cloudflare Worker address, e.g. https://dayflow.you.workers.dev — see setup guide below.">
            <input
              className="field font-mono"
              style={{ fontSize: 12.5 }}
              placeholder="https://…workers.dev"
              value={settings.workerUrl}
              onChange={(e) => set('workerUrl', e.target.value.trim())}
            />
          </Row>

          <Row label="Secret key" hint="Protects your schedule. Auto-generated; use the same key on every device.">
            <input
              className="field font-mono"
              style={{ fontSize: 12.5 }}
              value={settings.key}
              onChange={(e) => set('key', e.target.value.trim())}
            />
          </Row>

          <div style={{ marginBottom: 28 }} className="font-mono text-[12px]" >
            <span style={{ color: 'var(--ink-3)' }}>sync: </span>
            <span style={{ color: syncStatus === 'synced' ? 'var(--ok)' : syncStatus === 'error' ? 'var(--accent)' : 'var(--ink-3)' }}>
              {syncStatus}
            </span>
          </div>

          <div className="label" style={{ fontSize: 12, marginBottom: 14, color: 'var(--ink)' }}>Preferences</div>

          <Row label="Timezone">
            <input className="field font-mono" style={{ fontSize: 12.5 }} value={settings.tz} onChange={(e) => set('tz', e.target.value.trim())} />
          </Row>


          <Row label="Morning digest">
            <div className="flex items-center gap-3">
              <button
                className="btn"
                style={settings.digestOn ? { background: 'var(--ink)', color: 'var(--paper)' } : {}}
                onClick={() => set('digestOn', !settings.digestOn)}
              >
                {settings.digestOn ? 'On' : 'Off'}
              </button>
              <input
                className="field font-mono"
                style={{ fontSize: 12.5, width: 110 }}
                type="time"
                value={settings.digestTime}
                onChange={(e) => set('digestTime', e.target.value)}
              />
            </div>
          </Row>

          <div className="hairline-t" style={{ marginTop: 30, paddingTop: 8 }}>
            <div className="label" style={{ fontSize: 12, margin: '14px 0 6px', color: 'var(--ink)' }}>Setup guide</div>

            <Guide title="1 · Create your Telegram bot (2 min)" open={openGuide === 'a'} onToggle={() => setOpenGuide(openGuide === 'a' ? '' : 'a')}>
              <ol style={{ paddingLeft: 18, listStyle: 'decimal' }}>
                <li>In Telegram, open <b>@BotFather</b> and send <span className="font-mono">/newbot</span>.</li>
                <li>Pick a name and username — BotFather replies with your <b>bot token</b>. Paste it above.</li>
                <li>Open your new bot's chat and send it any message (e.g. "hi").</li>
                <li>Come back here and press <b>Detect</b> next to Chat ID.</li>
              </ol>
            </Guide>

            <Guide title="2 · Deploy the notification server (free, ~10 min)" open={openGuide === 'b'} onToggle={() => setOpenGuide(openGuide === 'b' ? '' : 'b')}>
              <ol style={{ paddingLeft: 18, listStyle: 'decimal' }}>
                <li>Create a free <b>Cloudflare</b> account (no card needed).</li>
                <li>Install Node.js, then in a terminal: <span className="font-mono">npm i -g wrangler</span> and <span className="font-mono">wrangler login</span>.</li>
                <li>In the project's <span className="font-mono">worker/</span> folder: <span className="font-mono">wrangler kv namespace create DAYFLOW</span> and paste the returned id into <span className="font-mono">wrangler.toml</span>.</li>
                <li>Run <span className="font-mono">wrangler deploy</span>. It prints your Worker URL — paste it above.</li>
              </ol>
              <div style={{ marginTop: 8 }}>Full instructions are in the project's <span className="font-mono">worker/README.md</span>. Free tier covers this app many times over; the cron runs every minute.</div>
            </Guide>

            <Guide title="3 · Make Telegram reliable on your Xiaomi (5 min)" open={openGuide === 'c'} onToggle={() => setOpenGuide(openGuide === 'c' ? '' : 'c')}>
              <ol style={{ paddingLeft: 18, listStyle: 'decimal' }}>
                <li>Settings → Apps → Manage apps → <b>Telegram</b> → Battery saver → <b>No restrictions</b>.</li>
                <li>Same screen → enable <b>Autostart</b>.</li>
                <li>Open recents, pull Telegram down / tap the lock icon to <b>lock it</b>.</li>
                <li>Settings → Notifications → Telegram → allow everything, including lock screen.</li>
              </ol>
              <div style={{ marginTop: 8 }}>Do this once and Telegram pushes arrive even with the screen off.</div>
            </Guide>
          </div>
        </div>
      </div>
    </div>
  );
}
