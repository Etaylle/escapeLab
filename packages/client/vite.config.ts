import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { serviceWorker } from './src/sw/build.js';

export default defineConfig({
  // The service worker comes out of `vite build` only: dist/sw.js beside the page.
  plugins: [react(), serviceWorker()],
  build: {
    rollupOptions: {
      output: {
        // Libraries in a chunk of their own, the game's pure core in another and the world
        // (what draws and sounds the lab, with the little of the screens it uses) in a
        // third: each outlives a release in the cache that leaves it be, and no chunk
        // reaches the 500 kB at which Vite warns. The core imports nothing of the client's.
        manualChunks: (id) => {
          if (id.includes('/node_modules/')) {
            return 'vendor';
          }
          if (id.includes('/packages/core/')) {
            return 'core';
          }
          return id.includes('/packages/client/src/world/') ? 'world' : undefined;
        },
      },
    },
  },
  server: {
    proxy: {
      '/ws': { target: 'ws://localhost:3001', ws: true },
      '/missions': { target: 'http://localhost:3001' },
      '/stats': { target: 'http://localhost:3001' },
      // A take from the /record page goes to the server (ALLOW_RECORD=1); the recordings and
      // their manifest are public/'s, which Vite serves itself.
      '/voice': {
        target: 'http://localhost:3001',
        bypass: (req) => (req.method === 'POST' ? undefined : req.url),
      },
    },
  },
});
