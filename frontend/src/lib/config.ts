/**
 * Resolve the API base URL.
 *  - In dev (Vite proxy), use a relative path so requests hit /api/* on the same origin.
 *  - In prod, use VITE_API_BASE_URL injected at build time.
 */
const fromEnv = import.meta.env.VITE_API_BASE_URL?.trim();
export const API_BASE_URL = fromEnv && fromEnv.length > 0 ? fromEnv.replace(/\/$/, '') : '';
