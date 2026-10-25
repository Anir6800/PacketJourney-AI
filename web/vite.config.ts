import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const host = '127.0.0.1';

export default defineConfig({
  plugins: [react()],
  server: {
    host,
    port: 5173,
    strictPort: true,
    proxy: { '/api': `http://${host}:8787` },
  },
  preview: { host, port: 4173, strictPort: true, proxy: { '/api': `http://${host}:8787` } },
  // Only VITE_-prefixed vars reach the bundle; AI_* secrets never do.
  envPrefix: 'VITE_',
});
