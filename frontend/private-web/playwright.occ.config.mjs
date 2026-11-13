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
const port = Number(process.env.OCC_VISUAL_PORT ?? 4186);
const production = process.env.OCC_VISUAL_TARGET === 'production';
const baseURL = `http://localhost:${port}`;
const apiOrigin = 'https://api.elevant.test';

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
  metadata: { target: production ? 'production' : 'development' },
  use: {
    baseURL,
    channel: 'chrome',
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 1,
    reducedMotion: 'reduce',
    locale: 'es-DO',
    timezoneId: 'America/Santo_Domingo',
    actionTimeout: 30_000,
    navigationTimeout: 180_000,
    trace: 'off',
    video: 'off',
    screenshot: 'off',
    launchOptions: {
      args: [
        // Chrome without a GPU may refuse WebGL2: SwiftShader draws the map in software.
        '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist',
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
