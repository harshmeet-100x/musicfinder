import { getDb } from '../cache/db.js';
import { config } from '../config.js';

const COST_SEARCH_LIST = 100;

import type { Statement } from 'better-sqlite3';

let _readStmt: Statement<[string], { units_used: number }> | null = null;
let _upsertStmt: Statement<[string, number]> | null = null;

function readStmt() {
  if (!_readStmt) {
    _readStmt = getDb().prepare<[string], { units_used: number }>(
      `SELECT units_used FROM quota_state WHERE day_utc = ?`,
    );
  }
  return _readStmt;
}
function upsertStmt() {
  if (!_upsertStmt) {
    _upsertStmt = getDb().prepare<[string, number]>(
      `INSERT INTO quota_state (day_utc, units_used) VALUES (?, ?)
       ON CONFLICT(day_utc) DO UPDATE SET units_used = units_used + excluded.units_used`,
    );
  }
  return _upsertStmt;
}

function todayUtc(): string {
  return new Date().toISOString().slice(0, 10);
}

let cachedDay: string | null = null;
let cachedUnits = 0;

function refreshIfStale(): void {
  const today = todayUtc();
  if (cachedDay !== today) {
    cachedDay = today;
    const row = readStmt().get(today);
    cachedUnits = row?.units_used ?? 0;
  }
}

export function getUnitsUsedToday(): number {
  refreshIfStale();
  return cachedUnits;
}

export function quotaResetAtUtc(): string {
  const tomorrow = new Date();
  tomorrow.setUTCHours(24, 0, 0, 0);
  return tomorrow.toISOString();
}

export function shouldUseScrape(): boolean {
  if (!config.youtubeApiKey) return true;
  refreshIfStale();
  const headroom = config.youtubeQuotaSafetyMargin;
  return cachedUnits + COST_SEARCH_LIST > config.youtubeDailyQuota - headroom;
}

export function recordSearchListCall(): void {
  refreshIfStale();
  cachedUnits += COST_SEARCH_LIST;
  upsertStmt().run(todayUtc(), COST_SEARCH_LIST);
}

export const QUOTA_COSTS = {
  searchList: COST_SEARCH_LIST,
} as const;
