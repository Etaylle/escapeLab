import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { serviceWorker } from './src/sw/build.js';

export default defineConfig({
  // The service worker comes out of `vite build` only: dist/sw.js beside the page.
  plugins: [react(), serviceWorker()],
  build: {
    rollupOptions: {
      output: {
        // Libraries in a chunk of their own, and the game's pure core in another: each
        // outlives a release in the cache that leaves it be, and no chunk reaches the
        // 500 kB at which Vite warns. The core imports nothing of the client's.
        manualChunks: (id) => {
          if (id.includes('/node_modules/')) {
            return 'vendor';
          }
          return id.includes('/packages/core/') ? 'core' : undefined;
        },
      },
    },
  },
  server: {
    proxy: {
      '/ws': { target: 'ws://localhost:3001', ws: true },
      '/missions': { target: 'http://localhost:3001' },
      '/stats': { target: 'http://localhost:3001' },
    },
  },
});
