/**
 * Bandcamp scrape fallback. Only invoked when API sources collectively return < 5 results.
 * Hits the public discover endpoint and parses inline JSON.
 */

import { withContext } from '../lib/browser.js';
import { logger } from '../lib/logger.js';
import type { MusicSourceResult, RawMusicResult } from './types.js';

const TIMEOUT_MS = 10_000;
const MAX_RESULTS = 6;

interface BandcampSearchResultItem {
  type?: string;
  url?: string;
  name?: string;
  band_name?: string;
  art_id?: number | string;
  album_name?: string;
}

export async function searchBandcamp(
  query: string,
  signal: AbortSignal,
): Promise<MusicSourceResult> {
  if (signal.aborted) return { results: [], error: 'aborted' };

  try {
    const url = `https://bandcamp.com/api/bcsearch_public_api/1/autocomplete_elastic`;
    const body = JSON.stringify({
      search_text: query,
      search_filter: 't', // tracks
      full_page: true,
      fan_id: null,
    });

    const result = await withContext(async (ctx) => {
      const racePromise = ctx.request.post(url, {
        timeout: TIMEOUT_MS,
        data: body,
        headers: { 'content-type': 'application/json' },
      });
      const abortPromise = new Promise<null>((resolve) => {
        const onAbort = () => resolve(null);
        if (signal.aborted) onAbort();
        else signal.addEventListener('abort', onAbort, { once: true });
      });
      return Promise.race([racePromise, abortPromise]);
    });

    if (!result) return { results: [], error: 'bandcamp aborted' };
    if (!result.ok()) return { results: [], error: `bandcamp http ${result.status()}` };

    const json = (await result.json().catch(() => ({}))) as {
      auto?: { results?: BandcampSearchResultItem[] };
    };
    const items = json.auto?.results ?? [];

    const results: RawMusicResult[] = [];
    for (const item of items) {
      if (item.type !== 't' || !item.url || !item.name) continue;
      const artwork = item.art_id
        ? `https://f4.bcbits.com/img/a${String(item.art_id).padStart(10, '0')}_5.jpg`
        : undefined;
      results.push({
        id: `bandcamp:track:${encodeURIComponent(item.url)}`,
        source: 'bandcamp',
        type: 'track',
        title: item.name,
        artist: item.band_name ?? 'Unknown',
        album: item.album_name,
        artworkUrl: artwork,
        externalUrl: item.url,
      });
      if (results.length >= MAX_RESULTS) break;
    }

    return { results };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.warn({ msg, query }, 'bandcamp scrape failed');
    return { results: [], error: `bandcamp: ${msg}` };
  }
}
