# Music Search Web App — Build Spec

You are building, hardening, and **deploying** a full-stack music search web app from scratch. The user types a natural-language query (e.g. "chill lofi like Nujabes", "90s shoegaze deep cuts", "upbeat songs for running") and the app returns aggregated music results from multiple sources. **Every result is resolved to a YouTube link** — so the user always plays/opens content via YouTube, regardless of which source originally surfaced the track.

You will build the entire thing end-to-end, harden it through dedicated sub-agent passes, and deploy it. Do not ask me to make decisions on tech choices already specified below. For anything not specified, pick sensible defaults and keep moving.

---

## Tech stack (non-negotiable)

- **Frontend:** React + Vite + TypeScript + Tailwind CSS
- **Backend:** Node.js + Express + TypeScript
- **DB:** SQLite via `better-sqlite3` (for response caching only — no user data)
- **Scraping fallback:** `playwright-core` + `@sparticuz/chromium` (lightweight, deploy-friendly)
- **Package manager:** pnpm
- **Monorepo layout:** single repo, two packages (`/frontend`, `/backend`), shared types in `/shared`

---

## My environment (already set up)

- I have a **Render** account, authenticated and ready.
- I have **Vercel CLI** installed and authenticated in this Claude Code session.
- I will create the GitHub repo and push the initial commit. You handle everything else, including deployment.

If you need an API key from me (Spotify, YouTube), pause and ask once with a clear `> **ACTION REQUIRED**` block listing every key you need. Do not pause repeatedly.

---

## Functional requirements

### 1. Query handling
- User types a free-form text query in the frontend.
- Backend receives it via `POST /api/search` with `{ query: string }`.
- Backend normalizes the query (lowercase, trim, collapse whitespace, strip control chars) and uses the normalized form as a cache key.

### 2. Multi-source music search (in parallel)
The backend queries these sources **in parallel** using `Promise.allSettled` so one slow/failing source never blocks the others. **These sources are used to discover music — the actual playable links come from YouTube (see section 3).**

**API sources (no scraping needed):**
- **Spotify Web API** — primary source. Use Client Credentials flow. Search tracks, artists, albums.
- **Deezer API** — `https://api.deezer.com/search` — no auth required.
- **iTunes Search API** — `https://itunes.apple.com/search` — no auth required.
- **MusicBrainz** — `https://musicbrainz.org/ws/2/` — no auth, but requires a `User-Agent` header.

**Playwright fallback (only if API sources return < 5 total results):**
- Scrape **Bandcamp tag/discover pages** for indie/underground results that APIs miss.
- Use `playwright-core` + `@sparticuz/chromium` so it works in serverless environments.
- Wrap in a 10-second timeout. If it fails, skip it silently.

### 3. YouTube resolution (hybrid: API → scrape fallback)

After the music sources return, **every result must be resolved to a YouTube video URL** before being sent to the frontend.

**Strategy:**
1. **YouTube Data API v3 first.** Use `youtube.search.list` with `q="<artist> <title>"`, `type=video`, `videoCategoryId=10` (Music), `maxResults=1`. Each call costs 100 quota units; the daily quota is 10,000 units.
2. **Scrape fallback.** When any of these are true:
   - The API returns 403 with `quotaExceeded` or `dailyLimitExceeded`,
   - The API key is missing,
   - The API call times out (>3s),
   ...fall back to scraping `https://www.youtube.com/results?search_query=<artist+title>` with Playwright. Extract the first `videoId` from the initial data blob (`ytInitialData`) — don't try to parse the rendered DOM, it changes constantly. Reuse the same Playwright browser instance used for Bandcamp scraping; don't spin up a new one per request.
3. **Quota tracking.** Maintain an in-memory counter of YouTube API units used today (reset at UTC midnight). Once the counter exceeds 9,500 (safety margin), short-circuit to scraping for the rest of the day. Persist the counter to SQLite so restarts don't reset it.
4. **Per-result YouTube cache.** Cache `(artist, title) → videoId` in SQLite indefinitely. Schema: `youtube_cache(artist_title_hash TEXT PRIMARY KEY, video_id TEXT, resolved_at INTEGER, method TEXT)`. Most queries will hit this cache, sparing both API quota and Playwright.
5. **Batching.** Run YouTube lookups with concurrency 5 (use `p-limit`). Don't fire 30 concurrent Playwright searches.
6. **Failure handling.** If both the API and scrape fail, set `youtubeVideoId: null` on the result. The frontend falls back to the source's `externalUrl` for those, visually marked.

### 4. Unified result schema

