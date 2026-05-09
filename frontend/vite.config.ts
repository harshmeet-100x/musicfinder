import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const apiTarget = process.env.VITE_API_BASE_URL ?? 'http://localhost:3001';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: apiTarget,
        changeOrigin: true,
        // Stream SSE without waiting for response buffering
        configure: (proxy) => {
          proxy.on('proxyReq', (proxyReq) => {
            proxyReq.setHeader('accept-encoding', 'identity');
          });
        },
      },
    },
  },
  build: {
    target: 'es2022',
    // No sourcemaps in production: saves ~380KB of payload and avoids leaking
    // source structure. Enable locally with `VITE_SOURCEMAP=1 vite build` when
    // debugging a prod-built artifact.
    sourcemap: process.env.VITE_SOURCEMAP === '1',
  },
});
