import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

let tmpDir: string;
let originalDbPath: string | undefined;
let originalTtl: string | undefined;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'mf-cache-'));
  originalDbPath = process.env.DB_PATH;
  originalTtl = process.env.CACHE_TTL_HOURS;
  process.env.DB_PATH = join(tmpDir, 'c.sqlite');
  process.env.CACHE_TTL_HOURS = '24';
  vi.resetModules();
});

afterEach(() => {
  if (originalDbPath !== undefined) process.env.DB_PATH = originalDbPath;
  else delete process.env.DB_PATH;
  if (originalTtl !== undefined) process.env.CACHE_TTL_HOURS = originalTtl;
  else delete process.env.CACHE_TTL_HOURS;
  rmSync(tmpDir, { recursive: true, force: true });
});

describe('query cache TTL', () => {
  it('returns the cached value within the TTL window', async () => {
    const { getCachedQuery, setCachedQuery } = await import('../../src/cache/queryCache.js');
    setCachedQuery('h1', 'foo', [
      {
        id: 'spotify:track:abc',
        source: 'spotify',
        type: 'track',
        title: 'X',
        artist: 'Y',
        externalUrl: 'https://example.com',
        youtubeVideoId: null,
        youtubeUrl: null,
        youtubeEmbedUrl: null,
        youtubeResolvedVia: null,
      },
    ]);
    const cached = getCachedQuery('h1');
    expect(cached).not.toBeNull();
    expect(cached?.[0]?.id).toBe('spotify:track:abc');
  });

  it('returns null for a missing entry and bumps the miss counter', async () => {
    const { getCachedQuery } = await import('../../src/cache/queryCache.js');
    const { readStat } = await import('../../src/cache/stats.js');
    expect(getCachedQuery('nope')).toBeNull();
    expect(readStat('queryCacheMisses')).toBe(1);
  });

  it('treats stale entries (created_at older than TTL) as a miss', async () => {
    const { getCachedQuery } = await import('../../src/cache/queryCache.js');
    const { getDb } = await import('../../src/cache/db.js');
    // Insert directly with an artificially-old created_at
    getDb()
      .prepare(
        'INSERT INTO query_cache (query_hash, query_text, results_json, created_at) VALUES (?, ?, ?, ?)',
      )
      .run('stale', 'old', '[]', Date.now() - 25 * 60 * 60 * 1000);
    expect(getCachedQuery('stale')).toBeNull();
  });
});
