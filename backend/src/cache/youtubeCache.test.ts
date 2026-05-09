import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

let tmpDir: string;
let originalDbPath: string | undefined;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'mf-ytcache-'));
  originalDbPath = process.env.DB_PATH;
  process.env.DB_PATH = join(tmpDir, 'yt.sqlite');
  vi.resetModules();
});

afterEach(() => {
  if (originalDbPath !== undefined) process.env.DB_PATH = originalDbPath;
  else delete process.env.DB_PATH;
  rmSync(tmpDir, { recursive: true, force: true });
});

describe('youtubeCache', () => {
  it('returns null on miss and bumps miss counter', async () => {
    const { getCachedYouTube } = await import('./youtubeCache.js');
    const { readStat } = await import('./stats.js');
    expect(getCachedYouTube('abc')).toBeNull();
    expect(readStat('youtubeCacheMisses')).toBe(1);
  });

  it('round-trips a hit', async () => {
    const { getCachedYouTube, setCachedYouTube } = await import('./youtubeCache.js');
    setCachedYouTube('abc', 'dQw4w9WgXcQ', 'api');
    const hit = getCachedYouTube('abc');
    expect(hit?.videoId).toBe('dQw4w9WgXcQ');
    expect(hit?.method).toBe('api');
  });

  it('upserts on conflict', async () => {
    const { getCachedYouTube, setCachedYouTube } = await import('./youtubeCache.js');
    setCachedYouTube('abc', 'firstvideoxx', 'api');
    setCachedYouTube('abc', 'secondvidexx', 'scrape');
    const hit = getCachedYouTube('abc');
    expect(hit?.videoId).toBe('secondvidexx');
    expect(hit?.method).toBe('scrape');
  });

  it('caches null video ids (negative result)', async () => {
    const { getCachedYouTube, setCachedYouTube } = await import('./youtubeCache.js');
    setCachedYouTube('abc', null, 'api');
    const hit = getCachedYouTube('abc');
    expect(hit?.videoId).toBeNull();
    expect(hit?.method).toBe('api');
  });
});
