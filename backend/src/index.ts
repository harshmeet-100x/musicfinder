import express, { type NextFunction, type Request, type Response } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import compression from 'compression';
import rateLimit from 'express-rate-limit';
import { config, isProd } from './config.js';
import { logger } from './lib/logger.js';
import { getDb, closeDb } from './cache/db.js';
import { searchRouter } from './routes/search.js';
import { cacheStatsRouter } from './routes/cacheStats.js';
import { healthRouter } from './routes/health.js';
import { closeBrowser } from './lib/browser.js';

function createApp() {
  const app = express();

  app.disable('x-powered-by');
  app.set('trust proxy', 1); // Render/Vercel sit behind a proxy

  app.use(
    helmet({
      contentSecurityPolicy: {
        useDefaults: true,
        directives: {
          defaultSrc: ["'self'"],
          imgSrc: ["'self'", 'data:', 'https:'],
          connectSrc: ["'self'"],
          frameSrc: ['https://www.youtube.com', 'https://www.youtube-nocookie.com'],
          scriptSrc: ["'self'"],
          styleSrc: ["'self'"],
          objectSrc: ["'none'"],
          baseUri: ["'self'"],
        },
      },
      crossOriginResourcePolicy: { policy: 'cross-origin' },
    }),
  );

  app.use(
    cors({
      origin: (origin, cb) => {
        if (!origin) return cb(null, true); // curl, server-to-server
        if (config.allowedOrigins.includes(origin)) return cb(null, true);
        return cb(new Error(`Origin ${origin} not allowed`));
      },
      credentials: false,
    }),
  );

  app.use(compression());
  app.use(express.json({ limit: '16kb' }));

  const limiter = rateLimit({
    windowMs: config.rateLimitWindowMs,
    max: config.rateLimitMaxRequests,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'rate limit exceeded' },
  });
  app.use('/api/search', limiter);

  app.use(healthRouter);
  app.use(cacheStatsRouter);
  app.use(searchRouter);

  app.use((err: Error, req: Request, res: Response, _next: NextFunction) => {
    logger.error({ err: err.message, url: req.url }, 'unhandled error');
    if (res.headersSent) return;
    res.status(500).json({ error: isProd ? 'internal error' : err.message });
  });

  return app;
}

async function main() {
  getDb(); // init DB synchronously at startup
  const app = createApp();
  const server = app.listen(config.port, () => {
    logger.info({ port: config.port, env: config.nodeEnv }, 'backend listening');
  });

  const shutdown = async (sig: string) => {
    logger.info({ sig }, 'shutting down');
    server.close();
    await closeBrowser();
    closeDb();
    setTimeout(() => process.exit(0), 500).unref();
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}

void main();