```ts
interface MusicResult {
  id: string;              // source-prefixed, e.g. "spotify:track:abc123"
  source: "spotify" | "deezer" | "itunes" | "musicbrainz" | "bandcamp";
  type: "track" | "album" | "artist";
  title: string;
  artist: string;
  album?: string;
  releaseYear?: number;
  artworkUrl?: string;
  externalUrl: string;
  durationMs?: number;

  youtubeVideoId: string | null;
  youtubeUrl: string | null;
  youtubeEmbedUrl: string | null;
  youtubeResolvedVia: "api" | "scrape" | "cache" | null;
}
```

Artists resolve to the artist's top music video — same flow, just query `<artist> topic` or `<artist> official`.

### 5. Caching (SQLite)

**Query cache (whole-response):**
- Schema: `query_cache(query_hash TEXT PRIMARY KEY, query_text TEXT, results_json TEXT, created_at INTEGER)`
- TTL: 24 hours.
- Cache key = SHA-256 of normalized query.

**YouTube resolution cache (per artist+title):** described in 3.4 above. No TTL.

Add `GET /api/cache/stats` returning hit/miss counts plus today's YouTube quota usage.

### 6. Streaming responses (Server-Sent Events)
- Endpoint: `GET /api/search/stream?q=...`
- Two-phase streaming:
  - **Phase 1:** As each music source returns, push results without YouTube data. The client renders cards immediately with a "resolving..." state on the play button.
  - **Phase 2:** As each YouTube resolution completes, push a `youtube_resolved` event with `{ id, youtubeVideoId, youtubeUrl, youtubeEmbedUrl }`. The client patches the corresponding card in place.
- Final `done` event when everything settles.
- The non-streaming `POST /api/search` endpoint also exists; it waits for everything before responding.

### 7. Frontend UX
- Single-page app. Big search bar at top. Results grid below.
- As SSE events arrive, results appear progressively, grouped by source with a small badge.
- Each result card:
  - Artwork, title, artist, source badge.
  - **Default:** "▶ Play on YouTube" button as `<a target="_blank">` to `youtubeUrl`. Opens in new tab.
  - **Embed toggle (small icon):** lazy-mounts a YouTube iframe (`youtubeEmbedUrl`) in place of the artwork. `loading="lazy"`. Only one iframe mounts at a time per card; never mount on initial render.
  - If `youtubeVideoId` is null, show "Open on <source>" linking to `externalUrl` with a "couldn't find on YouTube" tooltip.
  - Spinner on the play button between Phase 1 and Phase 2 for that card.
- Loading skeletons before first results arrive.
- Source errors → small dismissible toast, never blocks rest.
- Empty state with example queries the user can click.
- Last 10 queries in `localStorage`.
- Clean Tailwind, dark mode by default. Readable and fast over fancy.

---

## Project structure

```
/
├── frontend/
│   ├── src/
│   │   ├── components/
│   │   │   ├── ResultCard.tsx
│   │   │   ├── YouTubeEmbed.tsx
│   │   │   └── SearchBar.tsx
│   │   ├── hooks/useSearchStream.ts
│   │   ├── lib/
│   │   └── App.tsx
│   ├── vite.config.ts
│   └── package.json
├── backend/
│   ├── src/
│   │   ├── sources/          # spotify.ts, deezer.ts, itunes.ts, musicbrainz.ts, bandcamp.ts
│   │   ├── youtube/
│   │   │   ├── api.ts
│   │   │   ├── scrape.ts
│   │   │   └── resolver.ts
│   │   ├── cache/
│   │   ├── routes/
│   │   ├── middleware/       # rate limit, validation, security headers
│   │   ├── lib/
│   │   ├── orchestrator.ts
│   │   └── index.ts
│   ├── Dockerfile
│   ├── render.yaml
│   ├── fly.toml
│   └── package.json
├── shared/
│   └── types.ts
├── .github/workflows/ci.yml  # lint + test on PR
├── .env.example
├── docker-compose.yml
├── README.md
├── pnpm-workspace.yaml
└── package.json
```

---

## Environment variables (`.env.example`)

```
SPOTIFY_CLIENT_ID=
SPOTIFY_CLIENT_SECRET=
YOUTUBE_API_KEY=
PORT=3001
NODE_ENV=development
CACHE_TTL_HOURS=24
YOUTUBE_DAILY_QUOTA=10000
YOUTUBE_QUOTA_SAFETY_MARGIN=500
USER_AGENT=MusicSearchApp/1.0 (your-email@example.com)
FRONTEND_URL=http://localhost:5173
ALLOWED_ORIGINS=http://localhost:5173
RATE_LIMIT_WINDOW_MS=60000
RATE_LIMIT_MAX_REQUESTS=30
```

YouTube API key is optional — without it, the app falls through to scraping immediately.

---

## Build phases & sub-agents

You will work in **five phases**. Phases 2–4 are dedicated sub-agent passes — spawn a fresh sub-agent for each, give it only the context it needs, and have it produce a written report (committed to `/docs/audits/<phase>.md`) before applying fixes. Sub-agents work in isolation; the main agent applies their recommendations.

