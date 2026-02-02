# Calendar Sync

A mini app to manage calendar feed subscriptions for iOS/Mac Calendar (and other clients). Each feed is exposed as a public `.ics` URL. Add the URL once in Apple Calendar; events stay in sync. To unsubscribe, remove the calendar in the Calendar app.

**Demo:** https://gakpaketelor-calender.netlify.app/

## Features

- **Subscribe to .ics feeds** – Add to iOS/macOS Calendar with one click (webcal) or copy URL
- **URL proxy** – Proxy external .ics URLs through your own domain
- **API feeds** – Generate calendars from APIs (e.g. Ayyamul Bidh fasting schedule using Hijri conversion)
- **Scrape/crawl feeds** – Crawl football schedules from websites:
  - [Liga Indonesia Baru](https://www.ligaindonesiabaru.com/) – club fixture pages
  - [Transfermarkt Indonesia](https://www.transfermarkt.co.id/) – club schedule pages with Home/Away detection
- **Refresh button** – Re-crawl source data; subscribers get updates on next sync
- **WIB timezone** – Indonesian football times are correctly converted to UTC for calendar apps

## Stack

- **Frontend:** Vue 3, Vite, Tailwind CSS
- **Backend:** Netlify Functions (Node) for feed list and `.ics` generation
- **Hosting:** Netlify (free tier)

## Feed types

| Type | Description | Source shape |
|------|-------------|--------------|
| `url` | Proxy an external .ics URL | `{ url: "https://..." }` |
| `api` | Generate events from code/API | `{ provider: "ayyamul-bidh" }` |
| `scrape` | Crawl a website for fixtures | `{ url: "https://...", clubName?: "..." }` |

### Supported scrape sources

- **Liga Indonesia Baru** – `https://www.ligaindonesiabaru.com/clubs/single/...`
- **Transfermarkt Indonesia** – `https://www.transfermarkt.co.id/.../spielplan/verein/...`

## Run locally

```bash
npm install
npm run dev
```

The Vue app runs at `http://localhost:5173`. Feed list and calendar URLs require Netlify Functions (use `netlify dev`).

### With Netlify Dev (functions + app)

```bash
npm install -g netlify-cli   # once
netlify dev
```

Open `http://localhost:8888`. Subscribe to `http://localhost:8888/cal/<feed-id>.ics` for local testing.

### Tracing scrape locally

When you hit a **scrape** feed while running `netlify dev`, the function logs to the terminal:

- `[cal scrape] getFootballScheduleEvents` – URL and club name
- `[cal scrape] fetchHtml` – request URL, then `ok` (bytes) or `fail` / `error`
- `[cal scrape] parseLigaIndonesiaBaru` – events found
- `[cal scrape] parseTransfermarkt` – events found
- `[cal scrape] getFootballScheduleEvents done` – final event count

Tracing is on when `NODE_ENV !== 'production'`. To force it in production, set env `TRACE_SCRAPE=1` in Netlify.

## Deploy to Netlify

1. Push this repo to GitHub.
2. In [Netlify](https://app.netlify.com): **Add new site → Import an existing project** → choose the repo.
3. Build settings (usually auto-detected):
   - **Build command:** `npm run build`
   - **Publish directory:** `dist`
   - **Functions directory:** `netlify/functions`
4. Deploy. Your site will be at `https://<name>.netlify.app`.

## Feed registry

Feeds are defined in `netlify/functions/feeds-registry.json`. Example entries:

```json
[
  {
    "id": "inter-25-26",
    "name": "Inter 25/26",
    "type": "url",
    "source": { "url": "https://app.stanzacal.com/api/calendar/webcal/inter/..." }
  },
  {
    "id": "ayyamul-bidh",
    "name": "Ayyamul Bidh",
    "type": "api",
    "source": { "provider": "ayyamul-bidh" }
  },
  {
    "id": "persebaya-26",
    "name": "Persebaya 2026",
    "type": "scrape",
    "source": {
      "url": "https://www.ligaindonesiabaru.com/clubs/single/BRI_SUPER_LEAGUE_2025-26/PERSEBAYA_SURABAYA",
      "clubName": "Persebaya Surabaya"
    }
  },
  {
    "id": "persebaya-26-tm",
    "name": "Persebaya 2026 (Transfermarkt)",
    "type": "scrape",
    "source": {
      "url": "https://www.transfermarkt.co.id/persebaya-surabaya/spielplan/verein/31444",
      "clubName": "Persebaya Surabaya"
    }
  }
]
```

## Adding a new feed

**Option A: Add feed via UI (opens a GitHub PR)**

1. In the app, expand **Add feed**, fill the form (ID, name, type, URL or scrape/api options), and click **Add feed (open PR)**.
2. A Netlify Function creates a branch, updates `feeds-registry.json`, and opens a Pull Request. Merge the PR; the next deploy will include the new feed.
3. **Required:** In Netlify → Site settings → Environment variables, set:
   - **GITHUB_TOKEN** – A GitHub Personal Access Token with `repo` scope (so the function can create a branch and open a PR).
   - **REPOSITORY_URL** – Usually set automatically when the site is linked to a Git repo (e.g. `https://github.com/owner/repo.git`). If missing, set it to your repo URL.

**Option B: Edit the registry by hand**

1. Edit `netlify/functions/feeds-registry.json` and add an entry (see examples above).
2. Commit, push, and deploy. The feed appears at `/cal/<id>.ics`.
3. For a **new scrape source**, add a parser in `netlify/functions/cal.js` and wire it in `getFootballScheduleEvents`.

## Adding a new feed type

1. Implement in `netlify/functions/cal.js`:
   - Return an array of events `{ start, end, summary, description?, location?, allDay? }`, or
   - Return raw `.ics` string (for URL proxies).
2. Extend `getEventsForFeed` to handle your new type.
3. Document the type in `netlify/functions/FEED_TYPES.md`.

See `netlify/functions/FEED_TYPES.md` for the feed type contract and event shape.

## How subscribers get updates

- Calendar apps (iOS, macOS, Google Calendar) refetch .ics URLs periodically (every few hours).
- Scraped feeds are cached 5 minutes at CDN; after that, requests trigger a fresh crawl.
- Use the **Refresh** button to re-crawl immediately. To force your calendar app to update, remove and re-add the subscription.

## License

MIT.
