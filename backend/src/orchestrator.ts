import pLimit from 'p-limit';
import type { MusicResult, MusicSource } from '@music-finder/shared';
import { searchDeezer } from './sources/deezer.js';
import { searchItunes } from './sources/itunes.js';
import { searchMusicBrainz } from './sources/musicbrainz.js';
import { searchSpotify } from './sources/spotify.js';
import { searchBandcamp } from './sources/bandcamp.js';
import { resolveYouTube } from './youtube/resolver.js';
import { logger } from './lib/logger.js';
import type { RawMusicResult, SourceFn } from './sources/types.js';

const API_SOURCES: { name: MusicSource; fn: SourceFn }[] = [
  { name: 'deezer', fn: searchDeezer },
  { name: 'itunes', fn: searchItunes },
  { name: 'musicbrainz', fn: searchMusicBrainz },
  { name: 'spotify', fn: searchSpotify },
];

const BANDCAMP_TRIGGER_THRESHOLD = 5;
const YT_CONCURRENCY = 5;

export interface SourceResultBatch {
  source: MusicSource;
  results: RawMusicResult[];
  error?: string;
}

/**
 * Run all API sources in parallel, then optionally Bandcamp if total < threshold.
 * Calls `onSource` as each source's batch settles so callers can stream events.
 *
 * Note: Bandcamp is only invoked once API sources have all settled (so we know
 * whether the threshold was met). Call sites that want concurrent enrichment
 * should use `streamSearchAndEnrich` instead, which starts YouTube enrichment
 * for each source as it arrives without blocking on Bandcamp.
 */
export async function fanOutSources(
  query: string,
  signal: AbortSignal,
  onSource: (batch: SourceResultBatch) => void,
): Promise<RawMusicResult[]> {
  const all: RawMusicResult[] = [];

  const apiTasks = API_SOURCES.map(async ({ name, fn }) => {
    const r = await fn(query, signal).catch((err) => {
      logger.warn({ source: name, err: String(err) }, 'source threw unexpectedly');
      return { results: [], error: String(err) };
    });
    onSource({ source: name, results: r.results, error: r.error });
    return { name, ...r };
  });

  const settled = await Promise.allSettled(apiTasks);
  for (const s of settled) {
    if (s.status === 'fulfilled') all.push(...s.value.results);
  }

  if (all.length < BANDCAMP_TRIGGER_THRESHOLD && !signal.aborted) {
    const r = await searchBandcamp(query, signal).catch((err) => ({
      results: [] as RawMusicResult[],
      error: String(err),
    }));
    onSource({ source: 'bandcamp', results: r.results, error: r.error });
    all.push(...r.results);
  }

  return all;
}

/**
 * Resolve YouTube for each result with concurrency `YT_CONCURRENCY`.
 * Calls `onResolved` as each result completes so callers can stream events.
 */
export async function enrichWithYouTube(
  raw: RawMusicResult[],
  signal: AbortSignal,
  onResolved: (r: MusicResult) => void,
): Promise<MusicResult[]> {
  const limit = pLimit(YT_CONCURRENCY);
  const tasks = raw.map((item) =>
    limit(async () => {
      const yt = await resolveYouTube(item.artist, item.title, signal).catch(() => ({
        videoId: null,
        url: null,
        embedUrl: null,
        via: null,
      }));
      const enriched: MusicResult = {
        ...item,
        youtubeVideoId: yt.videoId,
        youtubeUrl: yt.url,
        youtubeEmbedUrl: yt.embedUrl,
        youtubeResolvedVia: yt.via,
      };
      onResolved(enriched);
      return enriched;
    }),
  );
  return Promise.all(tasks);
}

/**
 * Streaming pipeline: fans out music sources AND starts YouTube enrichment per
 * result the moment its source arrives. Bandcamp scrape (if triggered) is
 * scheduled in parallel with enrichment of earlier-arriving API results, so the
 * user sees enriched cards as fast as possible.
 *
 * Returns the final fully-enriched result list once everything settles.
 */
export async function streamSearchAndEnrich(
  query: string,
  signal: AbortSignal,
  callbacks: {
    onSource: (batch: SourceResultBatch) => void;
    onResolved: (r: MusicResult) => void;
  },
): Promise<MusicResult[]> {
  const limit = pLimit(YT_CONCURRENCY);
  const enriched: MusicResult[] = [];
  const enrichmentTasks: Promise<void>[] = [];

  // Helper that schedules YouTube enrichment for a batch of raw results.
  // Each enrichment is independent and runs under the shared p-limit gate.
  const scheduleEnrichment = (raws: RawMusicResult[]) => {
    for (const item of raws) {
      enrichmentTasks.push(
        limit(async () => {
          const yt = await resolveYouTube(item.artist, item.title, signal).catch(() => ({
            videoId: null,
            url: null,
            embedUrl: null,
            via: null,
          }));
          const out: MusicResult = {
            ...item,
            youtubeVideoId: yt.videoId,
            youtubeUrl: yt.url,
            youtubeEmbedUrl: yt.embedUrl,
            youtubeResolvedVia: yt.via,
          };
          enriched.push(out);
          callbacks.onResolved(out);
        }),
      );
    }
  };

  // Fan out the API sources concurrently. As each one resolves, emit its batch
  // and immediately start enriching its results with YouTube.
  let apiTotal = 0;
  const apiPromises = API_SOURCES.map(async ({ name, fn }) => {
    const r = await fn(query, signal).catch((err) => {
      logger.warn({ source: name, err: String(err) }, 'source threw unexpectedly');
      return { results: [] as RawMusicResult[], error: String(err) };
    });
    callbacks.onSource({ source: name, results: r.results, error: r.error });
    apiTotal += r.results.length;
    if (r.results.length > 0) scheduleEnrichment(r.results);
  });

  await Promise.allSettled(apiPromises);

  if (apiTotal < BANDCAMP_TRIGGER_THRESHOLD && !signal.aborted) {
    const r = await searchBandcamp(query, signal).catch((err) => ({
      results: [] as RawMusicResult[],
      error: String(err),
    }));
    callbacks.onSource({ source: 'bandcamp', results: r.results, error: r.error });
    if (r.results.length > 0) scheduleEnrichment(r.results);
  }

  // Wait for all in-flight YouTube enrichments to complete before returning.
  await Promise.all(enrichmentTasks);
  return enriched;
}

export async function searchAll(
  query: string,
  signal: AbortSignal,
): Promise<MusicResult[]> {
  return streamSearchAndEnrich(query, signal, {
    onSource: () => undefined,
    onResolved: () => undefined,
  });
}
