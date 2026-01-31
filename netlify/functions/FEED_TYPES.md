# Feed type contract

Each feed in `feeds-registry.json` has: `id`, `name`, `type`, and optional `source`.

## Types

### `static`
Built-in events in code. No `source` or `source` is null.
- **Input:** feed `id` (e.g. `football`, `fasting` fallback).
- **Output:** Array of events `{ start, end, summary, description?, location? }` from hardcoded getters.

### `api`
Fetch from an external API and convert to events.
- **Input:** `source` with `provider` and provider-specific params.
- **Output:** Array of events. Implement per-provider in `getEventsForFeed` / helper.

**Providers:**
- **`ayyamul-bidh`** – Ayyamul Bidh fasting (13th, 14th, 15th of each Islamic month). No extra params. Uses Umm al-Qura conversion (hijri-converter). Reference: [KHGT Kalender Hijriah](https://khgt.muhammadiyah.or.id/kalendar-hijriah).

### `url`
Proxy an external .ics URL.
- **Input:** `source.url` (string).
- **Output:** Raw .ics response body; no conversion. Handler fetches `source.url` and returns it.

### `scrape`
Crawl a URL for football (or other) fixtures and build events.
- **Input:** `source.url` (string, required), `source.clubName` (string, optional, used in event descriptions).
- **Output:** Array of events. Fetches HTML, then tries: (1) JSON-LD Event/SportsEvent in script tags, (2) table parser (Transfermarkt-style: date, time, home, away).
- **Suggested sources** (open/updated fixture pages you can use as URL):
  - **Transfermarkt** (club schedule): e.g. `https://www.transfermarkt.com/inter-mailand/spielplan/verein/46/saison_id/2024` (change club and season).
  - **Transfermarkt** (league schedule): e.g. `https://www.transfermarkt.com/serie-a/spielplan/wettbewerb/IT1/saison_id/2024`.
  - **Wikipedia** (season article with fixture table): e.g. "2024–25 Inter Milan season" fixture section.
  - **Official league sites**: Serie A, Premier League, etc. often have fixture pages (check for JSON-LD or simple tables).
  - **Stanzacal / .ics feeds**: prefer `type: "url"` and use the .ics URL directly; use `scrape` only when no .ics is available.

## Adding a new feed type

1. Add a new `type` value and handle it in `cal.js`:
   - Either return an array of events (then use `buildIcs()`), or
   - Return a raw .ics string and send it in the response.
2. Add an entry to `feeds-registry.json` with that `type` and the right `source` shape.
3. Document the `source` schema in this file.

## Event shape

For types that return events (e.g. `static`, `api`):

- `start`, `end`: JavaScript `Date` instances.
- `summary`: string (required).
- `description`: string (optional).
- `location`: string (optional).
