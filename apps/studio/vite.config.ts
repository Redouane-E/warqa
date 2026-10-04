import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// The React app. In development the API runs on STUDIO_API_PORT (scripts/dev.mjs) and Vite proxies to it.
const api = `http://127.0.0.1:${process.env.STUDIO_API_PORT ?? '5171'}`;

export default defineConfig({
  root: 'src/client',
  base: '/',
  plugins: [react()],
  build: {
    outDir: '../../dist/client',
    emptyOutDir: true,
    target: 'es2022',
    sourcemap: true,
  },
  server: {
    port: Number(process.env.STUDIO_PORT ?? 5170),
    strictPort: false,
    proxy: {
      '/api': { target: api, changeOrigin: false },
      '/player': { target: api },
      '/books': { target: api },
    },
  },
});
