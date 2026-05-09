interface Props {
  onPick: (q: string) => void;
}

const EXAMPLES = [
  'chill lofi like Nujabes',
  '90s shoegaze deep cuts',
  'upbeat songs for running',
  'instrumental jazz to focus',
  'sad indie folk',
  'late-night drive synthwave',
];

export function EmptyState({ onPick }: Props) {
  return (
    <div className="rounded-2xl border border-dashed border-slate-800 bg-slate-900/40 p-8 text-center">
      <h2 className="text-lg font-semibold text-slate-200">Find music your way.</h2>
      <p className="mt-2 text-sm text-slate-400">
        Type a vibe, a genre, an artist — anything you'd say to a friend. Every result links to YouTube.
      </p>
      <div className="mt-6 flex flex-wrap justify-center gap-2">
        {EXAMPLES.map((ex) => (
          <button
            key={ex}
            type="button"
            onClick={() => onPick(ex)}
            className="rounded-full border border-slate-700 bg-slate-800/60 px-4 py-2 text-xs text-slate-200 transition-colors hover:border-accent hover:text-accent"
          >
            {ex}
          </button>
        ))}
      </div>
    </div>
  );
}
