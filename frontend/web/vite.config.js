import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Dev preview only — not the project's chosen framework (see README.md).
export default defineConfig({
  plugins: [react()],
  // maplibre-gl loads its worker chunk via `new Worker(url)` (a runtime string, not a static
  // import), so Vite's dependency crawler never discovers it and only pre-bundles maplibre-gl.js
  // itself into .vite/deps — the sibling *-worker.mjs it then requests 404s there, silently
  // disabling all vector-tile loading (base map layers and any custom vector/geojson source) in
  // every map on the page. Excluding the package serves it straight from node_modules instead,
  // where the worker file actually exists alongside it.
  optimizeDeps: {
    exclude: ['maplibre-gl'],
  },
  build: {
    rollupOptions: {
      input: {
        main: 'index.html',
      },
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: './tests/setupTests.js',
  },
});
