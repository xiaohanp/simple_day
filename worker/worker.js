// DayFlow notification worker — Cloudflare Workers (free tier).
// Runs a cron every minute and sends due schedule items to Telegram.
// The frontend stores the already-computed notification list here,
// so this worker stays deliberately dumb: no parsing, no timezone math.

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, PUT, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, X-Key',
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
  return (await env.DAYFLOW.get('state', 'json')) || null;
}

function authorized(req, state) {
  const key = req.headers.get('X-Key') || '';
  return state && state.key && key === state.key;
}

export default {
  async fetch(req, env) {
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });

    const url = new URL(req.url);
    const state = await loadState(env);

    if (url.pathname === '/health') {
      return json({ ok: true, configured: !!state });
    }

    if (url.pathname === '/state' && req.method === 'GET') {
      if (!state) return json({ error: 'not found' }, 404);
      if (!authorized(req, state)) return json({ error: 'unauthorized' }, 403);
      return json(state);
    }

    if (url.pathname === '/state' && req.method === 'PUT') {
      // first write bootstraps the key; later writes must match it
      if (state && !authorized(req, state)) return json({ error: 'unauthorized' }, 403);
      const body = await req.json().catch(() => null);
      if (!body || typeof body.text !== 'string') return json({ error: 'bad body' }, 400);
      const key = req.headers.get('X-Key') || '';
      if (!key) return json({ error: 'X-Key required' }, 400);
      await env.DAYFLOW.put('state', JSON.stringify({ ...body, key }));
      return json({ ok: true });
    }

    if (url.pathname === '/test' && req.method === 'POST') {
      if (state && !authorized(req, state)) return json({ error: 'unauthorized' }, 403);
      const body = await req.json().catch(() => ({}));
      if (!body.botToken || !body.chatId) return json({ error: 'botToken and chatId required' }, 400);
      try {
        await sendTelegram(body.botToken, body.chatId, 'DayFlow is connected. Notifications will arrive here.');
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
      const already = await env.DAYFLOW.get(sentKey);
      if (already) continue;
      try {
        const late = now - n.fireAt > 5 * 60 * 1000;
        await sendTelegram(botToken, chatId, (late ? '(late) ' : '') + n.text);
        ctx.waitUntil(env.DAYFLOW.put(sentKey, '1', { expirationTtl: 14 * 24 * 3600 }));
      } catch (e) {
        // leave unsent; next cron tick retries within the grace window
        console.error('send failed', e);
      }
    }
  },
};
