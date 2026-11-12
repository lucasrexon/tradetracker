import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

const root = path.dirname(fileURLToPath(import.meta.url));

/** Build for the claude.ai-hosted site: no server, data from the page database. */
export default defineConfig({
  root: 'web',
  base: './',
  publicDir: false,
  resolve: {
    alias: [{ find: /^\.\.?\/api\.js$/, replacement: path.join(root, 'web/src/hosted/api.js') }],
  },
  build: {
    outDir: 'dist-hosted',
    emptyOutDir: true,
    chunkSizeWarningLimit: 1000,
    modulePreload: { polyfill: false },
  },
});
