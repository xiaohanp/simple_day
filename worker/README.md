# DayFlow notification worker

A tiny Cloudflare Worker that fires your schedule items as Telegram messages.
Free tier is more than enough: ~1,500 cron runs/day out of 100,000 free requests.

## Deploy (one-time, ~10 min)

```bash
npm install -g wrangler
wrangler login                                   # opens Cloudflare in your browser
cd worker
cp wrangler.example.toml wrangler.toml           # your local config (git-ignored)
wrangler kv namespace create DAYFLOW             # copy the "id" it prints
# paste the id into wrangler.toml (replace PASTE_YOUR_KV_NAMESPACE_ID_HERE)
wrangler deploy                                  # prints your worker URL
```

Paste that URL (e.g. `https://dayflow.<you>.workers.dev`) into the app's
Settings → Notification server → Worker URL. Done.

## How it works

- The app computes absolute fire times (UTC) from your plain-text schedule and
  PUTs them here together with your text and Telegram settings.
- Every minute, the cron reads the state and sends whatever is due
  (up to 30 minutes late; missed-too-long items are dropped).
- Sent items are recorded in KV for 14 days so nothing fires twice.
- Your secret key (Settings → Secret key) protects reads and writes.

## Costs

Cloudflare Workers free plan: 100,000 requests/day, 1,000 KV writes/day,
cron triggers included. This app uses a small fraction of that. No credit card
required. Telegram Bot API is free.
