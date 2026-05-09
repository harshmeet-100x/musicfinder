import { fetchWithTimeout } from '../lib/fetch.js';
import { logger } from '../lib/logger.js';
import type { MusicSourceResult, RawMusicResult } from './types.js';

interface DeezerTrack {
  id: number;
  title: string;
  link: string;
  duration: number;
  artist: { id: number; name: string };
  album: { id: number; title: string; cover_medium?: string; cover_big?: string };
}

interface DeezerSearchResponse {
  data?: DeezerTrack[];
  error?: { message?: string };
}

const TIMEOUT_MS = 5000;
const MAX_RESULTS = 8;

export async function searchDeezer(
  query: string,
  signal: AbortSignal,
): Promise<MusicSourceResult> {
  const url = new URL('https://api.deezer.com/search');
  url.searchParams.set('q', query);
  url.searchParams.set('limit', String(MAX_RESULTS));

  try {
    const res = await fetchWithTimeout(url.toString(), { method: 'GET', timeoutMs: TIMEOUT_MS, signal });
    if (!res.ok) {
      return { results: [], error: `deezer http ${res.status}` };
    }
    const json = (await res.json()) as DeezerSearchResponse;
    if (json.error?.message) return { results: [], error: `deezer: ${json.error.message}` };

    const tracks = json.data ?? [];
    const results: RawMusicResult[] = tracks.slice(0, MAX_RESULTS).map((t) => ({
      id: `deezer:track:${t.id}`,
      source: 'deezer',
      type: 'track',
      title: t.title,
      artist: t.artist.name,
      album: t.album.title,
      artworkUrl: t.album.cover_big || t.album.cover_medium,
      externalUrl: t.link,
      durationMs: t.duration ? t.duration * 1000 : undefined,
    }));
    return { results };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.warn({ msg, query }, 'deezer search failed');
    return { results: [], error: `deezer: ${msg}` };
  }
}
