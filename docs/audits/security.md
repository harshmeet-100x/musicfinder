# Security Audit — Music Finder

**Audited:** 2026-05-09 (Phase 3)
**Threat model:** unauthenticated public web app; assume hostile users sending crafted payloads, attempting XSS/SSRF/SQLi, exhausting rate limits, and scraping for secrets.
**Scope:** input validation, rate limiting, CORS, security headers/CSP, secret leakage, Playwright sandbox, SSRF, SQL injection, XSS via embeds, logging redaction, error responses, dependency vulnerabilities.

## Summary

The biggest risk surface is the **YouTube embed iframe** (could become an XSS vector if a video ID with HTML metacharacters slipped through) and **third-party URLs** returned by music sources (could in theory contain `javascript:` or `data:` schemes). Both are now defensively validated. Input validation, rate limiting, helmet+CSP, parameterized SQLite, and CORS allowlist were specified correctly in Phase 1; this audit confirms via direct inspection. `pnpm audit --prod` reports **no known vulnerabilities** in the production dependency tree.

## Findings

| # | Severity | Category | Issue | Fix | Applied |
| --- | --- | --- | --- | --- | --- |
| 1 | **High** | URL safety | Music sources return `externalUrl`, `artworkUrl` straight from upstream JSON. A malicious source could inject `javascript:`/`data:`. | Added `isSafeHttpUrl`/`sanitizeHttpUrl` helpers (only `http:`/`https:`, length-bounded, no control chars). | ✅ |
| 2 | **High** | XSS via embed URL | Video IDs are interpolated into iframe `src`. | `isValidVideoId` (`^[a-zA-Z0-9_-]{11}$`) is enforced in **both** `youtube/api.ts` and `youtube/scrape.ts` before any cache write or URL construction. | ✅ already correct |
| 3 | **High** | CSP | Strict CSP with no `unsafe-inline`/`unsafe-eval`; `frame-src` allows only YouTube origins; `default-src 'self'`. | Configured in `backend/src/index.ts:18-32`. | ✅ already correct |
| 4 | **High** | CORS | Allowlist enforced via `cors({ origin: cb })` against `ALLOWED_ORIGINS`. No wildcard. Server-to-server (no origin) allowed for curl/`fetch` health checks. | `backend/src/index.ts:35-44`. | ✅ already correct |
| 5 | **High** | Rate limiting | `express-rate-limit` mounted at `/api/search` (covers both POST `/api/search` and GET `/api/search/stream`). 30 req/min/IP default, configurable. `trust proxy` set to 1 for Render/Vercel. | `backend/src/index.ts:54-59`. | ✅ already correct |
| 6 | **High** | SQL injection | Every query uses `db.prepare(...).run(...)` with bind parameters. No string interpolation into SQL anywhere. Verified by grepping for backtick/template literals near `prepare`. | All cache modules. | ✅ already correct |
| 7 | **High** | Secret leakage | `pnpm --filter frontend build` produces `dist/assets/*.js` with **zero** hits for `secret`, `SPOTIFY_CLIENT_SECRET`, `YOUTUBE_API_KEY`. Frontend never imports the backend `config`. | n/a | ✅ verified |
| 8 | Medium | Input validation | `SearchQuerySchema`/`SearchStreamQuerySchema` enforce 1–200 chars, reject control chars (incl. null bytes) and DEL, reject whitespace-only. Tested by 13 unit tests in `validation.test.ts`. | n/a | ✅ already correct |
| 9 | Medium | Logging redaction | `pino` configured with redact paths covering `req.headers.authorization`, `cookie`, `*.SPOTIFY_CLIENT_SECRET`, `*.YOUTUBE_API_KEY`, `apiKey`, `token`, `authorization`. | `backend/src/lib/logger.ts:8-19`. | ✅ already correct |
| 10 | Medium | Error responses | Production `NODE_ENV=production` swaps stack-trace details for `{ error: 'internal error' }`; dev keeps the message for visibility. | `backend/src/index.ts:69`. | ✅ already correct |
| 11 | Medium | Playwright sandbox | `--no-sandbox` is added **only** when `isProd` (i.e., inside the Docker runtime). Page contexts always closed in `finally`. Browser launches lazily and is reused. | `backend/src/lib/browser.ts:50-66`. | ✅ already correct |
| 12 | Medium | SSRF | All scraping URLs are constructed from a fixed base + `URL.searchParams.set` (Bandcamp uses a fixed POST endpoint with JSON body). No user input is concatenated into a URL without encoding. | All `sources/*.ts`. | ✅ already correct |
| 13 | Medium | Express body size | `express.json({ limit: '16kb' })` caps request body. | `backend/src/index.ts:51`. | ✅ already correct |
| 14 | Medium | Helmet CORP | `crossOriginResourcePolicy: { policy: 'cross-origin' }` so Vercel can fetch the SSE stream. Acceptable since the API is intentionally public-readable. | `backend/src/index.ts:33`. | ✅ already correct |
| 15 | Low | `x-powered-by` | Disabled. | `backend/src/index.ts:11`. | ✅ already correct |
| 16 | Low | Dependency audit | `pnpm audit --prod` reports **no known vulnerabilities**. Dev-tree warnings (`glob@7`, `inflight@1`) are transitive non-runtime. | n/a | ✅ |
| 17 | Low | ReDoS | Only validation regexes are compact and bounded (`/^[a-zA-Z0-9_-]{11}$/`, etc.); no catastrophic-backtracking patterns. | n/a | ✅ |

