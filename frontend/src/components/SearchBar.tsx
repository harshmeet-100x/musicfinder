import { type FormEvent, type KeyboardEvent, useCallback, useEffect, useRef, useState } from 'react';
import { getRecentQueries } from '../lib/recentQueries';

interface Props {
  onSubmit: (q: string) => void;
  loading: boolean;
  initial?: string;
}

export function SearchBar({ onSubmit, loading, initial = '' }: Props) {
  const [value, setValue] = useState(initial);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [recents, setRecents] = useState<string[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setRecents(getRecentQueries());
  }, []);

  const refreshRecents = useCallback(() => setRecents(getRecentQueries()), []);

  const handleSubmit = (e?: FormEvent) => {
    e?.preventDefault();
    const trimmed = value.trim();
    if (!trimmed) return;
    onSubmit(trimmed);
    setShowSuggestions(false);
    refreshRecents();
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Escape') setShowSuggestions(false);
  };

  return (
    <form onSubmit={handleSubmit} className="relative w-full">
      <div className="flex items-center gap-2">
        <input
          ref={inputRef}
          type="text"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onFocus={() => setShowSuggestions(true)}
          onBlur={() => setTimeout(() => setShowSuggestions(false), 150)}
          onKeyDown={onKeyDown}
          placeholder="e.g. chill lofi like Nujabes, 90s shoegaze deep cuts, upbeat songs for running"
          maxLength={200}
          className="w-full rounded-xl border border-slate-700 bg-slate-900 px-4 py-3 text-base outline-none ring-accent/40 placeholder:text-slate-500 focus:border-accent focus:ring-2"
          aria-label="Search query"
          disabled={loading}
        />
        <button
          type="submit"
          disabled={loading || value.trim().length === 0}
          className="shrink-0 rounded-xl bg-accent px-5 py-3 font-medium text-slate-950 transition-opacity hover:opacity-90 disabled:opacity-50"
        >
          {loading ? 'Searching…' : 'Search'}
        </button>
      </div>

      {showSuggestions && recents.length > 0 && (
        <ul className="absolute left-0 right-0 z-10 mt-2 max-h-72 overflow-auto rounded-xl border border-slate-700 bg-slate-900 shadow-2xl">
          {recents.map((r) => (
            <li key={r}>
              <button
                type="button"
                onMouseDown={(e) => {
                  e.preventDefault();
                  setValue(r);
                  onSubmit(r);
                  setShowSuggestions(false);
                }}
                className="block w-full px-4 py-2 text-left text-sm text-slate-300 hover:bg-slate-800"
              >
                <span className="text-slate-500">↻</span> {r}
              </button>
            </li>
          ))}
        </ul>
      )}
    </form>
  );
}
