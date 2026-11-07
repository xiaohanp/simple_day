// SimpleDay notification worker — Cloudflare Workers (free tier).
// Runs a cron every minute and sends due schedule items to Telegram.
// The frontend stores the already-computed notification list here,
// so this worker stays deliberately dumb: no parsing, no timezone math.
//
// Privacy (v2): your plan arrives already encrypted (`enc`, AES-GCM, key derived
// on your device from your secret key). This worker never sees the secret key
// itself: clients authenticate with a separate token derived from it, and only
// that token's SHA-256 hash is stored. What stays readable here is only what
// the worker needs to do its job: bot token, chat id, and upcoming reminder texts.

const VERSION = 2;

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, PUT, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, X-Key, X-Legacy-Key',
};

const json = (obj, status = 200) =>
  new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS },
  });

async function sendTelegram(botToken, chatId, text) {
  const res = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text }),
  });
  const body = await res.json().catch(() => ({}));
  if (!body.ok) throw new Error(body.description || `Telegram error ${res.status}`);
  return body;
}

async function loadState(env) {
  return (await env.SIMPLEDAY.get('state', 'json')) || null;
}

async function sha256hex(s) {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

// Encrypted state: X-Key is the auth token, checked against its stored hash.
// Older (v1) state stored the plain secret key; old clients send it as X-Key, and
// new clients send it once as X-Legacy-Key to prove ownership while upgrading.
async function authorize(req, state) {
  if (!state) return { ok: false };
  const key = req.headers.get('X-Key') || '';
  if (state.authHash) return { ok: !!key && (await sha256hex(key)) === state.authHash };
  const legacy = req.headers.get('X-Legacy-Key') || '';
  if (state.key && (key === state.key || legacy === state.key)) return { ok: true };
  return { ok: false, legacy: !!state.key };
}

const denied = (a) => json({ error: 'unauthorized', legacy: !!a.legacy }, 403);

export default {
  async fetch(req, env) {
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });

    const url = new URL(req.url);
    const state = await loadState(env);

    if (url.pathname === '/health') {
      return json({ ok: true, configured: !!state, v: VERSION });
    }

    if (url.pathname === '/state' && req.method === 'GET') {
      if (!state) return json({ error: 'not found' }, 404);
      const a = await authorize(req, state);
      if (!a.ok) return denied(a);
      const { key: _k, authHash: _h, ...pub } = state; // never hand back secrets
      return json(pub);
    }

    if (url.pathname === '/state' && req.method === 'PUT') {
      // first write bootstraps the key; later writes must match it
      if (state) {
        const a = await authorize(req, state);
        if (!a.ok) return denied(a);
      }
      const body = await req.json().catch(() => null);
      const key = req.headers.get('X-Key') || '';
      if (!key) return json({ error: 'X-Key required' }, 400);
      if (body && body.enc && typeof body.enc.ct === 'string') {
        // encrypted plan: store the ciphertext and only a hash of the auth token
        const { text: _t, archive: _a, ...rest } = body;
        await env.SIMPLEDAY.put('state', JSON.stringify({ ...rest, authHash: await sha256hex(key) }));
        return json({ ok: true, encrypted: true });
      }
      if (!body || typeof body.text !== 'string') return json({ error: 'bad body' }, 400);
      // plaintext write from an old client: never downgrade an encrypted store
      if (state && state.authHash) return json({ error: 'encrypted store: update the app' }, 409);
      await env.SIMPLEDAY.put('state', JSON.stringify({ ...body, key }));
      return json({ ok: true, encrypted: false });
    }

    if (url.pathname === '/test' && req.method === 'POST') {
      if (state) {
        const a = await authorize(req, state);
        if (!a.ok) return denied(a);
      }
      const body = await req.json().catch(() => ({}));
      if (!body.botToken || !body.chatId) return json({ error: 'botToken and chatId required' }, 400);
      try {
        await sendTelegram(body.botToken, body.chatId, 'SimpleDay is connected. Notifications will arrive here.');
        return json({ ok: true });
      } catch (e) {
        return json({ error: e.message }, 502);
      }
    }

    return json({ error: 'not found' }, 404);
  },

  async scheduled(event, env, ctx) {
    const state = await loadState(env);
    if (!state || !state.settings || !state.settings.botToken || !state.settings.chatId) return;
    const { botToken, chatId } = state.settings;
    const now = Date.now();
    const GRACE = 30 * 60 * 1000; // deliver up to 30 min late, then drop

    const due = (state.notifications || []).filter(
      (n) => n.fireAt <= now && n.fireAt > now - GRACE
    );

    for (const n of due.slice(0, 20)) {
      const sentKey = `sent:${n.key}`;
      const already = await env.SIMPLEDAY.get(sentKey);
      if (already) continue;
      try {
        const late = now - n.fireAt > 5 * 60 * 1000;
        await sendTelegram(botToken, chatId, (late ? '(late) ' : '') + n.text);
        ctx.waitUntil(env.SIMPLEDAY.put(sentKey, '1', { expirationTtl: 14 * 24 * 3600 }));
      } catch (e) {
        // leave unsent; next cron tick retries within the grace window
        console.error('send failed', e);
      }
    }
  },
};
