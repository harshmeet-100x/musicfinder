import 'dotenv/config';

function num(value: string | undefined, fallback: number): number {
  const parsed = value ? Number(value) : NaN;
  return Number.isFinite(parsed) ? parsed : fallback;
}

function str(value: string | undefined, fallback: string): string {
  return value && value.length > 0 ? value : fallback;
}

export const config = {
  nodeEnv: str(process.env.NODE_ENV, 'development'),
  port: num(process.env.PORT, 3001),

  spotifyClientId: process.env.SPOTIFY_CLIENT_ID ?? '',
  spotifyClientSecret: process.env.SPOTIFY_CLIENT_SECRET ?? '',
  youtubeApiKey: process.env.YOUTUBE_API_KEY ?? '',

  cacheTtlHours: num(process.env.CACHE_TTL_HOURS, 24),
  youtubeDailyQuota: num(process.env.YOUTUBE_DAILY_QUOTA, 10000),
  youtubeQuotaSafetyMargin: num(process.env.YOUTUBE_QUOTA_SAFETY_MARGIN, 500),

  userAgent: str(process.env.USER_AGENT, 'MusicSearchApp/1.0 (anonymous@example.com)'),
  frontendUrl: str(process.env.FRONTEND_URL, 'http://localhost:5173'),
  allowedOrigins: str(process.env.ALLOWED_ORIGINS, 'http://localhost:5173')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),

  rateLimitWindowMs: num(process.env.RATE_LIMIT_WINDOW_MS, 60_000),
  rateLimitMaxRequests: num(process.env.RATE_LIMIT_MAX_REQUESTS, 30),

  dbPath: str(process.env.DB_PATH, './data/music-finder.sqlite'),
} as const;

export const isProd = config.nodeEnv === 'production';
