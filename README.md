# Calendar Sync

A small app to manage calendar feed subscriptions so you can subscribe to them in iOS/Mac Calendar (and other clients). Each feed is exposed as a public `.ics` subscribe URL (e.g. `https://yoursite.netlify.app/cal/football.ics`). Add the URL once in Apple Calendar; events stay in sync. To unsubscribe, remove the calendar in the Calendar app.

## Stack

- **Frontend:** Vue 3, Vite, Tailwind CSS
- **Backend:** Netlify Functions (Node) for feed list and `.ics` generation
- **Hosting:** Netlify (free tier)

## Run locally

```bash
npm install
npm run dev
```

The Vue app runs at `http://localhost:5173`. Feed list and calendar URLs will work only when the Netlify Functions are available (e.g. with `netlify dev` or after deploy).

### With Netlify Dev (functions + app)

```bash
npm install -g netlify-cli   # once
netlify dev
```

Then open the URL shown (e.g. `http://localhost:8888`). You can subscribe to `http://localhost:8888/cal/football.ics` in Calendar for local testing.

## Deploy to Netlify

1. Push this repo to GitHub.
2. In [Netlify](https://app.netlify.com): **Add new site → Import an existing project** → choose the repo.
3. Build settings (usually detected):
   - **Build command:** `npm run build`
   - **Publish directory:** `dist`
   - **Functions directory:** `netlify/functions`
4. Deploy. Your site will be at `https://<name>.netlify.app`.

Subscribe to a calendar: open the app, click **Add to Calendar** for a feed, or copy the feed URL and in iOS/Mac Calendar add a new calendar subscription with that URL. To unsubscribe, remove the calendar in the Calendar app.

## Feed registry

Feeds are defined in **`netlify/functions/feeds-registry.json`**. Each entry has:

- `id` – unique slug (used in URLs, e.g. `football` → `/cal/football.ics`)
- `name` – display name
- `type` – `static` | `api` | `url`
- `source` – optional; shape depends on `type`

## Adding a new feed

1. Edit `netlify/functions/feeds-registry.json` and add an entry (or use the **Add feed (admin)** section in the app to generate the JSON, then paste it into the file).
2. If the feed type is already supported (`static`, `url`, or an existing `api` provider), redeploy. The new feed will appear and be available at `/cal/<id>.ics`.
3. If you need a **new feed type** (e.g. a new API or scraper), see below.

## Adding a new feed type

1. **Implement the type in `netlify/functions/cal.js`:**
   - Either return an array of events `{ start, end, summary, description?, location? }` and the handler will build the `.ics`, or
   - Return a raw `.ics` string (e.g. for `url` type) and send it in the response.
2. **Extend `getEventsForFeed`** (or the URL branch) so that when `type` and `source` match your new type, you fetch/transform data and return events or `.ics`.
3. **Document the type** and `source` shape in `netlify/functions/FEED_TYPES.md`.
4. Add a feed entry in `feeds-registry.json` with that `type` and the right `source`.

See `netlify/functions/FEED_TYPES.md` for the feed type contract and event shape.

## License

MIT.
