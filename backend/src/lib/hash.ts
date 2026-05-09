import { createHash } from 'node:crypto';

export function sha256(input: string): string {
  return createHash('sha256').update(input).digest('hex');
}

/**
 * Normalize a free-form user query into a stable cache key.
 *  - lowercase
 *  - trim
 *  - collapse whitespace
 *  - strip control chars (incl. null bytes)
 *  - strip a few common zero-width unicode confusables
 */
export function normalizeQuery(raw: string): string {
  const stripped = raw
    // remove ASCII control chars + DEL
    .replace(/[\x00-\x1f\x7f]/g, ' ')
    // remove zero-width chars commonly used to bypass filters
    .replace(/[​-‏‪-‮⁠-⁤﻿]/g, '')
    .toLowerCase()
    .trim()
    .replace(/\s+/g, ' ');
  return stripped;
}

export function queryHash(normalized: string): string {
  return sha256(normalized);
}

export function artistTitleHash(artist: string, title: string): string {
  return sha256(`${artist.toLowerCase().trim()}${title.toLowerCase().trim()}`);
}
