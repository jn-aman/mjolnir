import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import path from 'node:path';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: { '@': path.resolve(import.meta.dirname, 'src') },
  },
  server: {
    port: 5273,
    // The local API binds to loopback and picks its own port; the desktop
    // shell injects the real one. This is the dev default only.
    proxy: {
      '/api': { target: 'http://127.0.0.1:7845', changeOrigin: true },
      '/ws': { target: 'ws://127.0.0.1:7845', ws: true },
    },
  },
  build: { outDir: 'dist', emptyOutDir: true, sourcemap: true },
});
