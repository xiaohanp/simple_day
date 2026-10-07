// Persistence: localStorage for offline-first use + debounced sync to the
// user's Cloudflare Worker (which is what makes Telegram notifications and
// cross-device sync work).

const LS_KEY = 'simpleday.v1';
const OLD_LS_KEY = 'dayflow.v1'; // before the rename; read once so existing plans carry over

export function randomKey() {
  const chars = 'abcdefghjkmnpqrstuvwxyz23456789';
  let s = '';
  const buf = new Uint8Array(24);
  crypto.getRandomValues(buf);
  for (const b of buf) s += chars[b % chars.length];
  return s;
}

export function loadLocal() {
  try {
    const raw = localStorage.getItem(LS_KEY) ?? localStorage.getItem(OLD_LS_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function saveLocal(state) {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(state));
  } catch { /* storage full/blocked — non-fatal */ }
}

function baseUrl(url) {
  return (url || '').trim().replace(/\/+$/, '');
}

export async function pushState(settings, text, notifications) {
  const url = baseUrl(settings.workerUrl);
  if (!url || !settings.key) return { ok: false, reason: 'not-configured' };
  const res = await fetch(`${url}/state`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', 'X-Key': settings.key },
    body: JSON.stringify({
      text,
      settings: {
        botToken: settings.botToken,
        chatId: settings.chatId,
        tz: settings.tz,
        digestOn: settings.digestOn,
        digestTime: settings.digestTime,
      },
      notifications,
      updatedAt: Date.now(),
    }),
  });
  if (!res.ok) throw new Error(`sync failed: ${res.status}`);
  return { ok: true };
}

export async function pullState(settings) {
  const url = baseUrl(settings.workerUrl);
  if (!url || !settings.key) return null;
  const res = await fetch(`${url}/state`, { headers: { 'X-Key': settings.key } });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`pull failed: ${res.status}`);
  return res.json();
}

export async function sendTest(settings) {
  const url = baseUrl(settings.workerUrl);
  if (!url || !settings.key) throw new Error('Set the worker URL first.');
  const res = await fetch(`${url}/test`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Key': settings.key },
    body: JSON.stringify({ botToken: settings.botToken, chatId: settings.chatId }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || `test failed: ${res.status}`);
  return body;
}

// Detect the user's Telegram chat id straight from the Bot API (CORS-enabled).
// The user must have sent any message to their bot first.
export async function detectChatId(botToken) {
  const res = await fetch(`https://api.telegram.org/bot${botToken}/getUpdates`);
  const body = await res.json();
  if (!body.ok) throw new Error(body.description || 'Telegram rejected the token');
  const msgs = (body.result || [])
    .map(u => u.message || u.channel_post)
    .filter(Boolean);
  if (!msgs.length) {
    throw new Error('No messages found. Send any message to your bot in Telegram first, then try again.');
  }
  const last = msgs[msgs.length - 1];
  return String(last.chat.id);
}
