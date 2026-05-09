import pino from 'pino';
import { config, isProd } from '../config.js';

export const logger = pino({
  level: isProd ? 'info' : 'debug',
  redact: {
    paths: [
      'req.headers.authorization',
      'req.headers.cookie',
      '*.SPOTIFY_CLIENT_SECRET',
      '*.YOUTUBE_API_KEY',
      '*.spotifyClientSecret',
      '*.youtubeApiKey',
      'apiKey',
      'token',
      'authorization',
    ],
    censor: '[REDACTED]',
  },
  ...(isProd
    ? {}
    : {
        transport: {
          target: 'pino-pretty',
          options: { colorize: true, translateTime: 'HH:MM:ss.l', ignore: 'pid,hostname' },
        },
      }),
});

export const startupLogger = logger.child({ scope: 'startup' });

void config; // touch config so module is initialized at import time