### Phase 1 — Build (main agent)
1. Initialize the monorepo (pnpm workspaces, root package.json, shared types).
2. Scaffold backend: Express server, TypeScript strict mode, SQLite wrapper (both schemas), route stubs.
3. Implement music source modules in this order: Deezer → iTunes → MusicBrainz → Spotify → Bandcamp (Playwright).
4. Implement the YouTube resolver: API client + quota tracker, scrape fallback (shared Playwright browser), cache layer.
5. Implement orchestrator: parallel fan-out, then YouTube enrichment with `p-limit(5)`.
6. SSE streaming endpoint with two-phase events.
7. Scaffold frontend: Vite + React + Tailwind.
8. Build search UI: SSE consumption, lazy YouTube embed, patch-in-place behavior.
9. Run lint + tests + smoke test (`curl` the search endpoint, confirm results from ≥3 sources with YouTube links).

### Phase 2 — Performance sub-agent
Spawn a sub-agent with a focused brief: **"Audit and optimize this app for performance. Output `/docs/audits/performance.md` listing every issue found with severity (critical/high/medium/low), then implement fixes for critical and high."**

The sub-agent must check at minimum:
- **Backend hot path:** Are music sources truly running in parallel (not awaited sequentially in a loop)? Is `p-limit(5)` actually limiting? Is the Playwright browser being reused or relaunched per request?
- **SQLite:** Is `better-sqlite3` opened with `WAL` mode and `synchronous=NORMAL`? Are prepared statements reused, not recompiled per call? Are there indexes on `query_hash` and `artist_title_hash`?
- **Cache effectiveness:** Add logging to confirm cache hit ratios. A repeat query must round-trip in <100ms end-to-end.
- **HTTP timeouts:** Every external call has an `AbortController` with the right timeout (5s API, 3s YouTube API, 10s Playwright).
- **SSE:** Is the response flushed after each event, not buffered? Is `Cache-Control: no-cache, X-Accel-Buffering: no` set?
- **Frontend bundle:** Run `vite build` and check the output. Are dependencies tree-shaken? Is the bundle under 200KB gzipped (excluding the React runtime)? Is Tailwind purging unused classes?
- **Frontend rendering:** Are result cards memoized (`React.memo` + stable keys)? Does scrolling 100 results stay at 60fps? Are iframes truly only mounted on click?
- **Image loading:** Artwork uses `loading="lazy"` and `decoding="async"`. Add `width`/`height` attributes to prevent layout shift.
- **Compression:** Is `compression` middleware enabled on Express?

### Phase 3 — Security sub-agent
Spawn a sub-agent with: **"Audit this app for security vulnerabilities. Output `/docs/audits/security.md` with findings and severity, then implement fixes for critical and high. Assume hostile users."**

Required checks:
- **Input validation:** Every endpoint validates inputs with `zod`. Query length capped (e.g. 200 chars). Reject control chars, null bytes, suspicious unicode.
- **Rate limiting:** `express-rate-limit` on `/api/search` and `/api/search/stream`. Default 30 req/min per IP. Configurable via env.
- **CORS:** Locked to `ALLOWED_ORIGINS`. No wildcard in production.
- **Security headers:** `helmet` configured. Strict CSP — no `unsafe-inline`, `unsafe-eval`. Allow only necessary YouTube embed origins (`https://www.youtube.com`, `https://www.youtube-nocookie.com`).
- **Secrets:** No API keys in client bundle, ever. Verify by grepping the built `frontend/dist` for any env var values.
- **Playwright sandbox:** Browser launches with `--no-sandbox` only inside Docker, never on a developer machine. Page contexts are always closed in `finally`.
- **SSRF:** All scraping URLs are constructed from a fixed base + URL-encoded query params. No user input concatenated into URLs without encoding.
- **SQL injection:** `better-sqlite3` parameterized queries only. No string interpolation into SQL anywhere — grep the codebase to confirm.
- **YouTube embed XSS:** Video IDs validated against `/^[a-zA-Z0-9_-]{11}$/` before being inserted into iframe URLs.
- **Logging:** No API keys, query strings with PII, or tokens in logs. Use a redacting logger (`pino` with redact paths).
- **Error responses:** Stack traces never leak to clients in production. Generic 500s only.
- **Dependency audit:** Run `pnpm audit`. Fix critical/high. Document any unfixable transitive issues.

### Phase 4 — Validation & verification sub-agent
Spawn a sub-agent with: **"Verify the app behaves correctly under happy-path, edge-case, and failure conditions. Output `/docs/audits/validation.md` with the test plan, results, and any bugs found. Add Vitest tests for everything found."**

