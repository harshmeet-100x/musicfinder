import { config } from '../config.js';
import { fetchWithTimeout } from '../lib/fetch.js';
import { logger } from '../lib/logger.js';
import type { MusicSourceResult, RawMusicResult } from './types.js';

interface SpotifyTrack {
  id: string;
  name: string;
  external_urls: { spotify: string };
  duration_ms: number;
  album: {
    id: string;
    name: string;
    release_date?: string;
    images?: { url: string; height?: number; width?: number }[];
  };
  artists: { id: string; name: string }[];
}

interface SpotifySearchResponse {
  tracks?: { items: SpotifyTrack[] };
  error?: { status: number; message: string };
}

interface SpotifyTokenResponse {
  access_token: string;
  expires_in: number;
}

const TIMEOUT_MS = 5000;
const MAX_RESULTS = 8;

let cachedToken: { token: string; expiresAt: number } | null = null;

async function getAccessToken(signal: AbortSignal): Promise<string | null> {
  if (!config.spotifyClientId || !config.spotifyClientSecret) return null;
  if (cachedToken && cachedToken.expiresAt > Date.now() + 30_000) return cachedToken.token;

  const basic = Buffer.from(`${config.spotifyClientId}:${config.spotifyClientSecret}`).toString('base64');
  const res = await fetchWithTimeout('https://accounts.spotify.com/api/token', {
    method: 'POST',
    timeoutMs: TIMEOUT_MS,
    signal,
    headers: {
      authorization: `Basic ${basic}`,
      'content-type': 'application/x-www-form-urlencoded',
    },
    body: 'grant_type=client_credentials',
  });
  if (!res.ok) {
    logger.warn({ status: res.status }, 'spotify token request failed');
    return null;
  }
  const json = (await res.json()) as SpotifyTokenResponse;
  cachedToken = {
    token: json.access_token,
    expiresAt: Date.now() + json.expires_in * 1000,
  };
  return cachedToken.token;
}

export async function searchSpotify(
  query: string,
  signal: AbortSignal,
): Promise<MusicSourceResult> {
  try {
    const token = await getAccessToken(signal);
    if (!token) {
      return { results: [], error: 'spotify credentials missing or invalid' };
    }

    const url = new URL('https://api.spotify.com/v1/search');
    url.searchParams.set('q', query);
    url.searchParams.set('type', 'track');
    url.searchParams.set('limit', String(MAX_RESULTS));

    const res = await fetchWithTimeout(url.toString(), {
      method: 'GET',
      timeoutMs: TIMEOUT_MS,
      signal,
      headers: { authorization: `Bearer ${token}` },
    });
    if (res.status === 401) {
      cachedToken = null; // force refresh next time
      return { results: [], error: 'spotify 401' };
    }
    if (!res.ok) {
      return { results: [], error: `spotify http ${res.status}` };
    }
    const json = (await res.json()) as SpotifySearchResponse;
    if (json.error) return { results: [], error: `spotify: ${json.error.message}` };

    const items = json.tracks?.items ?? [];
    const results: RawMusicResult[] = items.slice(0, MAX_RESULTS).map((t) => {
      const artwork = t.album.images?.find((i) => (i.width ?? 0) >= 200) ?? t.album.images?.[0];
      return {
        id: `spotify:track:${t.id}`,
        source: 'spotify',
        type: 'track' as const,
        title: t.name,
        artist: t.artists.map((a) => a.name).join(', '),
        album: t.album.name,
        releaseYear: t.album.release_date ? Number(t.album.release_date.slice(0, 4)) || undefined : undefined,
        artworkUrl: artwork?.url,
        externalUrl: t.external_urls.spotify,
        durationMs: t.duration_ms,
      };
    });
    return { results };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.warn({ msg, query }, 'spotify search failed');
    return { results: [], error: `spotify: ${msg}` };
  }
}
