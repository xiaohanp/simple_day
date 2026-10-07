# SimpleDay

A minimal day planner: your week at a glance, your day hour by hour.

SimpleDay has a clean week overview shows what's
coming, an hour-by-hour plan shows exactly how today fits together, and a
reminder reaches your phone when it's time. Underneath, your whole plan is plain text, so it stays
fast, portable and private.

**Live:** https://simpleday.pages.dev

## Features

- **Week and day views.** See the week's days at a glance, then open any day
  as an hour-by-hour plan. Drag a block to reschedule it.
- **Reminders on Telegram**, right at the start time by default, or 5, 10 or any
  number of minutes before.
- **Calendar import.** Bring in events from Google Calendar, Apple Calendar or
  Outlook with an `.ics` file.
- **No account and no sign-up.** No account and no sign-up. It works offline and installs on
  your phone like an app.
- **Plain text as the ground truth.** Everything you see is stored as simple,
  readable text, and you can edit it directly
  (see [The text format](#the-text-format)).
- **Private.** Your plan stays in your browser. Sync between devices and
  reminders go through your own free Cloudflare worker.

## Setting up reminders

Reminders are sent by a small Cloudflare Worker that you deploy to your own
free Cloudflare account. The app works out when each reminder should fire and
stores the list in the worker. The worker checks every minute and messages you
on Telegram.

1. **Create a Telegram bot.** In Telegram, message **@BotFather**, send `/newbot`
   and follow the steps. Paste the bot token into SimpleDay → Settings, send your
   new bot any message, then press **Detect** next to Chat ID.
2. **Deploy the worker.** You need a computer with [Node.js](https://nodejs.org)
   and a copy of this project (`git clone https://github.com/xiaohanp/dayflow.git`,
   or **Code → Download ZIP** on GitHub). Then, in the project folder:
   ```bash
   npm install -g wrangler
   wrangler login                            # opens Cloudflare in your browser
   cd worker
   cp wrangler.example.toml wrangler.toml
   wrangler kv namespace create SIMPLEDAY    # paste the printed id into wrangler.toml
   wrangler deploy                           # prints your worker URL
   ```
   No computer? See [Setting up the worker without a computer](#setting-up-the-worker-without-a-computer)
   at the end.
3. **Connect the app.** Paste the worker URL into Settings → Worker URL, then
   press **Send test notification**.

### Using another device or a new address

Open Settings there and enter the **same worker URL and secret key** as on your
first device. The secret key is generated the first time you open the app, so
keep it somewhere safe. Anyone with both your worker URL and key can read and
change your plan.

A new device or address starts with a sample plan. Before entering the key,
paste your real plan into the text panel. Otherwise the sample is uploaded over
your plan as soon as the key matches.

## Development

Requires Node.js 20+.

```bash
npm install
npm run dev        # http://localhost:5173
npm run build      # type-check + production build into dist/
npm run lint
```

### Deploying the web app

The app is a static site, hosted on Cloudflare Pages:

```bash
npm run build
wrangler pages deploy dist --project-name simpleday --branch main
```

The first run creates the Pages project. Deploy to the production branch you
chose there (`main`), so the site goes live at `https://<project>.pages.dev`
instead of a preview URL. Any other static host works too: just serve `dist/`.

### Deploying the worker

Only needed when `worker/worker.js` or `worker/wrangler.toml` changes:

```bash
cd worker
wrangler deploy
```

`worker/wrangler.toml` holds your own KV namespace ID and is git-ignored.
`worker/wrangler.example.toml` is the template.

## Privacy

There's no SimpleDay server. Your plan is stored in your browser's local
storage. If you set up reminders, it's also stored in your worker's KV storage
in your own Cloudflare account, together with your Telegram bot token. Nothing
is sent anywhere else, apart from the reminder messages to Telegram.

## Setting up the worker without a computer

A backup route if you only have a phone or tablet. Everything happens in the
Cloudflare dashboard in your browser. It's fiddlier on a small screen, but
nothing needs installing.

1. Sign up at [dash.cloudflare.com](https://dash.cloudflare.com/sign-up). No card
   needed.
2. **Storage & Databases → KV → Create**, named `simpleday`.
3. **Workers & Pages → Create → Start with Hello World**, named `simpleday`,
   then **Deploy**.
4. **Edit code**, delete everything, paste the SimpleDay worker code and
   **Deploy**. The app has a **Copy worker code** button in Settings → Setup
   guide, or copy [`worker/worker.js`](worker/worker.js).
5. On the worker: **Bindings → Add binding → KV namespace**. Variable name
   `SIMPLEDAY` (capitals), namespace `simpleday`.
6. **Settings → Trigger events → Add → Cron triggers**, every minute
   (`* * * * *`).
7. Copy the worker's `.workers.dev` address into SimpleDay → Settings → Worker
   URL, then press **Send test notification**.

## The text format

Under the hood, a plan is plain text. Open the text panel in the app to read or
edit it directly; the views and the text always stay in sync.

```text
## Thu Oct 8 2026 — writing day
09:00 Thesis writing 4h          fixed start, lasts 4 hours
French 30m                       floating: starts when the previous item ends
09:00-13:00 Deep work            fixed start and end
14:00 Call with Anna 1h !10      remind 10 minutes before
16:00 Gym !off                   no reminder
Buy milk                         no time at all, just a task

## tomorrow
08:30 Standup                    reminder right at 08:30 (the default)
```

| You write                                                                          | Meaning                                                                |
| ---------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| `## 2026-10-08`, `## Thu Oct 8`, `## October 8th, 2026`, `## today`, `## tomorrow` | Starts a day. Anything after the date (e.g. `— light day`) is a label. |
| `09:00 …` / `09:00-13:00 …`                                                        | Fixed start time (and optional end).                                   |
| `30m`, `1h`, `1.5h`, `2h15m`                                                       | Duration.                                                              |
| `!10`, `!1h`                                                                       | Reminder that many minutes or hours before the start.                  |
| `!off`                                                                             | No reminder for this item.                                             |
| Lines before the first `##` heading                                                | Inbox: things not yet scheduled.                                       |

Only items with a time get reminders.
