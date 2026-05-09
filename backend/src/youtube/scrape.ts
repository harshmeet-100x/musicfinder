/**
 * YouTube fallback scrape.
 *
 * We hit https://www.youtube.com/results?search_query=... and parse the
 * `ytInitialData` blob from the initial HTML response. This is far more stable
 * than the rendered DOM and it doesn't require evaluating any third-party JS.
 *
 * We deliberately use `request.fetch` (Playwright's http client) rather than
 * navigating with a page; it's faster, sandbox-safe, and less detection-prone.
 */

import type { BrowserContext } from 'playwright-core';
import { withContext } from '../lib/browser.js';
import { logger } from '../lib/logger.js';
import { incrementStat } from '../cache/stats.js';
import { isValidVideoId } from '../middleware/validation.js';

const VIDEO_ID_INIT_RE = /"videoId":"([a-zA-Z0-9_-]{11})"/;

async function scrapeWithContext(ctx: BrowserContext, query: string): Promise<string | null> {
  const url = `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`;
  const res = await ctx.request.get(url, { timeout: 10_000 });
  if (!res.ok()) {
    logger.debug({ status: res.status(), url }, 'youtube scrape non-ok');
    return null;
  }
  const html = await res.text();
  const match = VIDEO_ID_INIT_RE.exec(html);
  if (!match) return null;
  const id = match[1];
  if (!id || !isValidVideoId(id)) return null;
  return id;
}

export async function youtubeScrapeSearch(
  query: string,
  signal: AbortSignal,
): Promise<string | null> {
  if (signal.aborted) return null;
  incrementStat('youtubeScrapes');

  try {
    return await withContext(async (ctx) => {
      const racePromise = scrapeWithContext(ctx, query);
      const abortPromise = new Promise<null>((resolve) => {
        const onAbort = () => resolve(null);
        if (signal.aborted) onAbort();
        else signal.addEventListener('abort', onAbort, { once: true });
      });
      return Promise.race([racePromise, abortPromise]);
    });
  } catch (err) {
    logger.warn(
      { err: err instanceof Error ? err.message : String(err), query },
      'youtube scrape failed',
    );
    return null;
  }
}
