#!/usr/bin/env node
/**
 * Provision and deploy the Music Finder backend to Render via REST API.
 *
 * Required env:
 *   RENDER_API_KEY      — Render personal API key
 *   GITHUB_REPO_URL     — e.g. https://github.com/owner/music-finder
 *   GITHUB_BRANCH       — defaults to "main"
 *   FRONTEND_URL        — Vercel production URL (set this once Vercel finishes)
 *   ALLOWED_ORIGINS     — defaults to FRONTEND_URL
 *   SPOTIFY_CLIENT_ID, SPOTIFY_CLIENT_SECRET — optional
 *   YOUTUBE_API_KEY     — optional
 *
 * Optional:
 *   RENDER_REGION       — defaults to "singapore"
 *   RENDER_PLAN         — defaults to "free"
 *   RENDER_SERVICE_NAME — defaults to "music-finder-backend"
 *
 * The script is idempotent: if a service with the given name already exists,
 * it patches its env vars and triggers a deploy instead of recreating it.
 */

const API = 'https://api.render.com/v1';

function need(name) {
  const v = process.env[name];
  if (!v) {
    console.error(`Missing env ${name}`);
    process.exit(1);
  }
  return v;
}

async function api(path, init = {}) {
  const res = await fetch(`${API}${path}`, {
    ...init,
    headers: {
      authorization: `Bearer ${need('RENDER_API_KEY')}`,
      'content-type': 'application/json',
      accept: 'application/json',
      ...(init.headers ?? {}),
    },
  });
  const text = await res.text();
  let body;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  if (!res.ok) {
    throw new Error(`Render API ${res.status} ${res.statusText}: ${typeof body === 'string' ? body : JSON.stringify(body)}`);
  }
  return body;
}

async function findService(name) {
  const list = await api(`/services?name=${encodeURIComponent(name)}&limit=20`);
  const items = Array.isArray(list) ? list : list?.services ?? [];
  for (const item of items) {
    const svc = item.service ?? item;
    if (svc?.name === name) return svc;
  }
  return null;
}

function buildEnvVars() {
  const vars = {
    NODE_ENV: 'production',
    PORT: '3001',
    USER_AGENT: process.env.USER_AGENT ?? 'MusicSearchApp/1.0 (anonymous@example.com)',
    CACHE_TTL_HOURS: '24',
    YOUTUBE_DAILY_QUOTA: '10000',
    YOUTUBE_QUOTA_SAFETY_MARGIN: '500',
    RATE_LIMIT_WINDOW_MS: '60000',
    RATE_LIMIT_MAX_REQUESTS: '30',
    DB_PATH: '/opt/app/data/music-finder.sqlite',
  };
  if (process.env.SPOTIFY_CLIENT_ID) vars.SPOTIFY_CLIENT_ID = process.env.SPOTIFY_CLIENT_ID;
  if (process.env.SPOTIFY_CLIENT_SECRET) vars.SPOTIFY_CLIENT_SECRET = process.env.SPOTIFY_CLIENT_SECRET;
  if (process.env.YOUTUBE_API_KEY) vars.YOUTUBE_API_KEY = process.env.YOUTUBE_API_KEY;
  if (process.env.FRONTEND_URL) vars.FRONTEND_URL = process.env.FRONTEND_URL;
  vars.ALLOWED_ORIGINS = process.env.ALLOWED_ORIGINS ?? process.env.FRONTEND_URL ?? 'http://localhost:5173';
  return Object.entries(vars).map(([key, value]) => ({ key, value }));
}

async function setEnvVars(serviceId, vars) {
  // PATCH /services/:id/env-vars replaces the full set in one call
  await api(`/services/${serviceId}/env-vars`, {
    method: 'PUT',
    body: JSON.stringify(vars),
  });
}

async function triggerDeploy(serviceId) {
  return api(`/services/${serviceId}/deploys`, { method: 'POST', body: JSON.stringify({}) });
}

async function pollDeploy(serviceId, deployId) {
  console.log(`Polling deploy ${deployId} …`);
  for (let i = 0; i < 60; i++) {
    const d = await api(`/services/${serviceId}/deploys/${deployId}`);
    const status = d?.status ?? 'unknown';
    process.stdout.write(`  [${i.toString().padStart(2, '0')}] ${status}\n`);
    if (['live', 'build_failed', 'update_failed', 'canceled', 'deactivated'].includes(status)) {
      return status;
    }
    await new Promise((r) => setTimeout(r, 10_000));
  }
  return 'timeout';
}

async function createService(repo, branch, name, region, plan) {
  return api('/services', {
    method: 'POST',
    body: JSON.stringify({
      type: 'web_service',
      name,
      ownerId: process.env.RENDER_OWNER_ID,
      repo,
      branch,
      autoDeploy: 'yes',
      serviceDetails: {
        env: 'docker',
        plan,
        region,
        runtime: 'docker',
        dockerfilePath: 'backend/Dockerfile',
        dockerContext: '.',
        healthCheckPath: '/api/health',
        envSpecificDetails: {
          dockerfilePath: 'backend/Dockerfile',
          dockerContext: '.',
        },
        disk: { name: 'music-finder-data', mountPath: '/opt/app/data', sizeGB: 1 },
      },
      envVars: buildEnvVars(),
    }),
  });
}

async function main() {
  const repo = need('GITHUB_REPO_URL');
  const branch = process.env.GITHUB_BRANCH ?? 'main';
  const name = process.env.RENDER_SERVICE_NAME ?? 'music-finder-backend';
  const region = process.env.RENDER_REGION ?? 'singapore';
  const plan = process.env.RENDER_PLAN ?? 'free';

  let svc = await findService(name);
  if (!svc) {
    console.log(`Creating service ${name} from ${repo}@${branch} …`);
    const created = await createService(repo, branch, name, region, plan);
    svc = created.service ?? created;
    console.log(`Created service ${svc.id} (${svc.serviceDetails?.url ?? svc.url ?? 'pending URL'})`);
  } else {
    console.log(`Found existing service ${svc.id}; updating env vars …`);
    await setEnvVars(svc.id, buildEnvVars());
    const deploy = await triggerDeploy(svc.id);
    const status = await pollDeploy(svc.id, deploy.id);
    console.log(`Deploy finished: ${status}`);
    if (status !== 'live') process.exit(1);
  }

  const url = svc.serviceDetails?.url ?? svc.url;
  console.log(`\nBackend URL: ${url}`);
}

main().catch((err) => {
  console.error(err.stack ?? err.message ?? err);
  process.exit(1);
});
