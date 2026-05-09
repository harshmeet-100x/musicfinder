/**
 * Shared types between frontend and backend.
 */

export type MusicSource = 'spotify' | 'deezer' | 'itunes' | 'musicbrainz' | 'bandcamp';
export type ResultType = 'track' | 'album' | 'artist';
export type YouTubeResolveMethod = 'api' | 'scrape' | 'cache';

export interface MusicResult {
  id: string;
  source: MusicSource;
  type: ResultType;
  title: string;
  artist: string;
  album?: string;
  releaseYear?: number;
  artworkUrl?: string;
  externalUrl: string;
  durationMs?: number;

  youtubeVideoId: string | null;
  youtubeUrl: string | null;
  youtubeEmbedUrl: string | null;
  youtubeResolvedVia: YouTubeResolveMethod | null;
}

export interface SearchRequest {
  query: string;
}

export interface SearchResponse {
  query: string;
  results: MusicResult[];
  fromCache: boolean;
  elapsedMs: number;
  sourceErrors?: { source: MusicSource; message: string }[];
}

export interface CacheStats {
  queryCacheHits: number;
  queryCacheMisses: number;
  youtubeCacheHits: number;
  youtubeCacheMisses: number;
  youtubeApiCalls: number;
  youtubeScrapes: number;
  youtubeQuotaUsedToday: number;
  youtubeQuotaResetAt: string;
}

/* SSE event payloads */

export interface SSESourceResultsEvent {
  type: 'source_results';
  source: MusicSource;
  results: MusicResult[];
}

export interface SSESourceErrorEvent {
  type: 'source_error';
  source: MusicSource;
  message: string;
}

export interface SSEYouTubeResolvedEvent {
  type: 'youtube_resolved';
  id: string;
  youtubeVideoId: string | null;
  youtubeUrl: string | null;
  youtubeEmbedUrl: string | null;
  youtubeResolvedVia: YouTubeResolveMethod | null;
}

export interface SSEDoneEvent {
  type: 'done';
  elapsedMs: number;
  totalResults: number;
}

export type SSEEvent =
  | SSESourceResultsEvent
  | SSESourceErrorEvent
  | SSEYouTubeResolvedEvent
  | SSEDoneEvent;
