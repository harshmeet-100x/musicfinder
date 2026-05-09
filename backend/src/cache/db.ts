import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { config } from '../config.js';
import { logger } from '../lib/logger.js';

let dbInstance: Database.Database | null = null;

export function getDb(): Database.Database {
  if (dbInstance) return dbInstance;

  mkdirSync(dirname(config.dbPath), { recursive: true });

  const db = new Database(config.dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('synchronous = NORMAL');
  db.pragma('foreign_keys = ON');
  db.pragma('temp_store = MEMORY');

  db.exec(`
    CREATE TABLE IF NOT EXISTS query_cache (
      query_hash TEXT PRIMARY KEY,
      query_text TEXT NOT NULL,
      results_json TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_query_cache_created ON query_cache (created_at);

    CREATE TABLE IF NOT EXISTS youtube_cache (
      artist_title_hash TEXT PRIMARY KEY,
      video_id TEXT,
      resolved_at INTEGER NOT NULL,
      method TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_youtube_cache_resolved ON youtube_cache (resolved_at);

    CREATE TABLE IF NOT EXISTS quota_state (
      day_utc TEXT PRIMARY KEY,
      units_used INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS stats (
      key TEXT PRIMARY KEY,
      value INTEGER NOT NULL DEFAULT 0
    );
  `);

  logger.info({ path: config.dbPath }, 'sqlite ready');
  dbInstance = db;
  return db;
}

export function closeDb(): void {
  if (dbInstance) {
    dbInstance.close();
    dbInstance = null;
  }
}
