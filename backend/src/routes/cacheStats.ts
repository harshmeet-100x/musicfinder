import { Router } from 'express';
import type { CacheStats } from '@music-finder/shared';
import { readAllStats } from '../cache/stats.js';
import { getUnitsUsedToday, quotaResetAtUtc } from '../youtube/quota.js';

export const cacheStatsRouter = Router();

cacheStatsRouter.get('/api/cache/stats', (_req, res) => {
  const counts = readAllStats();
  const body: CacheStats = {
    queryCacheHits: counts.queryCacheHits,
    queryCacheMisses: counts.queryCacheMisses,
    youtubeCacheHits: counts.youtubeCacheHits,
    youtubeCacheMisses: counts.youtubeCacheMisses,
    youtubeApiCalls: counts.youtubeApiCalls,
    youtubeScrapes: counts.youtubeScrapes,
    youtubeQuotaUsedToday: getUnitsUsedToday(),
    youtubeQuotaResetAt: quotaResetAtUtc(),
  };
  res.json(body);
});
