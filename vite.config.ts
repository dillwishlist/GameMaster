import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const server = 'http://localhost:4000';

export default defineConfig({
  root: 'client',
  plugins: [react()],
  build: {
    outDir: '../dist/client',
    emptyOutDir: true,
  },
  server: {
    // `host: true` so the iPad can reach the dev server too, not just the
    // built bundle — same reason the game server binds 0.0.0.0.
    host: true,
    port: 5173,
    proxy: {
      '/socket.io': { target: server, ws: true },
      '/content': server,
      '/api': server,
    },
  },
});
