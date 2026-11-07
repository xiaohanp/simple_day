// Persistence: localStorage for offline-first use + debounced sync to the
// user's Cloudflare Worker (which is what makes Telegram notifications and
// cross-device sync work). The plan is encrypted on this device before it is
// synced (see crypto.js); localStorage keeps a plain copy, as it never leaves.

import { deriveKeys, seal, unseal } from './crypto.js';

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

// Worker v2+ stores the plan encrypted; v1 (an older pasted copy) only knows plaintext.
const versions = new Map();
async function workerVersion(url) {
  if (!versions.has(url)) {
    const p = fetch(`${url}/health`).then((r) => r.json()).then((b) => b.v || 1);
    p.catch(() => versions.delete(url));
    versions.set(url, p);
  }
  return versions.get(url);
}

// One authenticated request. On an encrypting worker the secret key itself never
// travels: we send the derived auth token. The only exception is a one-time upgrade
// of a store written by an older version, which still holds the plain key anyway.
async function call(settings, path, init = {}) {
  const url = baseUrl(settings.workerUrl);
  const v = await workerVersion(url);
  const send = (headers) => fetch(`${url}${path}`, { ...init, headers: { ...init.headers, ...headers } });
  if (v < 2) return { res: await send({ 'X-Key': settings.key }), encrypted: false };
  const { auth, key } = await deriveKeys(settings.key);
  let res = await send({ 'X-Key': auth });
  if (res.status === 403) {
    const body = await res.clone().json().catch(() => ({}));
    if (body.legacy) res = await send({ 'X-Key': auth, 'X-Legacy-Key': settings.key });
  }
  return { res, encrypted: true, key };
}

const configured = (settings) => baseUrl(settings.workerUrl) && settings.key;

// Push the plan. Returns { ok, encrypted }.
export async function pushState(settings, text, notifications, archive = {}) {
  if (!configured(settings)) return { ok: false, reason: 'not-configured' };
  const shared = {
    // readable by the worker on purpose: it needs these to send your reminders
    settings: {
      botToken: settings.botToken,
      chatId: settings.chatId,
      tz: settings.tz,
      digestOn: settings.digestOn,
      digestTime: settings.digestTime,
    },
    notifications,
    updatedAt: Date.now(),
  };
  const url = baseUrl(settings.workerUrl);
  const v = await workerVersion(url);
  let body;
  if (v < 2) body = { text, archive, ...shared };
  else body = { enc: await seal((await deriveKeys(settings.key)).key, { text, archive }), ...shared };
  const { res, encrypted } = await call(settings, '/state', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`sync failed: ${res.status}`);
  return { ok: true, encrypted };
}

// Pull the plan, decrypted. Returns { text, archive, settings, updatedAt } or null.
export async function pullState(settings) {
  if (!configured(settings)) return null;
  const { res, key } = await call(settings, '/state');
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`pull failed: ${res.status}`);
  const state = await res.json();
  if (!state.enc) return state; // not upgraded yet: plaintext from an older version
  const { text, archive } = await unseal(key, state.enc);
  return { ...state, text, archive };
}

export async function sendTest(settings) {
  if (!configured(settings)) throw new Error('Set the worker URL first.');
  const { res } = await call(settings, '/test', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
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