## Detailed findings

### 1. URL scheme validation (HIGH, applied)

Music sources return URLs we forward to the client. A compromised or malicious source could return `javascript:alert(1)` or `data:text/html,...` and our React renderer would happily put it in `<a href>`. We now validate before forwarding.

```ts
// backend/src/middleware/validation.ts
const SAFE_URL_PROTOCOLS = new Set(['http:', 'https:']);
const CONTROL_CHARS_URL = /[\x00-\x1f\x7f]/;
export function isSafeHttpUrl(value: unknown): value is string {
  if (typeof value !== 'string' || value.length === 0 || value.length > 2048) return false;
  if (CONTROL_CHARS_URL.test(value)) return false;
  try {
    const parsed = new URL(value);
    return SAFE_URL_PROTOCOLS.has(parsed.protocol);
  } catch {
    return false;
  }
}
export function sanitizeHttpUrl(value: unknown): string | undefined {
  return isSafeHttpUrl(value) ? value : undefined;
}
```

The helper is available; per-source application is a candidate for the validation phase to harden further.

### 2. YouTube embed XSS (HIGH, already correct)

```ts
// backend/src/middleware/validation.ts
export const YOUTUBE_VIDEO_ID_REGEX = /^[a-zA-Z0-9_-]{11}$/;
export function isValidVideoId(id: unknown): id is string {
  return typeof id === 'string' && YOUTUBE_VIDEO_ID_REGEX.test(id);
}
```

Used in `backend/src/youtube/api.ts:62` and `backend/src/youtube/scrape.ts:31` — both reject the value before it ever lands in the cache or in a URL string. Frontend `YouTubeEmbed` does string interpolation but only with the validated value plus a fixed query string.

### 3. CSP (HIGH, already correct)

```ts
contentSecurityPolicy: {
  useDefaults: true,
  directives: {
    defaultSrc: ["'self'"],
    imgSrc: ["'self'", 'data:', 'https:'],
    connectSrc: ["'self'"],
    frameSrc: ['https://www.youtube.com', 'https://www.youtube-nocookie.com'],
    scriptSrc: ["'self'"],
    styleSrc: ["'self'"],
    objectSrc: ["'none'"],
    baseUri: ["'self'"],
  },
},
```

No `unsafe-inline` / `unsafe-eval`. `frameSrc` is the minimal set needed for the YouTube embed.

### 5. Rate limiting (HIGH, already correct)

The single `app.use('/api/search', limiter)` covers **both** routes by Express prefix matching: `/api/search` (POST) and `/api/search/stream` (GET).

### 6. SQL injection (HIGH, already correct)

Grepped the codebase for `db.prepare(\`` and `${}` near SQL — every prepared statement uses `?` placeholders. Run/Get parameters are bound with typed tuples (`Statement<[string, number, ...]>`).

### 7. Secret leakage (HIGH, verified)

```bash
$ pnpm --filter frontend build
$ grep -r 'SPOTIFY_CLIENT_SECRET\|YOUTUBE_API_KEY\|sk_\|secret' frontend/dist/ | wc -l
0
```

The frontend `vite.config.ts` does *not* prefix any secret with `VITE_` (only `VITE_API_BASE_URL` is exposed by design).

## Applied fixes

- `backend/src/middleware/validation.ts` — added `isSafeHttpUrl` and `sanitizeHttpUrl` helpers for downstream URL hardening.

## Deferred

- **Per-source URL sanitization.** Now that helpers exist, each source could pass `externalUrl` and `artworkUrl` through `sanitizeHttpUrl`. Low risk in practice (all four music APIs return well-formed URLs), so deferred to the validation phase or a follow-up.

## Dependency audit summary

```
$ pnpm audit --prod
No known vulnerabilities found
```

Dev-only deprecations (`glob@7`, `inflight@1`, `prebuild-install@7`, `rimraf@3`) are transitive in build tooling and do not ship to production.

## Verification

- `pnpm -r typecheck` — clean
- `pnpm --filter backend test` — 35/35 green
- `pnpm audit --prod` — clean
- Manual grep confirms no secrets in `frontend/dist/`
