import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

// `npm run dev` proxies /api to `wrangler dev` (apps/worker) on :8787.
export default defineConfig({
  plugins: [react()],
  server: { proxy: { '/api': 'http://localhost:8787' } },
  worker: { format: 'es' },
  build: { outDir: 'dist', sourcemap: true },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./test/setup.ts'],
    css: false,
  },
});
