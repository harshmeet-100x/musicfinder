import type { YouTubeResolveMethod } from '@music-finder/shared';
import { getDb } from './db.js';
import { incrementStat } from './stats.js';

interface YtCacheRow {
  artist_title_hash: string;
  video_id: string | null;
  resolved_at: number;
  method: string;
}

export interface YtCacheHit {
  videoId: string | null;
  method: YouTubeResolveMethod;
  resolvedAt: number;
}

import type { Statement } from 'better-sqlite3';

let _selectStmt: Statement<[string], YtCacheRow> | null = null;
let _upsertStmt: Statement<[string, string | null, number, string]> | null = null;

function selectStmt() {
  if (!_selectStmt) {
    _selectStmt = getDb().prepare<[string], YtCacheRow>(
      `SELECT * FROM youtube_cache WHERE artist_title_hash = ?`,
    );
  }
  return _selectStmt;
}
function upsertStmt() {
  if (!_upsertStmt) {
    _upsertStmt = getDb().prepare<[string, string | null, number, string]>(
      `INSERT INTO youtube_cache (artist_title_hash, video_id, resolved_at, method)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(artist_title_hash) DO UPDATE SET
         video_id=excluded.video_id,
         resolved_at=excluded.resolved_at,
         method=excluded.method`,
    );
  }
  return _upsertStmt;
}

export function getCachedYouTube(hash: string): YtCacheHit | null {
  const row = selectStmt().get(hash);
  if (!row) {
    incrementStat('youtubeCacheMisses');
    return null;
  }
  incrementStat('youtubeCacheHits');
  return {
    videoId: row.video_id,
    method: row.method as YouTubeResolveMethod,
    resolvedAt: row.resolved_at,
  };
}

export function setCachedYouTube(
  hash: string,
  videoId: string | null,
  method: YouTubeResolveMethod,
): void {
  upsertStmt().run(hash, videoId, Date.now(), method);
}
