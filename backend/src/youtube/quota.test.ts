import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

let tmpDir: string;
let originalDbPath: string | undefined;
let originalKey: string | undefined;
let originalQuota: string | undefined;
let originalMargin: string | undefined;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'mf-quota-'));
  originalDbPath = process.env.DB_PATH;
  originalKey = process.env.YOUTUBE_API_KEY;
  originalQuota = process.env.YOUTUBE_DAILY_QUOTA;
  originalMargin = process.env.YOUTUBE_QUOTA_SAFETY_MARGIN;
  process.env.DB_PATH = join(tmpDir, 'quota.sqlite');
  process.env.YOUTUBE_API_KEY = 'fake-key';
  process.env.YOUTUBE_DAILY_QUOTA = '10000';
  process.env.YOUTUBE_QUOTA_SAFETY_MARGIN = '500';
  vi.resetModules();
});

afterEach(() => {
  if (originalDbPath !== undefined) process.env.DB_PATH = originalDbPath;
  else delete process.env.DB_PATH;
  if (originalKey !== undefined) process.env.YOUTUBE_API_KEY = originalKey;
  else delete process.env.YOUTUBE_API_KEY;
  if (originalQuota !== undefined) process.env.YOUTUBE_DAILY_QUOTA = originalQuota;
  else delete process.env.YOUTUBE_DAILY_QUOTA;
  if (originalMargin !== undefined) process.env.YOUTUBE_QUOTA_SAFETY_MARGIN = originalMargin;
  else delete process.env.YOUTUBE_QUOTA_SAFETY_MARGIN;
  rmSync(tmpDir, { recursive: true, force: true });
});

describe('youtube quota tracker', () => {
  it('starts at 0 and reports headroom', async () => {
    const { getUnitsUsedToday, shouldUseScrape } = await import('./quota.js');
    expect(getUnitsUsedToday()).toBe(0);
    expect(shouldUseScrape()).toBe(false);
  });

  it('records 100 units per searchList call', async () => {
    const { getUnitsUsedToday, recordSearchListCall } = await import('./quota.js');
    recordSearchListCall();
    recordSearchListCall();
    expect(getUnitsUsedToday()).toBe(200);
  });

  it('forces scrape when within safety margin', async () => {
    const { recordSearchListCall, shouldUseScrape } = await import('./quota.js');
    // 95 calls = 9500 units. margin = 500, daily = 10000. shouldUseScrape true.
    for (let i = 0; i < 95; i++) recordSearchListCall();
    expect(shouldUseScrape()).toBe(true);
  });

  it('still allows api up to but not crossing the safety margin', async () => {
    const { recordSearchListCall, shouldUseScrape } = await import('./quota.js');
    for (let i = 0; i < 94; i++) recordSearchListCall();
    // 9400 + 100 = 9500. Daily 10000 - margin 500 = 9500, so 9500 <= 9500: just at the line.
    expect(shouldUseScrape()).toBe(false);
  });

  it('forces scrape when no api key is set', async () => {
    delete process.env.YOUTUBE_API_KEY;
    vi.resetModules();
    const { shouldUseScrape } = await import('./quota.js');
    expect(shouldUseScrape()).toBe(true);
  });
});
