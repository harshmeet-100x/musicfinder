/**
 * Shared headless Chromium for both Bandcamp scraping and YouTube fallback scraping.
 * Lazily launched, reused across requests, gracefully closed on shutdown.
 */

import { existsSync } from 'node:fs';
import type { Browser, BrowserContext } from 'playwright-core';
import { chromium } from 'playwright-core';
import { logger } from './logger.js';
import { isProd } from '../config.js';

let browserPromise: Promise<Browser> | null = null;

async function launchBrowser(): Promise<Browser> {
  let executablePath: string | undefined;
  let extraArgs: string[] = [];

  if (isProd) {
    try {
      const chromiumModule = await import('@sparticuz/chromium');
      const sparticuz = chromiumModule.default;
      executablePath = await sparticuz.executablePath();
      extraArgs = sparticuz.args;
    } catch (err) {
      logger.warn(
        { err: err instanceof Error ? err.message : String(err) },
        'sparticuz chromium unavailable; falling back to system chromium',
      );
    }
  }

  // In dev (or when sparticuz didn't resolve), allow an explicit env override or
  // probe a few well-known system paths for Chromium/Chrome.
  if (!executablePath) {
    executablePath =
      process.env.CHROMIUM_PATH ||
      [
        '/usr/bin/chromium',
        '/usr/bin/chromium-browser',
        '/usr/bin/google-chrome',
        '/usr/bin/google-chrome-stable',
      ].find((p) => existsSync(p));
  }

  const args = [
    ...extraArgs,
    '--disable-dev-shm-usage',
    '--disable-blink-features=AutomationControlled',
  ];
  if (isProd && !args.includes('--no-sandbox')) args.push('--no-sandbox');

  logger.info({ executablePath: executablePath ?? '(default)' }, 'launching shared chromium');

  return chromium.launch({
    headless: true,
    executablePath,
    args,
  });
}

export async function getBrowser(): Promise<Browser> {
  if (!browserPromise) {
    browserPromise = launchBrowser().catch((err) => {
      browserPromise = null;
      throw err;
    });
  }
  return browserPromise;
}

/**
 * Run a callback inside a fresh, isolated browser context. The context is
 * always closed in `finally`, so cookies/storage never leak between requests.
 */
export async function withContext<T>(fn: (ctx: BrowserContext) => Promise<T>): Promise<T> {
  const browser = await getBrowser();
  const ctx = await browser.newContext({
    userAgent:
      'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    viewport: { width: 1280, height: 800 },
    javaScriptEnabled: true,
  });
  try {
    return await fn(ctx);
  } finally {
    await ctx.close().catch(() => undefined);
  }
}

export async function closeBrowser(): Promise<void> {
  const promise = browserPromise;
  browserPromise = null;
  if (promise) {
    try {
      const b = await promise;
      await b.close();
    } catch {
      /* swallow */
    }
  }
}
