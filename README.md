# Subs Calendar

**Subs Calendar** (slug: `calendar-feed-manager`) – A mini app to manage calendar feed subscriptions for iOS/Mac Calendar (and other clients). Each feed is exposed as a public `.ics` URL. Add the URL once in Apple Calendar; events stay in sync. To unsubscribe, remove the calendar in the Calendar app.

**Status:** Beta (v0.1.0)

**Demo:** https://gakpaketelor-calender.netlify.app/

## Features

- **Subscribe to .ics feeds** – Add to iOS/macOS Calendar with one click (webcal) or copy URL
- **Categories** – Feeds grouped by category (Religion, Football). Each category and feed has a short teaser.
- **URL proxy** – Proxy external .ics URLs through your own domain
- **API feeds** – Generate calendars from APIs (e.g. Ayyamul Bidh fasting schedule using Hijri conversion)
- **Scrape/crawl feeds** – Crawl football schedules from websites (no date cutoff; all past and future fixtures):
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

Feeds are defined in `netlify/functions/feeds-registry.json`. Each entry can include optional `category` and `teaser` for the UI:

| Field      | Required | Description |
|-----------|----------|-------------|
| `id`      | Yes      | Slug used in `/cal/<id>.ics` |
| `name`    | Yes      | Display name |
| `type`    | Yes      | `url`, `api`, or `scrape` |
| `source`  | Yes      | Type-specific config (see Feed types) |
| `category`| No       | Group in UI: `religion`, `football`, or omit for "Other" |
| `teaser`  | No       | Short description under the feed name |

Example entries (matches current registry):

```json
[
  {
    "id": "inter-25-26",
    "name": "Inter 25/26",
    "teaser": "FC Internazionale Milano 25/26 season fixtures. Subscribe to get match dates in your calendar.",
    "category": "football",
    "type": "url",
    "source": { "url": "https://app.stanzacal.com/api/calendar/webcal/inter/..." }
  },
  {
    "id": "ayyamul-bidh",
    "name": "Ayyamul Bidh",
    "teaser": "Fasting days reminder (13th, 14th, 15th of each Hijri month).",
    "category": "religion",
    "type": "api",
    "source": { "provider": "ayyamul-bidh" }
  },
  {
    "id": "persebaya-26-tm",
    "name": "Persebaya 25/26",
    "teaser": "Persebaya Surabaya 25/26 season fixtures. Subscribe to get match dates in your calendar.",
    "category": "football",
    "type": "scrape",
    "source": {
      "url": "https://www.transfermarkt.co.id/persebaya-surabaya/spielplan/verein/31444",
      "clubName": "Persebaya Surabaya",
      "stadiumSourceUrl": "https://www.ligaindonesiabaru.com/clubs/single/BRI_SUPER_LEAGUE_2025-26/PERSEBAYA_SURABAYA"
    }
  }
]
```

## Adding a new feed

1. Edit `netlify/functions/feeds-registry.json` and add an entry (see examples above). Include `id`, `name`, `type`, `source`, and optionally `category` and `teaser`.
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
