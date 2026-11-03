# ★ My Stars

A local, mobile-first, installable (PWA) UI for searching your GitHub stars — by repo name, description and topics — plus a **"Find top 5 similar on GitHub"** button that surfaces the most-starred repos matching what you searched.

Zero dependencies. One Node server, one HTML file.

## Features

- **Ranked search** over name, description, topics and language:
  - rare words weigh more than common ones (IDF)
  - name > topics > description field weighting
  - stemming/prefix matching (`separation` ↔ `separate`, `demos` ↔ `demo`)
  - small synonym map (`separation` → stems, demix, isolate, karaoke…) — edit `GROUPS` in `search.js`
  - phrase bonus, coverage penalty, and weak matches tucked behind a toggle
- **Similar on GitHub** — for a search or any starred repo; runs the full query plus quoted word-pair phrases, merges, ranks by stars, excludes repos you've already starred
- Sort by best match, recently starred, most stars, recently updated, name
- Light/dark, installable PWA, works offline with your last-synced stars

## Run

Requires Node 18+ and a GitHub token — either `GITHUB_TOKEN` in the environment or a logged-in [`gh`](https://cli.github.com/) CLI.

```bash
npm start            # http://0.0.0.0:5178
PORT=8080 npm start  # custom port
```

The first load fetches all your stars and caches them to `stars.json`; tap **↻ Sync** to refresh.

### Keep it running (pm2)

```bash
pm2 start server.mjs --name mystars && pm2 save
```

### Install on your phone

PWAs need HTTPS. If you use Tailscale:

```bash
tailscale serve --bg --https=8448 http://127.0.0.1:5178
```

Then open `https://<machine>.<tailnet>.ts.net:8448` on your phone → **Install app** (Android) or **Share → Add to Home Screen** (iOS).

## Files

| File | Purpose |
| --- | --- |
| `server.mjs` | Fetches/caches stars, proxies GitHub search, serves the app |
| `index.html` | UI |
| `search.js` | Ranking engine (browser + Node) |
| `public/` | Manifest, service worker, icons |
