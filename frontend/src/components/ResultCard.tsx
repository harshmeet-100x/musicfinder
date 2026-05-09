import { memo, useState } from 'react';
import type { MusicResult, MusicSource } from '@music-finder/shared';
import { YouTubeEmbed } from './YouTubeEmbed';

interface Props {
  result: MusicResult;
}

const SOURCE_LABEL: Record<MusicSource, string> = {
  spotify: 'Spotify',
  deezer: 'Deezer',
  itunes: 'iTunes',
  musicbrainz: 'MusicBrainz',
  bandcamp: 'Bandcamp',
};

const SOURCE_COLOR: Record<MusicSource, string> = {
  spotify: 'bg-emerald-500/20 text-emerald-300',
  deezer: 'bg-fuchsia-500/20 text-fuchsia-300',
  itunes: 'bg-rose-500/20 text-rose-300',
  musicbrainz: 'bg-amber-500/20 text-amber-300',
  bandcamp: 'bg-sky-500/20 text-sky-300',
};

function formatDuration(ms?: number): string | null {
  if (!ms || ms < 0) return null;
  const sec = Math.floor(ms / 1000);
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

function ResultCardBase({ result }: Props) {
  const [showEmbed, setShowEmbed] = useState(false);

  const youtubePending = result.youtubeResolvedVia === null && result.youtubeVideoId === null;
  const youtubeMissing = result.youtubeResolvedVia !== null && result.youtubeVideoId === null;

  const duration = formatDuration(result.durationMs);

  return (
    <article className="group flex flex-col overflow-hidden rounded-xl border border-slate-800 bg-slate-900/70 shadow-lg transition-colors hover:border-slate-700">
      <div className="relative aspect-square w-full overflow-hidden bg-slate-800">
        {showEmbed && result.youtubeEmbedUrl ? (
          <YouTubeEmbed embedUrl={result.youtubeEmbedUrl} title={`${result.artist} — ${result.title}`} />
        ) : result.artworkUrl ? (
          <img
            src={result.artworkUrl}
            alt={`${result.album ?? result.title} artwork`}
            loading="lazy"
            decoding="async"
            width={300}
            height={300}
            className="h-full w-full object-cover"
            referrerPolicy="no-referrer"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-slate-600">
            <svg viewBox="0 0 24 24" className="h-16 w-16" fill="currentColor" aria-hidden>
              <path d="M9 17V5l12-2v12" stroke="currentColor" strokeWidth="2" fill="none" />
              <circle cx="6" cy="17" r="3" />
              <circle cx="18" cy="15" r="3" />
            </svg>
          </div>
        )}

        {result.youtubeEmbedUrl && (
          <button
            type="button"
            onClick={() => setShowEmbed((v) => !v)}
            className="absolute right-2 top-2 rounded-md bg-slate-950/70 px-2 py-1 text-xs text-slate-100 backdrop-blur transition-opacity opacity-0 group-hover:opacity-100 focus:opacity-100"
            aria-label={showEmbed ? 'Hide embed' : 'Show embed'}
          >
            {showEmbed ? '✕ close' : '▶ embed'}
          </button>
        )}
      </div>

      <div className="flex flex-1 flex-col gap-2 p-3">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <h3 className="truncate text-sm font-semibold text-slate-100" title={result.title}>
              {result.title}
            </h3>
            <p className="truncate text-xs text-slate-400" title={result.artist}>
              {result.artist}
            </p>
          </div>
          <span className={`shrink-0 rounded-md px-2 py-0.5 text-[10px] uppercase tracking-wide ${SOURCE_COLOR[result.source]}`}>
            {SOURCE_LABEL[result.source]}
          </span>
        </div>

        <div className="flex items-center justify-between text-[11px] text-slate-500">
          <span className="truncate" title={result.album ?? ''}>
            {result.album ?? ''}
          </span>
          <span>{duration}</span>
        </div>

        <div className="mt-auto pt-2">
          {youtubePending ? (
            <button
              disabled
              className="flex w-full items-center justify-center gap-2 rounded-lg bg-slate-800 px-3 py-2 text-sm text-slate-400"
            >
              <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-slate-500 border-t-transparent" />
              resolving YouTube…
            </button>
          ) : result.youtubeUrl ? (
            <a
              href={result.youtubeUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="block w-full rounded-lg bg-accent px-3 py-2 text-center text-sm font-medium text-slate-950 transition-opacity hover:opacity-90"
            >
              ▶ Play on YouTube
            </a>
          ) : (
            <a
              href={result.externalUrl}
              target="_blank"
              rel="noopener noreferrer"
              title="Couldn't find on YouTube — opening on the original source instead."
              className="block w-full rounded-lg border border-slate-700 px-3 py-2 text-center text-sm text-slate-300 hover:bg-slate-800"
            >
              Open on {SOURCE_LABEL[result.source]}
              {youtubeMissing ? ' ⚠' : ''}
            </a>
          )}
        </div>
      </div>
    </article>
  );
}

export const ResultCard = memo(ResultCardBase);
