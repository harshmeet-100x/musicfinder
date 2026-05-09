# Music Finder

Natural-language music search across **Spotify, Deezer, iTunes, MusicBrainz** (plus a **Bandcamp** fallback for indie/underground tracks). Every result is resolved to a **YouTube** link so you can play it instantly.

## Live

- **Frontend:** https://music-finder-eight.vercel.app/ (Vercel)
- **Backend:** runs on the developer's machine, exposed publicly over HTTPS by [Cloudflare's free quick tunnel](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/do-more-with-tunnels/trycloudflare/) — no credit card, no account.

### Why this hybrid setup?

The original spec targeted Render for the API. In 2024 Render, Fly, Koyeb, and the similar Docker-friendly hosts all started requiring a credit card on file (even for free tiers). To keep this fully card-free without sacrificing a working public demo, the backend stays on the developer's machine and is fronted by a Cloudflare quick tunnel for the public Vercel page to reach.

Trade-offs:

- ✅ Fully open source, no card.
- ✅ Frontend is permanently hosted on Vercel.
- ✅ Backend runs the full Express + SQLite + Playwright stack with no compromises.
- ⚠️ The tunnel URL changes every time `cloudflared tunnel --url ...` is restarted. To rotate it, run the helper script and redeploy the frontend (one command, ~30s).
- ⚠️ When the developer machine is offline, the demo returns a network error. The frontend handles this gracefully (toasts).

### Running it yourself

```bash
git clone https://github.com/harshmeet-100x/musicfinder.git
cd musicfinder
pnpm install
cp .env.example backend/.env
# (optional) add SPOTIFY_CLIENT_ID/SECRET, YOUTUBE_API_KEY in backend/.env

# Terminal 1 — backend
pnpm --filter backend dev      # http://localhost:3001

# Terminal 2 — local frontend (alternative to the live Vercel URL)
pnpm --filter frontend dev     # http://localhost:5173

# Optional Terminal 3 — public tunnel for the live Vercel page
cloudflared tunnel --url http://localhost:3001
# Then update vercel.json's VITE_API_BASE_URL to the trycloudflare URL and `vercel --prod` to redeploy.
```

## Why

Most music apps lock you into one catalog. Most "search this and that" tools open a dozen tabs. Music Finder asks four catalogs in parallel, dedupes results by source, and resolves every track to a single, universally-playable YouTube link — with a graceful fallback to the originating source if a track can't be found on YouTube.

## How it works

```
                ┌────────────┐
        query → │  React UI  │ ── SSE ──┐
                └────────────┘          │
                                         ▼
                                ┌──────────────────┐
                                │ Express + SQLite │
                                │  /api/search/*   │
                                └────────┬─────────┘
                                         │
                ┌────────────────────────┼────────────────────────┐
                ▼                        ▼                        ▼
       ┌─────────────────┐     ┌─────────────────┐     ┌────────────────┐
       │ Music sources   │     │ Query cache     │     │ YouTube cache  │
       │ Spotify, Deezer,│     │ (24h TTL,       │     │ (artist,title) │
       │ iTunes, MB,     │     │  SHA-256 keyed) │     │   → videoId    │
       │ Bandcamp scrape │     └─────────────────┘     └────────┬───────┘
       └────────┬────────┘                                      │
                │ p-limit(5)                                    │
                └──────────────► YouTube resolver ◄─────────────┘
                                  ├── API (100u/req, 9.5k cap)
                                  └── Playwright scrape fallback
                                        (parses ytInitialData)
```

**Two-phase SSE streaming.** Phase 1 streams source results immediately with a "resolving…" placeholder on the play button. Phase 2 patches each card in place as YouTube resolution completes. A repeat query within 24 hours short-circuits to the cache and replays the stream end-to-end — round-trip <100ms.

## Quick start

```bash
# 1. Install
pnpm install

# 2. Configure (optional but recommended)
cp .env.example backend/.env
# Edit backend/.env if you have Spotify or YouTube API credentials

# 3. Run both apps
pnpm dev
# Backend on http://localhost:3001
# Frontend on http://localhost:5173 (proxied to the backend at /api/*)
```

Without API keys, Spotify is skipped and YouTube falls through to Playwright scraping. iTunes, MusicBrainz, and Deezer require no credentials. Bandcamp scraping kicks in only when the API sources collectively return fewer than five results.

## Environment variables

| Var | Required | Default | Notes |
| --- | --- | --- | --- |
| `SPOTIFY_CLIENT_ID` | optional | — | Disables Spotify if missing |
| `SPOTIFY_CLIENT_SECRET` | optional | — | Disables Spotify if missing |
| `YOUTUBE_API_KEY` | optional | — | If missing, app scrapes from request 1 |
| `PORT` | no | `3001` | |
| `NODE_ENV` | no | `development` | |
| `CACHE_TTL_HOURS` | no | `24` | Whole-response cache TTL |
| `YOUTUBE_DAILY_QUOTA` | no | `10000` | Used for the safety circuit-breaker |
| `YOUTUBE_QUOTA_SAFETY_MARGIN` | no | `500` | Switch to scrape when within margin |
| `USER_AGENT` | yes for prod | `MusicSearchApp/1.0 (...)` | MusicBrainz requires a contactable UA |
| `FRONTEND_URL` | no | `http://localhost:5173` | |
| `ALLOWED_ORIGINS` | yes for prod | `http://localhost:5173` | Comma-separated CORS allowlist |
| `RATE_LIMIT_WINDOW_MS` | no | `60000` | |
| `RATE_LIMIT_MAX_REQUESTS` | no | `30` | Per IP, per window |
| `DB_PATH` | no | `./data/music-finder.sqlite` | SQLite file path |

The frontend reads `VITE_API_BASE_URL` at build time. Leave it empty in dev (Vite proxies `/api` to the backend); in production set it to your Render URL.

## Project layout

```
.
├── frontend/              # Vite + React + Tailwind + TS
├── backend/               # Express + TS + better-sqlite3 + Playwright
│   ├── src/sources/       # spotify, deezer, itunes, musicbrainz, bandcamp
│   ├── src/youtube/       # api.ts, scrape.ts, resolver.ts, quota.ts
│   ├── src/cache/         # db, queryCache, youtubeCache, stats
│   ├── src/routes/        # search, cacheStats, health
│   ├── render.yaml
│   ├── fly.toml
│   └── Dockerfile
├── shared/src/index.ts    # MusicResult, SSEEvent, etc.
├── docs/audits/           # performance / security / validation reports
└── docker-compose.yml
```

## Endpoints

| Method | Path | Notes |
| --- | --- | --- |
| `GET` | `/api/health` | Liveness check |
| `POST` | `/api/search` | Body `{ query: string }`. Returns full result set. |
| `GET` | `/api/search/stream?q=...` | Two-phase SSE stream. |
| `GET` | `/api/cache/stats` | Hit/miss counters and YouTube quota usage |

Rate limiter: 30 requests / minute / IP on `/api/search` and `/api/search/stream`.

## Development

```bash
pnpm dev         # both apps (concurrently)
pnpm typecheck   # all packages
pnpm test        # all packages (Vitest)
pnpm lint        # all packages
docker-compose up
```

Pre-commit hooks: `husky` + `lint-staged` keep formatting and linting consistent on every commit.

## Audits

Audit reports live in `docs/audits/`:

- [`performance.md`](./docs/audits/performance.md) — the performance sub-agent's findings and applied fixes
- [`security.md`](./docs/audits/security.md) — the security sub-agent's findings and applied fixes
- [`validation.md`](./docs/audits/validation.md) — the validation sub-agent's test plan, results, and bugs found

## License

ISC
