import { useCallback, useEffect, useRef, useState } from 'react';
import type { MusicResult, MusicSource, SSEEvent } from '@music-finder/shared';
import { API_BASE_URL } from '../lib/config';

export type SearchStatus = 'idle' | 'loading' | 'streaming' | 'done' | 'error';

export interface SourceError {
  source: MusicSource;
  message: string;
  ts: number;
}

export interface SearchStreamState {
  status: SearchStatus;
  query: string;
  results: MusicResult[];
  errors: SourceError[];
  elapsedMs: number | null;
}

const initial: SearchStreamState = {
  status: 'idle',
  query: '',
  results: [],
  errors: [],
  elapsedMs: null,
};

export function useSearchStream() {
  const [state, setState] = useState<SearchStreamState>(initial);
  const sourceRef = useRef<EventSource | null>(null);

  const cancel = useCallback(() => {
    sourceRef.current?.close();
    sourceRef.current = null;
  }, []);

  useEffect(() => () => cancel(), [cancel]);

  const search = useCallback(
    (query: string) => {
      cancel();
      const trimmed = query.trim();
      if (!trimmed) return;

      setState({
        status: 'loading',
        query: trimmed,
        results: [],
        errors: [],
        elapsedMs: null,
      });

      const url = `${API_BASE_URL}/api/search/stream?q=${encodeURIComponent(trimmed)}`;
      const es = new EventSource(url);
      sourceRef.current = es;

      const handle = (raw: MessageEvent<string>) => {
        let event: SSEEvent;
        try {
          event = JSON.parse(raw.data) as SSEEvent;
        } catch {
          return;
        }
        setState((prev) => {
          switch (event.type) {
            case 'source_results': {
              const merged = [...prev.results];
              const seen = new Set(merged.map((r) => r.id));
              for (const r of event.results) if (!seen.has(r.id)) merged.push(r);
              return { ...prev, status: 'streaming', results: merged };
            }
            case 'youtube_resolved': {
              const next = prev.results.map((r) =>
                r.id === event.id
                  ? {
                      ...r,
                      youtubeVideoId: event.youtubeVideoId,
                      youtubeUrl: event.youtubeUrl,
                      youtubeEmbedUrl: event.youtubeEmbedUrl,
                      youtubeResolvedVia: event.youtubeResolvedVia,
                    }
                  : r,
              );
              return { ...prev, results: next };
            }
            case 'source_error': {
              return {
                ...prev,
                errors: [...prev.errors, { source: event.source, message: event.message, ts: Date.now() }],
              };
            }
            case 'done': {
              es.close();
              sourceRef.current = null;
              return { ...prev, status: 'done', elapsedMs: event.elapsedMs };
            }
          }
          return prev;
        });
      };

      es.addEventListener('source_results', handle as EventListener);
      es.addEventListener('source_error', handle as EventListener);
      es.addEventListener('youtube_resolved', handle as EventListener);
      es.addEventListener('done', handle as EventListener);

      es.onerror = () => {
        setState((prev) =>
          prev.status === 'done' ? prev : { ...prev, status: 'error' },
        );
        es.close();
        sourceRef.current = null;
      };
    },
    [cancel],
  );

  const dismissError = useCallback((idx: number) => {
    setState((prev) => ({ ...prev, errors: prev.errors.filter((_, i) => i !== idx) }));
  }, []);

  return { state, search, cancel, dismissError };
}
