import { fetchWithTimeout } from '../lib/fetch.js';
import { logger } from '../lib/logger.js';
import { config } from '../config.js';
import type { MusicSourceResult, RawMusicResult } from './types.js';

interface MbRecording {
  id: string;
  title: string;
  length?: number;
  'first-release-date'?: string;
  'artist-credit'?: { name: string; artist?: { id?: string; name?: string } }[];
  releases?: { id: string; title: string }[];
}

interface MbResponse {
  recordings?: MbRecording[];
}

const TIMEOUT_MS = 5000;
const MAX_RESULTS = 6;

export async function searchMusicBrainz(
  query: string,
  signal: AbortSignal,
): Promise<MusicSourceResult> {
  const url = new URL('https://musicbrainz.org/ws/2/recording/');
  url.searchParams.set('query', query);
  url.searchParams.set('limit', String(MAX_RESULTS));
  url.searchParams.set('fmt', 'json');

  // MusicBrainz is occasionally flaky (TLS resets); allow one retry with backoff.
  async function attempt(): Promise<Response> {
    return fetchWithTimeout(url.toString(), {
      method: 'GET',
      timeoutMs: TIMEOUT_MS,
      signal,
      headers: { 'user-agent': config.userAgent, accept: 'application/json' },
    });
  }

  try {
    let res: Response;
    try {
      res = await attempt();
    } catch (err) {
      if (signal.aborted) throw err;
      await new Promise((r) => setTimeout(r, 250));
      res = await attempt();
    }
    if (!res.ok) {
      return { results: [], error: `musicbrainz http ${res.status}` };
    }
    const json = (await res.json()) as MbResponse;
    const recordings = json.recordings ?? [];

    const results: RawMusicResult[] = recordings.slice(0, MAX_RESULTS).map((r) => {
      const artist = r['artist-credit']?.[0]?.name ?? r['artist-credit']?.[0]?.artist?.name ?? 'Unknown';
      const releaseYear = r['first-release-date']?.slice(0, 4);
      return {
        id: `musicbrainz:recording:${r.id}`,
        source: 'musicbrainz',
        type: 'track' as const,
        title: r.title,
        artist,
        album: r.releases?.[0]?.title,
        releaseYear: releaseYear ? Number(releaseYear) || undefined : undefined,
        externalUrl: `https://musicbrainz.org/recording/${r.id}`,
        durationMs: r.length,
      };
    });
    return { results };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.warn({ msg, query }, 'musicbrainz search failed');
    return { results: [], error: `musicbrainz: ${msg}` };
  }
}
