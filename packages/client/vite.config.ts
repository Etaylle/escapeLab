import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      output: {
        // Libraries in a chunk of their own: it outlives a release in the cache, and
        // neither chunk reaches the 500 kB at which Vite warns.
        manualChunks: (id) => (id.includes('/node_modules/') ? 'vendor' : undefined),
      },
    },
  },
  server: {
    proxy: {
      '/ws': { target: 'ws://localhost:3001', ws: true },
      '/missions': { target: 'http://localhost:3001' },
    },
  },
});
