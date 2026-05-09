const KEY = 'mf:recentQueries';
const MAX = 10;

export function getRecentQueries(): string[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed)
      ? parsed.filter((s): s is string => typeof s === 'string').slice(0, MAX)
      : [];
  } catch {
    return [];
  }
}

export function pushRecentQuery(q: string): string[] {
  const trimmed = q.trim();
  if (!trimmed) return getRecentQueries();
  const current = getRecentQueries().filter((x) => x.toLowerCase() !== trimmed.toLowerCase());
  const next = [trimmed, ...current].slice(0, MAX);
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    /* localStorage may be disabled */
  }
  return next;
}