Required scenarios:
- **Happy path:** "radiohead" returns ≥3 sources, all with YouTube links, in <2s.
- **Empty/garbage query:** Empty string, single space, 10,000-char string, emoji-only, SQL injection attempt — all handled gracefully (validation rejects or returns empty results).
- **Source failure isolation:** Kill Spotify (bad credentials), confirm other sources still return.
- **YouTube key absent:** Remove `YOUTUBE_API_KEY`, confirm scrape fallback kicks in immediately.
- **YouTube quota exhausted:** Manually set quota counter to 9,600 in SQLite, confirm next request scrapes.
- **YouTube total failure:** Block YouTube domain in Playwright, confirm cards render with `externalUrl` fallback and "couldn't find on YouTube" tooltip.
- **Cache correctness:** Same query twice within TTL → second is <100ms. Different query that shares tracks → YouTube cache hits even when query cache misses.
- **SSE reconnect:** Disconnect mid-stream, reconnect — no duplicate cards, no stale "resolving" spinners.
- **Concurrent requests:** Fire 20 simultaneous searches. No crashes, rate limiter kicks in correctly, Playwright browser doesn't deadlock.
- **Cold start:** Restart backend. First request still works. SQLite reopens cleanly. Quota counter survives.

### Phase 5 — Deployment (main agent)

You handle deployment yourself. I will provide the GitHub repo URL and credentials for any service you don't already have access to.

**Deploy backend to Render:**
1. Render CLI is not assumed; use the Render API directly. I'll provide a `RENDER_API_KEY` when you ask — pause once with `> **ACTION REQUIRED**` listing it alongside any other secrets you need.
2. Create a new Web Service via API. Type: `web`, env: `docker`, plan: `free`, region: closest to me (Singapore for South Asia).
3. Set env vars on the service via API: all values from `.env.example` except dev-only ones, plus the production `FRONTEND_URL` (you'll know this after Vercel deploy — do backend first with a placeholder, update after).
4. Trigger a deploy and poll the deploy status until it's `live` or `build_failed`. On failure, fetch logs, fix, redeploy.
5. Verify with a `curl` against `<render-url>/api/cache/stats`.

**Deploy frontend to Vercel:**
1. Vercel CLI is authenticated. From `/frontend`, run `vercel --prod` non-interactively (use flags / `vercel.json` to avoid prompts).
2. Set env var `VITE_API_BASE_URL` to the Render URL via `vercel env add` before the prod deploy.
3. Confirm the deployment URL responds with the SPA shell.

**Connect them:**
1. Update Render's `ALLOWED_ORIGINS` and `FRONTEND_URL` env vars to the Vercel production URL via the Render API.
2. Trigger a backend redeploy so the new env values take effect.
3. Run an end-to-end smoke test: `curl` the Vercel URL, then hit `<vercel-url>` in a Playwright check that performs an actual search and asserts at least one result card with a YouTube link renders.
4. Document the live URLs at the top of `README.md`.

**If anything fails during deployment:** debug it. Check logs via the Render API. Re-run `vercel inspect`. Don't hand it back to me half-deployed unless you've genuinely exhausted what you can do without my input.

---

## Code quality requirements

- Strict TypeScript everywhere. No `any` unless commented and justified.
- Each music source: `async function search(query: string, signal: AbortSignal): Promise<MusicResult[]>`.
- YouTube resolver: `async function resolve(artist: string, title: string, signal: AbortSignal): Promise<YouTubeResolution>`.
- Every external HTTP call uses `AbortController` with the right timeout.
- Source-level errors caught and logged, never thrown out — orchestrator always gets an array.
- ESLint + Prettier configured. Pre-commit hook with `lint-staged` + `husky`.
- Vitest tests for: query normalization, cache key hashing, YouTube quota tracker boundaries, YouTube cache hit/miss, zod input schemas. Plus whatever the validation sub-agent adds.
- GitHub Actions CI: lint + typecheck + test on every push.

---

## Local dev

`pnpm dev` from root: backend on `:3001`, frontend on `:5173` with API proxy. Use `concurrently` or `turbo`.
`docker-compose up` runs the whole thing in containers.

---

## Definition of done

- App is **deployed and live** on Vercel (frontend) and Render (backend), wired together.
- All three audit reports exist in `/docs/audits/` with critical and high issues fixed.
- A query like "radiohead" on the live site returns results from ≥3 sources within ~2 seconds, each with a working YouTube link.
- Live site: clicking "Play on YouTube" opens YouTube; clicking embed toggle plays inline.
- YouTube API key disabled → scraping kicks in cleanly with no user-facing errors.
- Repeat query within 24h returns in <100ms.
- Lint, typecheck, and all tests pass in CI.
- README has live URLs, local setup, env var reference, and a "How it works" architecture diagram (ASCII or Mermaid).

Now build, harden, and ship it. Don't ask clarifying questions unless something is genuinely blocking — for any small decision, just make a reasonable call and note it in the README.
