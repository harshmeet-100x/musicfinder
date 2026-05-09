import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

let tmpDir: string;
let originalDbPath: string | undefined;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'mf-int-'));
  originalDbPath = process.env.DB_PATH;
  process.env.DB_PATH = join(tmpDir, 'i.sqlite');
  vi.resetModules();
});

afterEach(() => {
  if (originalDbPath !== undefined) process.env.DB_PATH = originalDbPath;
  else delete process.env.DB_PATH;
  rmSync(tmpDir, { recursive: true, force: true });
});

/**
 * Source-failure isolation: each source returns an array, never throws.
 * If a single source's `fn` rejects, the orchestrator must still settle the
 * others. We simulate this by mocking each source factory.
 */
describe('orchestrator: source failure isolation', () => {
  it('a thrown source does not break the rest', async () => {
    vi.doMock('../../src/sources/spotify.js', () => ({
      searchSpotify: () => Promise.reject(new Error('spotify boom')),
    }));
    vi.doMock('../../src/sources/deezer.js', () => ({
      searchDeezer: () => Promise.resolve({ results: [] }),
    }));
    vi.doMock('../../src/sources/itunes.js', () => ({
      searchItunes: () =>
        Promise.resolve({
          results: [
            {
              id: 'itunes:track:1',
              source: 'itunes' as const,
              type: 'track' as const,
              title: 'Test',
              artist: 'Tester',
              externalUrl: 'https://example.com/1',
            },
          ],
        }),
    }));
    vi.doMock('../../src/sources/musicbrainz.js', () => ({
      searchMusicBrainz: () => Promise.resolve({ results: [] }),
    }));
    vi.doMock('../../src/sources/bandcamp.js', () => ({
      searchBandcamp: () => Promise.resolve({ results: [] }),
    }));
    // Stub the YouTube resolver so we don't actually call out
    vi.doMock('../../src/youtube/resolver.js', () => ({
      resolveYouTube: () =>
        Promise.resolve({ videoId: null, url: null, embedUrl: null, via: null }),
    }));

    const { streamSearchAndEnrich } = await import('../../src/orchestrator.js');
    const errors: string[] = [];
    const ac = new AbortController();
    const out = await streamSearchAndEnrich('test', ac.signal, {
      onSource: (b) => {
        if (b.error) errors.push(b.source);
      },
      onResolved: () => undefined,
    });
    expect(out).toHaveLength(1);
    expect(out[0]?.source).toBe('itunes');
    expect(errors).toContain('spotify');
  });
});
