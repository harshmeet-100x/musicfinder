import { config } from '../config.js';
import { fetchWithTimeout } from '../lib/fetch.js';
import { logger } from '../lib/logger.js';
import { incrementStat } from '../cache/stats.js';
import { isValidVideoId } from '../middleware/validation.js';
import { recordSearchListCall, shouldUseScrape } from './quota.js';

const YOUTUBE_SEARCH_URL = 'https://www.googleapis.com/youtube/v3/search';

export interface YouTubeApiSearchResult {
  videoId: string | null;
  quotaExceeded: boolean;
  error?: string;
}

/**
 * Search YouTube via Data API v3. Costs 100 quota units per call.
 * Returns null videoId if no results or if the call should be retried via scrape.
 */
export async function youtubeApiSearch(
  query: string,
  signal: AbortSignal,
): Promise<YouTubeApiSearchResult> {
  if (!config.youtubeApiKey) {
    return { videoId: null, quotaExceeded: false, error: 'no api key' };
  }
  if (shouldUseScrape()) {
    return { videoId: null, quotaExceeded: true };
  }

  const url = new URL(YOUTUBE_SEARCH_URL);
  url.searchParams.set('part', 'snippet');
  url.searchParams.set('q', query);
  url.searchParams.set('type', 'video');
  url.searchParams.set('videoCategoryId', '10');
  url.searchParams.set('maxResults', '1');
  url.searchParams.set('key', config.youtubeApiKey);

  try {
    const res = await fetchWithTimeout(url.toString(), {
      method: 'GET',
      timeoutMs: 3000,
      signal,
    });

    recordSearchListCall();
    incrementStat('youtubeApiCalls');

    if (res.status === 403) {
      const body = (await res.json().catch(() => ({}))) as {
        error?: { errors?: { reason?: string }[] };
      };
      const reason = body?.error?.errors?.[0]?.reason ?? '';
      if (reason === 'quotaExceeded' || reason === 'dailyLimitExceeded') {
        logger.warn({ reason }, 'youtube api quota exceeded; switching to scrape');
        return { videoId: null, quotaExceeded: true };
      }
      return { videoId: null, quotaExceeded: false, error: `403 ${reason}` };
    }

    if (!res.ok) {
      return { videoId: null, quotaExceeded: false, error: `http ${res.status}` };
    }

    const json = (await res.json()) as {
      items?: { id?: { videoId?: string } }[];
    };
    const videoId = json.items?.[0]?.id?.videoId ?? null;

    if (videoId && !isValidVideoId(videoId)) {
      logger.warn({ videoId }, 'youtube api returned invalid videoId');
      return { videoId: null, quotaExceeded: false, error: 'invalid videoId' };
    }

    return { videoId, quotaExceeded: false };
  } catch (err) {
    return {
      videoId: null,
      quotaExceeded: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
