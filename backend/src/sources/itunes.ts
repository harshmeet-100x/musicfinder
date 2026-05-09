import { fetchWithTimeout } from '../lib/fetch.js';
import { logger } from '../lib/logger.js';
import type { MusicSourceResult, RawMusicResult } from './types.js';

interface iTunesTrack {
  trackId?: number;
  collectionId?: number;
  artistId?: number;
  trackName?: string;
  collectionName?: string;
  artistName?: string;
  trackViewUrl?: string;
  collectionViewUrl?: string;
  artistViewUrl?: string;
  artworkUrl100?: string;
  artworkUrl60?: string;
  trackTimeMillis?: number;
  releaseDate?: string;
  wrapperType?: 'track' | 'collection' | 'artist';
  kind?: string;
}

interface iTunesResponse {
  resultCount: number;
  results: iTunesTrack[];
}

const TIMEOUT_MS = 5000;
const MAX_RESULTS = 8;

export async function searchItunes(
  query: string,
  signal: AbortSignal,
): Promise<MusicSourceResult> {
  const url = new URL('https://itunes.apple.com/search');
  url.searchParams.set('term', query);
  url.searchParams.set('media', 'music');
  url.searchParams.set('entity', 'song');
  url.searchParams.set('limit', String(MAX_RESULTS));

  try {
    const res = await fetchWithTimeout(url.toString(), { method: 'GET', timeoutMs: TIMEOUT_MS, signal });
    if (!res.ok) {
      return { results: [], error: `itunes http ${res.status}` };
    }
    const json = (await res.json()) as iTunesResponse;
    const tracks = json.results ?? [];

    const results: RawMusicResult[] = [];
    for (const t of tracks) {
      if (t.kind && t.kind !== 'song') continue;
      const id = t.trackId ?? t.collectionId ?? t.artistId;
      if (!id) continue;
      const title = t.trackName ?? t.collectionName ?? t.artistName ?? '';
      const artist = t.artistName ?? '';
      if (!title || !artist) continue;

      const cover = t.artworkUrl100?.replace('100x100', '300x300') ?? t.artworkUrl60;
      const releaseYear = t.releaseDate ? new Date(t.releaseDate).getUTCFullYear() : undefined;

      results.push({
        id: `itunes:track:${id}`,
        source: 'itunes',
        type: 'track',
        title,
        artist,
        album: t.collectionName,
        releaseYear,
        artworkUrl: cover,
        externalUrl: t.trackViewUrl ?? t.collectionViewUrl ?? t.artistViewUrl ?? '',
        durationMs: t.trackTimeMillis,
      });
      if (results.length >= MAX_RESULTS) break;
    }
    return { results };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.warn({ msg, query }, 'itunes search failed');
    return { results: [], error: `itunes: ${msg}` };
  }
}
