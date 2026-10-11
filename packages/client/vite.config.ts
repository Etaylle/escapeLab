import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/ws': { target: 'ws://localhost:3001', ws: true },
      '/missions': { target: 'http://localhost:3001' },
    },
  },
});
