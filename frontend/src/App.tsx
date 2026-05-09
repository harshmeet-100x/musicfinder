import { useCallback, useEffect } from 'react';
import { SearchBar } from './components/SearchBar';
import { ResultsGrid } from './components/ResultsGrid';
import { GridSkeleton } from './components/Skeletons';
import { EmptyState } from './components/EmptyState';
import { ErrorToasts } from './components/ErrorToasts';
import { useSearchStream } from './hooks/useSearchStream';
import { pushRecentQuery } from './lib/recentQueries';

export function App() {
  const { state, search, dismissError } = useSearchStream();

  const onSubmit = useCallback(
    (q: string) => {
      pushRecentQuery(q);
      search(q);
    },
    [search],
  );

  useEffect(() => {
    document.documentElement.classList.add('dark');
  }, []);

  const isLoading = state.status === 'loading';
  const isStreaming = state.status === 'streaming';
  const isDone = state.status === 'done';

  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-950 to-slate-900 text-slate-100">
      <div className="mx-auto flex max-w-6xl flex-col gap-8 px-4 py-8 sm:px-6 lg:px-8">
        <header className="flex flex-col items-start gap-3">
          <div className="flex items-center gap-3">
            <span aria-hidden className="text-3xl">🎧</span>
            <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">Music Finder</h1>
          </div>
          <p className="max-w-prose text-sm text-slate-400">
            Search Spotify, Deezer, iTunes, MusicBrainz and Bandcamp at once. Every track plays on YouTube.
          </p>
        </header>

        <SearchBar onSubmit={onSubmit} loading={isLoading} />

        <main className="flex flex-col gap-6">
          {state.status === 'idle' && <EmptyState onPick={onSubmit} />}

          {isLoading && <GridSkeleton />}

          {(isStreaming || isDone) && state.results.length === 0 && (
            <p className="text-sm text-slate-400">No results found for "{state.query}".</p>
          )}

          {state.results.length > 0 && <ResultsGrid results={state.results} />}

          {isDone && state.elapsedMs != null && (
            <p className="text-center text-xs text-slate-500">
              {state.results.length} result{state.results.length === 1 ? '' : 's'} in {(state.elapsedMs / 1000).toFixed(2)}s
            </p>
          )}

          {state.status === 'error' && (
            <p className="rounded-lg border border-rose-700/50 bg-rose-950/50 p-4 text-sm text-rose-200">
              Connection failed. Please try again.
            </p>
          )}
        </main>

        <footer className="mt-auto pt-12 text-center text-xs text-slate-500">
          Built with the Music Finder spec — open source.
        </footer>
      </div>

      <ErrorToasts errors={state.errors} onDismiss={dismissError} />
    </div>
  );
}
