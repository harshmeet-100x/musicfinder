import { Router, type Request, type Response } from 'express';
import type { MusicResult, SearchResponse, SSEEvent } from '@music-finder/shared';
import { logger } from '../lib/logger.js';
import { normalizeQuery, queryHash } from '../lib/hash.js';
import { getCachedQuery, setCachedQuery } from '../cache/queryCache.js';
import { SearchQuerySchema, SearchStreamQuerySchema } from '../middleware/validation.js';
import { searchAll, streamSearchAndEnrich } from '../orchestrator.js';

export const searchRouter = Router();

/** Plain JSON search (waits for everything). */
searchRouter.post('/api/search', async (req: Request, res: Response) => {
  const parsed = SearchQuerySchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'invalid query', issues: parsed.error.issues });
  }

  const start = Date.now();
  const queryRaw = parsed.data.query;
  const queryNorm = normalizeQuery(queryRaw);
  if (!queryNorm) return res.status(400).json({ error: 'empty after normalization' });

  const hash = queryHash(queryNorm);

  const cached = getCachedQuery(hash);
  if (cached) {
    const body: SearchResponse = {
      query: queryNorm,
      results: cached,
      fromCache: true,
      elapsedMs: Date.now() - start,
    };
    res.set('X-Cache', 'HIT');
    return res.json(body);
  }
  res.set('X-Cache', 'MISS');

  const ac = new AbortController();
  req.on('close', () => ac.abort());

  const errors: { source: string; message: string }[] = [];
  const results = await searchAllWithErrors(queryNorm, ac.signal, errors);

  setCachedQuery(hash, queryNorm, results);

  const body: SearchResponse = {
    query: queryNorm,
    results,
    fromCache: false,
    elapsedMs: Date.now() - start,
    sourceErrors: errors.length
      ? (errors as SearchResponse['sourceErrors'])
      : undefined,
  };
  return res.json(body);
});

async function searchAllWithErrors(
  query: string,
  signal: AbortSignal,
  errors: { source: string; message: string }[],
): Promise<MusicResult[]> {
  return streamSearchAndEnrich(query, signal, {
    onSource: (batch) => {
      if (batch.error) errors.push({ source: batch.source, message: batch.error });
    },
    onResolved: () => undefined,
  });
}

// Re-export so existing imports/tests don't break if anyone was using it.
void searchAll;

/** Two-phase SSE stream. */
searchRouter.get('/api/search/stream', async (req: Request, res: Response) => {
  const parsed = SearchStreamQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    return res.status(400).json({ error: 'invalid query' });
  }
  const queryNorm = normalizeQuery(parsed.data.q);
  if (!queryNorm) return res.status(400).json({ error: 'empty after normalization' });

  res.set({
    'content-type': 'text/event-stream',
    // `no-transform` tells the `compression` middleware (and proxies) not to
    // buffer/compress this response — critical for SSE flush semantics.
    'cache-control': 'no-cache, no-transform',
    connection: 'keep-alive',
    'x-accel-buffering': 'no',
  });
  res.flushHeaders?.();

  const send = (event: SSEEvent) => {
    res.write(`event: ${event.type}\n`);
    res.write(`data: ${JSON.stringify(event)}\n\n`);
    // express compression's pass-through implements flush via `res.flush()`.
    // It's a no-op when compression skips this response (which it does for
    // `text/event-stream` + `no-transform`), but harmless either way.
    (res as unknown as { flush?: () => void }).flush?.();
  };

  const ac = new AbortController();
  req.on('close', () => ac.abort());

  const start = Date.now();
  const hash = queryHash(queryNorm);

  // Cache short-circuit: still stream so frontend code path is identical
  const cached = getCachedQuery(hash);
  if (cached) {
    const bySource = new Map<string, MusicResult[]>();
    for (const r of cached) {
      const arr = bySource.get(r.source) ?? [];
      arr.push(r);
      bySource.set(r.source, arr);
    }
    for (const [source, results] of bySource) {
      send({ type: 'source_results', source: source as MusicResult['source'], results });
    }
    for (const r of cached) {
      send({
        type: 'youtube_resolved',
        id: r.id,
        youtubeVideoId: r.youtubeVideoId,
        youtubeUrl: r.youtubeUrl,
        youtubeEmbedUrl: r.youtubeEmbedUrl,
        youtubeResolvedVia: r.youtubeResolvedVia,
      });
    }
    send({ type: 'done', elapsedMs: Date.now() - start, totalResults: cached.length });
    res.end();
    return;
  }

  // Use the streaming pipeline so YouTube enrichment for fast sources doesn't
  // wait for slow sources / bandcamp scrape to complete.
  const enriched = await streamSearchAndEnrich(queryNorm, ac.signal, {
    onSource: (batch) => {
      if (batch.error) {
        send({ type: 'source_error', source: batch.source, message: batch.error });
      } else {
        // Phase 1: stream results immediately, *without* youtube fields.
        const stub = batch.results.map(
          (r) =>
            ({
              ...r,
              youtubeVideoId: null,
              youtubeUrl: null,
              youtubeEmbedUrl: null,
              youtubeResolvedVia: null,
            }) satisfies MusicResult,
        );
        send({ type: 'source_results', source: batch.source, results: stub });
      }
    },
    onResolved: (r) => {
      send({
        type: 'youtube_resolved',
        id: r.id,
        youtubeVideoId: r.youtubeVideoId,
        youtubeUrl: r.youtubeUrl,
        youtubeEmbedUrl: r.youtubeEmbedUrl,
        youtubeResolvedVia: r.youtubeResolvedVia,
      });
    },
  });

  if (!ac.signal.aborted) {
    setCachedQuery(hash, queryNorm, enriched);
    send({ type: 'done', elapsedMs: Date.now() - start, totalResults: enriched.length });
  }
  logger.info(
    { queryNorm, count: enriched.length, ms: Date.now() - start },
    'sse search completed',
  );
  res.end();
});
