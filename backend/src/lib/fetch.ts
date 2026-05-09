/**
 * Thin wrapper around `fetch` that:
 *  - applies an AbortSignal-based timeout
 *  - composes with an external signal so the caller can cancel
 *  - sets a friendly User-Agent
 */

import { config } from '../config.js';

export interface FetchOptions extends RequestInit {
  timeoutMs: number;
  signal?: AbortSignal;
}

export async function fetchWithTimeout(url: string, opts: FetchOptions): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(new Error(`timeout after ${opts.timeoutMs}ms`)), opts.timeoutMs);

  const onAbort = () => controller.abort(opts.signal?.reason ?? new Error('aborted'));
  if (opts.signal) {
    if (opts.signal.aborted) controller.abort(opts.signal.reason ?? new Error('aborted'));
    else opts.signal.addEventListener('abort', onAbort, { once: true });
  }

  try {
    const headers = new Headers(opts.headers);
    if (!headers.has('user-agent')) headers.set('user-agent', config.userAgent);

    return await fetch(url, { ...opts, headers, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
    if (opts.signal) opts.signal.removeEventListener('abort', onAbort);
  }
}
