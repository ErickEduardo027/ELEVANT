import { defineConfig } from 'playwright/test';

// The one Playwright setup of AVIAM Web (contracts 3): the OCC visual suite, run in Chrome with `npm run test:visual`.
// Not part of CI yet; it runs before merging map changes. Two projects:
// - `lab`: the map lab (/map-lab, development only) with its fixed scenes, no session and no API;
// - `occ`: the OCC screens with a synthetic session and a stubbed API (tests/visual/occ/fixtures).
// Every request to another origin is answered by tests/visual/support/isolate.mjs (glyphs and a synthetic TileJSON
// from tests/visual/fixtures, synthetic, empty or failing vector tiles, the stub API with Problem Details for the
// rest) or aborted and reported, so no live provider is ever called. Screenshots are written to test-results/visual
// for review; no image baseline is committed (they differ per machine and GPU).
//
// Against `next dev` (default):                npm run test:visual
// Against a production build (lesson 4 of M1): build with the three NEXT_PUBLIC_* values of `webServer.env` below
// (proxy.js requires an HTTPS API origin), then OCC_VISUAL_TARGET=production npm run test:visual. There the lab
// project only checks that /map-lab answers the not-found page.
// In the light theme (ADR-0044, note of 2026-11-15):  OCC_VISUAL_THEME=light npm run test:visual
// stores the light theme before every page loads; its screenshots end in `-light` (tests/visual/support).
// On the real GPU (PR M2, 2026-11-28), for the perf specs:     OCC_VISUAL_GPU=1 npm run test:visual -- --project lab <specs>
// opens a visible Chrome window on the GPU through Direct3D 11 (no SwiftShader), at 1920×1080 unless
// OCC_VISUAL_VIEWPORT=<width>x<height> says otherwise; OCC_VISUAL_GPU=high asks Windows for the high-performance GPU of
// a laptop with two. Every perf spec records the GPU WebGL reports, Chrome's version, the viewport and the pixel ratio
// (support/perf.mjs), and a GPU run that still draws with SwiftShader fails.
const port = Number(process.env.OCC_VISUAL_PORT ?? 4186);
const production = process.env.OCC_VISUAL_TARGET === 'production';
const baseURL = `http://localhost:${port}`;
const apiOrigin = 'https://api.elevant.test';
const gpu = process.env.OCC_VISUAL_GPU === '1' || process.env.OCC_VISUAL_GPU === 'high';
const [viewportWidth, viewportHeight] = (process.env.OCC_VISUAL_VIEWPORT ?? (gpu ? '1920x1080' : '1440x900'))
  .split('x').map(Number);
const webglArgs = gpu
  ? [
    // The real GPU: ANGLE on Direct3D 11, GPU rasterisation, and no blocklist that would send Chrome back to software.
    '--use-angle=d3d11', '--enable-gpu-rasterization', '--ignore-gpu-blocklist',
    ...(process.env.OCC_VISUAL_GPU === 'high' ? ['--force_high_performance_gpu'] : []),
    // A visible window another one covers or that loses the focus keeps drawing every frame.
    '--disable-backgrounding-occluded-windows', '--disable-renderer-backgrounding', '--disable-background-timer-throttling',
  ]
  // Chrome without a GPU may refuse WebGL2: SwiftShader draws the map in software.
  : ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'];

export default defineConfig({
  testDir: './tests/visual',
  outputDir: 'test-results/visual',
  workers: 1,
  fullyParallel: false,
  forbidOnly: true,
  retries: 0,
  timeout: 180_000,
  expect: { timeout: 30_000 },
  // The list reporter only: no HTML report, no traces.
  reporter: [['list']],
  metadata: { target: production ? 'production' : 'development', gpu },
  use: {
    baseURL,
    channel: 'chrome',
    viewport: { width: viewportWidth, height: viewportHeight },
    deviceScaleFactor: 1,
    reducedMotion: 'reduce',
    locale: 'es-DO',
    timezoneId: 'America/Santo_Domingo',
    actionTimeout: 30_000,
    navigationTimeout: 180_000,
    trace: 'off',
    video: 'off',
    screenshot: 'off',
    headless: !gpu,
    launchOptions: {
      args: [
        ...webglArgs,
        // A second guard behind the routes of support/isolate.mjs: Chrome resolves no host but localhost, so a request
        // the routes would miss fails in the browser instead of reaching the network.
        '--host-resolver-rules=MAP * ~NOTFOUND , EXCLUDE localhost',
      ],
    },
  },
  projects: [
    { name: 'lab', testMatch: /lab\/.*\.spec\.mjs/ },
    { name: 'occ', testMatch: /occ\/.*\.spec\.mjs/ },
  ],
  webServer: {
    command: production
      ? `node ./scripts/run-next.mjs start --hostname localhost --port ${port}`
      : `npm run dev -- --hostname localhost --port ${port}`,
    url: `${baseURL}/healthz`,
    env: {
      NEXT_PUBLIC_ELEVANT_API_URL: apiOrigin,
      NEXT_PUBLIC_PROTOTYPE_API_URL: apiOrigin,
      NEXT_PUBLIC_HR_DEMO_MODE: 'dashboard-read-only',
    },
    reuseExistingServer: false,
    timeout: 300_000,
    stdout: 'ignore',
    stderr: 'pipe',
  },
});
