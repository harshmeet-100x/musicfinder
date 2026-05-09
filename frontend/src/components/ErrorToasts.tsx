import type { SourceError } from '../hooks/useSearchStream';

interface Props {
  errors: SourceError[];
  onDismiss: (idx: number) => void;
}

export function ErrorToasts({ errors, onDismiss }: Props) {
  if (errors.length === 0) return null;
  return (
    <div className="pointer-events-none fixed bottom-6 right-6 z-50 flex w-80 max-w-full flex-col gap-2">
      {errors.map((e, i) => (
        <div
          key={`${e.ts}-${e.source}`}
          className="pointer-events-auto rounded-lg border border-amber-500/40 bg-amber-950/90 p-3 text-xs text-amber-100 shadow-2xl backdrop-blur"
        >
          <div className="flex items-start justify-between gap-2">
            <div>
              <div className="font-semibold uppercase tracking-wide">{e.source} unavailable</div>
              <div className="mt-1 text-amber-200/80">{e.message}</div>
            </div>
            <button
              type="button"
              onClick={() => onDismiss(i)}
              className="text-amber-300 hover:text-white"
              aria-label="dismiss"
            >
              ✕
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
