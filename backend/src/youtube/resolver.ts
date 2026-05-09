import type { YouTubeResolveMethod } from '@music-finder/shared';
import { artistTitleHash } from '../lib/hash.js';
import { getCachedYouTube, setCachedYouTube } from '../cache/youtubeCache.js';
import { isValidVideoId } from '../middleware/validation.js';
import { youtubeApiSearch } from './api.js';
import { youtubeScrapeSearch } from './scrape.js';
import { shouldUseScrape } from './quota.js';
import { logger } from '../lib/logger.js';

export interface YouTubeResolution {
  videoId: string | null;
  url: string | null;
  embedUrl: string | null;
  via: YouTubeResolveMethod | null;
}

function buildUrls(videoId: string | null): Pick<YouTubeResolution, 'url' | 'embedUrl'> {
  if (!videoId || !isValidVideoId(videoId)) {
    return { url: null, embedUrl: null };
  }
  return {
    url: `https://www.youtube.com/watch?v=${videoId}`,
    embedUrl: `https://www.youtube-nocookie.com/embed/${videoId}`,
  };
}

/**
 * Resolve `(artist, title)` to a YouTube video ID.
 * Order: cache → API (if quota+key allow) → scrape → null.
 */
export async function resolveYouTube(
  artist: string,
  title: string,
  signal: AbortSignal,
): Promise<YouTubeResolution> {
  const hash = artistTitleHash(artist, title);
  const cached = getCachedYouTube(hash);
  if (cached) {
    return { videoId: cached.videoId, ...buildUrls(cached.videoId), via: 'cache' };
  }

  const query = `${artist} ${title}`.trim();
  if (!query) return { videoId: null, url: null, embedUrl: null, via: null };

  if (!shouldUseScrape()) {
    const apiResult = await youtubeApiSearch(query, signal);
    if (apiResult.videoId) {
      setCachedYouTube(hash, apiResult.videoId, 'api');
      return { videoId: apiResult.videoId, ...buildUrls(apiResult.videoId), via: 'api' };
    }
    if (!apiResult.quotaExceeded && !apiResult.error) {
      // API genuinely returned nothing; cache the negative result so we don't keep retrying
      setCachedYouTube(hash, null, 'api');
      return { videoId: null, url: null, embedUrl: null, via: 'api' };
    }
    logger.debug({ err: apiResult.error, query }, 'youtube api miss; falling back to scrape');
  }

  const scrapedId = await youtubeScrapeSearch(query, signal);
  if (scrapedId) {
    setCachedYouTube(hash, scrapedId, 'scrape');
    return { videoId: scrapedId, ...buildUrls(scrapedId), via: 'scrape' };
  }

  // Don't cache scrape misses indefinitely — they're usually transient (network blip,
  // Chromium not yet warm, ratelimit). Negative API results *are* cached above because
  // those represent a genuine "YouTube has nothing" verdict.
  return { videoId: null, url: null, embedUrl: null, via: 'scrape' };
}
