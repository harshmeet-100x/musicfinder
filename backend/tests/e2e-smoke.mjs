import { chromium } from 'playwright-core';
import { existsSync } from 'node:fs';
import { execSync } from 'node:child_process';

const SITE = 'https://music-finder-eight.vercel.app';
const TUNNEL_HOST = 'chapel-flight-advise-spiritual.trycloudflare.com';

const exec = ['/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser']
  .find((p) => existsSync(p));

let tunnelIp = '';
try {
  tunnelIp = execSync(`dig @1.1.1.1 +short A ${TUNNEL_HOST}`).toString().trim().split('\n')[0] ?? '';
} catch {}
console.log('tunnel ipv4:', tunnelIp || '(not resolved)');

const args = ['--no-sandbox', '--disable-dev-shm-usage'];
if (tunnelIp) args.push(`--host-resolver-rules=MAP ${TUNNEL_HOST} ${tunnelIp}`);

const browser = await chromium.launch({
  headless: true,
  executablePath: exec,
  args,
});
const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
const page = await ctx.newPage();

const errors = [];
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
page.on('requestfailed', (req) =>
  errors.push(`reqfailed ${req.url()} ${req.failure()?.errorText}`),
);

console.log('1) Loading homepage…');
await page.goto(SITE, { waitUntil: 'networkidle', timeout: 30_000 });
const title = await page.title();
console.log('   title:', title);
if (!/music finder/i.test(title)) {
  console.error('   ❌ unexpected title');
  process.exit(1);
}
console.log('   ✅ title OK');

console.log('2) Searching for "radiohead"…');
await page.locator('input[aria-label="Search query"]').fill('radiohead');
await page.locator('button[type=submit]').click();

// Wait for at least one result card. Spinner shows "resolving YouTube…"; we want any card.
try {
  await page.locator('article').first().waitFor({ timeout: 30_000 });
  const count = await page.locator('article').count();
  console.log(`   ✅ ${count} cards rendered`);
} catch (e) {
  console.error('   ❌ no cards rendered within 30s:', e.message);
  console.error('   page errors:', errors);
  process.exit(1);
}

console.log('3) Waiting for at least one YouTube link to resolve…');
try {
  await page
    .locator('a:has-text("Play on YouTube")')
    .first()
    .waitFor({ timeout: 45_000 });
  const ytCount = await page.locator('a:has-text("Play on YouTube")').count();
  console.log(`   ✅ ${ytCount} YouTube play links present`);
  const href = await page.locator('a:has-text("Play on YouTube")').first().getAttribute('href');
  console.log('   first href:', href);
  if (!href || !/youtube\.com/.test(href)) {
    console.error('   ❌ href is not a youtube URL');
    process.exit(1);
  }
} catch (e) {
  console.error('   ❌ no YouTube link resolved within 45s:', e.message);
  console.error('   page errors:', errors);
  process.exit(1);
}

console.log('4) Page-level errors during run:', errors.length);
if (errors.length) errors.forEach((e) => console.log('   - ' + e));

await browser.close();
console.log('\n✅ End-to-end smoke test passed.');
