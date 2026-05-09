import type { MusicResult } from '@music-finder/shared';

/**
 * The music sources return results WITHOUT YouTube enrichment.
 * The orchestrator fills in youtube* fields after sources return.
 */
export type RawMusicResult = Omit<
  MusicResult,
  'youtubeVideoId' | 'youtubeUrl' | 'youtubeEmbedUrl' | 'youtubeResolvedVia'
>;

export interface MusicSourceResult {
  results: RawMusicResult[];
  error?: string;
}

export type SourceFn = (query: string, signal: AbortSignal) => Promise<MusicSourceResult>;
