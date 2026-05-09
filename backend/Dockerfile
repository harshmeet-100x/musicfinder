# ----- build stage -----
FROM node:22-bookworm-slim AS build
WORKDIR /workspace

# Install build tools for better-sqlite3 native bindings
RUN apt-get update \
 && apt-get install -y --no-install-recommends python3 make g++ ca-certificates \
 && rm -rf /var/lib/apt/lists/*

RUN corepack enable && corepack prepare pnpm@11.0.8 --activate

# Copy workspace metadata first for better caching
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml* ./
COPY shared/package.json shared/
COPY backend/package.json backend/
COPY frontend/package.json frontend/

# Avoid pulling Playwright's bundled browsers — Sparticuz Chromium ships in the runtime image
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
RUN pnpm install --frozen-lockfile=false --filter @music-finder/backend... --filter @music-finder/shared

COPY shared shared
COPY backend backend
RUN pnpm --filter @music-finder/shared build && pnpm --filter @music-finder/backend build

RUN pnpm --filter @music-finder/backend deploy --prod /opt/app

# ----- runtime stage -----
FROM node:22-bookworm-slim AS runtime
WORKDIR /opt/app

# System deps required by Chromium (sparticuz bundles its own binary; this is the minimum it needs)
RUN apt-get update \
 && apt-get install -y --no-install-recommends \
      ca-certificates fonts-liberation libnss3 libxss1 libgbm1 libasound2 \
      libatk-bridge2.0-0 libatk1.0-0 libcups2 libdrm2 libdbus-1-3 libexpat1 \
      libgtk-3-0 libpango-1.0-0 libcairo2 libxcomposite1 libxdamage1 libxrandr2 \
      libxkbcommon0 libxshmfence1 wget xdg-utils \
 && rm -rf /var/lib/apt/lists/*

ENV NODE_ENV=production
ENV PORT=3001

COPY --from=build /opt/app /opt/app
COPY --from=build /workspace/backend/dist /opt/app/dist

# DB lives in a writable mounted volume on Render
RUN mkdir -p /opt/app/data
VOLUME ["/opt/app/data"]
ENV DB_PATH=/opt/app/data/music-finder.sqlite

EXPOSE 3001
CMD ["node", "dist/index.js"]
