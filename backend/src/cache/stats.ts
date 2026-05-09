import { getDb } from './db.js';

type StatKey =
  | 'queryCacheHits'
  | 'queryCacheMisses'
  | 'youtubeCacheHits'
  | 'youtubeCacheMisses'
  | 'youtubeApiCalls'
  | 'youtubeScrapes';

import type { Statement } from 'better-sqlite3';

let _incStmt: Statement<[string]> | null = null;
let _readStmt: Statement<[string], { value: number }> | null = null;

function incStmt() {
  if (!_incStmt) {
    _incStmt = getDb().prepare<[string]>(
      `INSERT INTO stats (key, value) VALUES (?, 1)
       ON CONFLICT(key) DO UPDATE SET value = value + 1`,
    );
  }
  return _incStmt;
}
function readStmt() {
  if (!_readStmt) {
    _readStmt = getDb().prepare<[string], { value: number }>(
      `SELECT value FROM stats WHERE key = ?`,
    );
  }
  return _readStmt;
}

export function incrementStat(key: StatKey): void {
  incStmt().run(key);
}

export function readStat(key: StatKey): number {
  const row = readStmt().get(key);
  return row?.value ?? 0;
}

export function readAllStats(): Record<StatKey, number> {
  return {
    queryCacheHits: readStat('queryCacheHits'),
    queryCacheMisses: readStat('queryCacheMisses'),
    youtubeCacheHits: readStat('youtubeCacheHits'),
    youtubeCacheMisses: readStat('youtubeCacheMisses'),
    youtubeApiCalls: readStat('youtubeApiCalls'),
    youtubeScrapes: readStat('youtubeScrapes'),
  };
}
