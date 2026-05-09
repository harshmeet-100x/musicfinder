import type { MusicResult } from '@music-finder/shared';
import { getDb } from './db.js';
import { config } from '../config.js';
import { incrementStat } from './stats.js';

interface QueryCacheRow {
  query_hash: string;
  query_text: string;
  results_json: string;
  created_at: number;
}

import type { Statement } from 'better-sqlite3';

let _selectStmt: Statement<[string], QueryCacheRow> | null = null;
let _upsertStmt: Statement<[string, string, string, number]> | null = null;
let _deleteStaleStmt: Statement<[number]> | null = null;

function selectStmt() {
  if (!_selectStmt) {
    _selectStmt = getDb().prepare<[string], QueryCacheRow>(
      `SELECT * FROM query_cache WHERE query_hash = ?`,
    );
  }
  return _selectStmt;
}
function upsertStmt() {
  if (!_upsertStmt) {
    _upsertStmt = getDb().prepare<[string, string, string, number]>(
      `INSERT INTO query_cache (query_hash, query_text, results_json, created_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(query_hash) DO UPDATE SET
         query_text=excluded.query_text,
         results_json=excluded.results_json,
         created_at=excluded.created_at`,
    );
  }
  return _upsertStmt;
}
function deleteStaleStmt() {
  if (!_deleteStaleStmt) {
    _deleteStaleStmt = getDb().prepare<[number]>(
      `DELETE FROM query_cache WHERE created_at < ?`,
    );
  }
  return _deleteStaleStmt;
}

export function getCachedQuery(queryHashHex: string): MusicResult[] | null {
  const ttlMs = config.cacheTtlHours * 60 * 60 * 1000;
  const row = selectStmt().get(queryHashHex);
  if (!row) {
    incrementStat('queryCacheMisses');
    return null;
  }
  if (Date.now() - row.created_at > ttlMs) {
    incrementStat('queryCacheMisses');
    return null;
  }
  incrementStat('queryCacheHits');
  try {
    return JSON.parse(row.results_json) as MusicResult[];
  } catch {
    return null;
  }
}

export function setCachedQuery(
  queryHashHex: string,
  queryText: string,
  results: MusicResult[],
): void {
  upsertStmt().run(queryHashHex, queryText, JSON.stringify(results), Date.now());
}

export function purgeStaleQueries(): number {
  const cutoff = Date.now() - config.cacheTtlHours * 60 * 60 * 1000;
  const info = deleteStaleStmt().run(cutoff);
  return info.changes;
}
