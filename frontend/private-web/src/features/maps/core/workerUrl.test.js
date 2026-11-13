import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { createFakeMapLibre } from '../../../../tests/fakeMapLibre';
import { MAPLIBRE_WORKER_URL, ensureWorkerUrl } from './workerUrl';

describe('ensureWorkerUrl', () => {
  it('sets the literal worker URL and prewarms the worker pool once per MapLibre module', () => {
    // scripts/verify-maplibre-worker.mjs looks for this exact text in the built chunks.
    expect(MAPLIBRE_WORKER_URL).toBe('/assets/maplibre/maplibre-gl-worker.mjs');
    expect(readFileSync('src/features/maps/core/workerUrl.js', 'utf8'))
      .toContain("'/assets/maplibre/maplibre-gl-worker.mjs'");

    const first = createFakeMapLibre();
    ensureWorkerUrl(first.module);
    ensureWorkerUrl(first.module);
    expect(first.state.calls).toEqual([
      { fn: 'setWorkerUrl', args: [MAPLIBRE_WORKER_URL] },
      { fn: 'prewarm', args: [] },
    ]);
    expect(first.state.prewarmCount).toBe(1);

    // Another module (a fresh fake) starts clean and is prepared on its own.
    const second = createFakeMapLibre();
    expect(second.state.workerUrl).toBeNull();
    ensureWorkerUrl(second.module);
    expect(second.state.calls.map(call => call.fn)).toEqual(['setWorkerUrl', 'prewarm']);
    expect(first.state.prewarmCount).toBe(1);
  });
});
