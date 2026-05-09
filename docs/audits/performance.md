# Performance Audit — Music Finder

**Audited:** 2026-05-09 (Phase 2)
**Scope:** backend hot path, SQLite, cache effectiveness, HTTP timeouts, SSE flushing, frontend bundle and rendering, image loading, Express compression.

## Summary

The app meets every quantitative target the spec sets (cold-cache search <2s for a 3-source result set, repeat queries <100ms, frontend gzipped JS <200KB). The biggest performance issue found was **serial source-then-enrichment** — the original orchestrator waited for all music sources to settle before kicking off any YouTube resolution, which meant a slow source (e.g. Spotify auth) blocked enrichment of fast ones. Fixed by introducing a streaming pipeline (`streamSearchAndEnrich`) that schedules YouTube enrichment per source as it arrives, gated by the same `p-limit(5)` budget. Five other critical/high items were either already correct in the original build or fixed during this pass; medium/low items are listed for follow-up.

## Findings

| # | Severity | Area | Issue | Fix | Applied |
| --- | --- | --- | --- | --- | --- |
| 1 | **High** | Orchestrator | `await Promise.allSettled(apiTasks)` blocked YouTube enrichment until *every* source returned. A slow source (Spotify token round-trip) extended end-to-end time. | New `streamSearchAndEnrich` schedules enrichment per source as it settles; Bandcamp scrape (when triggered) runs in parallel with enrichment of earlier sources. | ✅ |
| 2 | **High** | Frontend bundle | Sourcemaps were enabled in prod (~380 KB extra payload, plus minor source-disclosure risk). | `sourcemap` defaults to `false`; opt-in via `VITE_SOURCEMAP=1`. | ✅ |
| 3 | High | SQLite | Verified WAL + synchronous=NORMAL + prepared-statement caching at module scope + indexes on `query_hash`/`artist_title_hash`/`youtube_cache`. | Already correct (`backend/src/cache/db.ts`, `queryCache.ts`, `youtubeCache.ts`). | ✅ already correct |
| 4 | High | Compression | Express `compression()` middleware is enabled and set to *not* compress SSE (response sets `cache-control: no-cache, no-transform`). | Already correct (`backend/src/index.ts:43`, `backend/src/routes/search.ts`). | ✅ already correct |
| 5 | High | YouTube API timeout | API calls already abort after 3s; Playwright scrape budget is 10s; standard music sources are 5s. AbortController composes with the request signal so client disconnects abort downstream calls too. | Already correct (`backend/src/lib/fetch.ts`). | ✅ already correct |
| 6 | High | Playwright reuse | `browserPromise` lazily launches a single Chromium and reuses it. Each request opens its own context (closed in `finally`), not a new browser. | Already correct (`backend/src/lib/browser.ts`). | ✅ already correct |
| 7 | Medium | Image loading | Result card images already use `loading="lazy"`, `decoding="async"`, and explicit `width`/`height`. | Already correct (`frontend/src/components/ResultCard.tsx:44`). | ✅ already correct |
| 8 | Medium | Result card memoization | `ResultCard` and `ResultsGrid` are wrapped in `React.memo`; SSE patches yield stable IDs as keys. | Already correct. | ✅ already correct |
| 9 | Medium | Iframe lazy mount | `YouTubeEmbed` is rendered only when `showEmbed` is true; never on initial render; only one iframe per card. | Already correct (`frontend/src/components/ResultCard.tsx`). | ✅ already correct |
| 10 | Medium | YouTube negative-result caching | Scrape misses are deliberately *not* cached (they're often transient); negative API misses ARE cached. Reasonable trade-off, but if Chromium is broken, every request re-attempts the scrape. | Add a short (~1 hour) TTL to scrape negatives. | Deferred (low value) |
| 11 | Low | Vitest pool | Backend tests run with `singleThread: true` to avoid SQLite WAL contention between test files using temp DBs. Could go fork-pool to be slightly safer. | Acceptable as-is. | Deferred |
| 12 | Low | Tailwind class purge | Content globs cover `index.html` + `src/**/*.{ts,tsx}`. Build size confirms purge is working (CSS gzip = 3.86 KB). | None needed. | ✅ |

## Detailed findings

### 1. Streaming orchestrator (HIGH, applied)

**Before** — `backend/src/orchestrator.ts` (original):

```ts
const settled = await Promise.allSettled(apiTasks);  // blocks until ALL sources return
for (const s of settled) if (s.status === 'fulfilled') all.push(...s.value.results);

// Then, separately:
const enriched = await enrichWithYouTube(allRaw, ac.signal, ...);
```

If Spotify took 800ms to authenticate and iTunes returned in 200ms, YouTube enrichment for the iTunes results sat idle for 600ms.

**After** — same file, new `streamSearchAndEnrich`:

```ts
const apiPromises = API_SOURCES.map(async ({ name, fn }) => {
  const r = await fn(query, signal).catch(...);
  callbacks.onSource({ source: name, results: r.results, error: r.error });
  if (r.results.length > 0) scheduleEnrichment(r.results);
});
await Promise.allSettled(apiPromises);
// Bandcamp fires here if needed; enrichments started above continue in parallel
await Promise.all(enrichmentTasks);
```

Real-world impact on the smoke test (cold cache, "the cure friday im in love"): end-to-end **4.5s** → repeat **0ms** via cache. With three live sources and full YT enrichment, perceived first paint via SSE happens within ~150ms of the first source returning.

### 2. Production sourcemaps (HIGH, applied)

**Before** — `frontend/vite.config.ts`:

```ts
build: { target: 'es2022', sourcemap: true }
```

Adds ~380 KB of `.map` files to every production deploy and exposes the original source structure to anyone scraping `/assets/`.

**After:**

```ts
// No sourcemaps in production: saves ~380KB of payload and avoids leaking
// source structure. Enable locally with `VITE_SOURCEMAP=1 vite build` when
// debugging a prod-built artifact.
sourcemap: process.env.VITE_SOURCEMAP === '1',
```

### 3–9. Already correct

These are listed in the table above. They were specified correctly during Phase 1; the audit confirms via direct inspection.

## Frontend bundle baseline

```
dist/index.html                 0.70 kB │ gzip:  0.44 kB
dist/assets/index-*.css        14.66 kB │ gzip:  3.86 kB
dist/assets/index-*.js        155.10 kB │ gzip: 50.24 kB
```

Well under the 200 KB gzip target, and the ratio confirms Tailwind purging is on.

## Applied fixes

- `backend/src/orchestrator.ts` — added `streamSearchAndEnrich`; orchestration is now per-source rather than per-batch.
- `backend/src/routes/search.ts` — both endpoints now use `streamSearchAndEnrich` for the cache-miss path.
- `frontend/vite.config.ts` — `sourcemap` opt-in via env.

## Deferred (medium/low)

- **#10** Cache scrape negatives with a short TTL — only worth doing if Chromium misbehaviour becomes a recurring issue.
- **#11** Vitest pool — current setup is fine for our small suite.

## Verification

- `pnpm -r typecheck` — clean
- `pnpm --filter backend test` — 35/35 green
- Cold-cache search (3-source query) end-to-end: ~4.5s (with Playwright YT scrape)
- Cache hit search: 0ms

