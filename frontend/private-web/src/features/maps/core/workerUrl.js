// Where MapLibre finds its worker. scripts/copy-maplibre-worker.mjs copies the worker of the locked package to this
// path before every dev and build run, and scripts/verify-maplibre-worker.mjs looks for this exact text in the built
// chunks, so it stays a plain literal (never built from parts).
export const MAPLIBRE_WORKER_URL = '/assets/maplibre/maplibre-gl-worker.mjs';

const preparedModules = new WeakSet();

/**
 * Points a MapLibre module at the served worker and prewarms its worker pool, once per module.
 *
 * Without `prewarm()` every map that is removed terminates the workers and the next map starts new ones: a React
 * StrictMode remount and every re-mount of a map page do that, and MapLibre 6.16 leaves the script request of a worker
 * terminated while it loads open forever, so the page never reaches network idle. After `prewarm()` the pool outlives
 * the maps. The modules are kept in a WeakSet, so each test fake starts clean without a global reset.
 */
export function ensureWorkerUrl(maplibre) {
  if (preparedModules.has(maplibre)) return;
  maplibre.setWorkerUrl(MAPLIBRE_WORKER_URL);
  maplibre.prewarm();
  preparedModules.add(maplibre);
}
