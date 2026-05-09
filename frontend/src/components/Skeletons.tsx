export function CardSkeleton() {
  return (
    <div className="overflow-hidden rounded-xl border border-slate-800 bg-slate-900/70">
      <div className="skeleton aspect-square w-full" />
      <div className="space-y-2 p-3">
        <div className="skeleton h-3 w-3/4 rounded" />
        <div className="skeleton h-3 w-1/2 rounded" />
        <div className="skeleton mt-3 h-9 w-full rounded-lg" />
      </div>
    </div>
  );
}

export function GridSkeleton({ count = 8 }: { count?: number }) {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
      {Array.from({ length: count }).map((_, i) => (
        <CardSkeleton key={i} />
      ))}
    </div>
  );
}
