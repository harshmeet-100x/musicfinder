import { memo, useMemo } from 'react';
import type { MusicResult, MusicSource } from '@music-finder/shared';
import { ResultCard } from './ResultCard';

interface Props {
  results: MusicResult[];
}

const SOURCE_ORDER: MusicSource[] = ['spotify', 'deezer', 'itunes', 'musicbrainz', 'bandcamp'];

const SOURCE_LABEL: Record<MusicSource, string> = {
  spotify: 'Spotify',
  deezer: 'Deezer',
  itunes: 'iTunes',
  musicbrainz: 'MusicBrainz',
  bandcamp: 'Bandcamp',
};

function ResultsGridBase({ results }: Props) {
  const groups = useMemo(() => {
    const byKey = new Map<MusicSource, MusicResult[]>();
    for (const r of results) {
      const list = byKey.get(r.source) ?? [];
      list.push(r);
      byKey.set(r.source, list);
    }
    return SOURCE_ORDER.flatMap((s) => {
      const list = byKey.get(s);
      return list && list.length > 0 ? [{ source: s, items: list }] : [];
    });
  }, [results]);

  if (groups.length === 0) return null;

  return (
    <div className="space-y-8">
      {groups.map((g) => (
        <section key={g.source}>
          <header className="mb-3 flex items-center gap-3 text-sm text-slate-400">
            <span className="text-slate-200">{SOURCE_LABEL[g.source]}</span>
            <span className="rounded-md bg-slate-800 px-2 py-0.5 text-[11px]">{g.items.length}</span>
          </header>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {g.items.map((r) => (
              <ResultCard key={r.id} result={r} />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

export const ResultsGrid = memo(ResultsGridBase);
