import { defineConfig } from "@playwright/test";

// Full operating cycle (ADR-0037) against the real local stack: compose.local.yml plus
// compose.local.e2e.yml (Garage, CORS, request limits) and Mailpit. Not part of CI.
//   E2E_CYCLE_ENV_FILE=<stack .env> E2E_CYCLE_API=http://127.0.0.1:8080 npm run test:e2e:cycle
// One project per cycle phase, chained: each phase continues the run the previous one started.
// Only the list reporter and no traces: traces and the HTML report would keep typed passwords.
const publicPort = Number(process.env.E2E_CYCLE_PUBLIC_PORT ?? 4174);
const privatePort = Number(process.env.E2E_CYCLE_PRIVATE_PORT ?? 4175);
const apiName = "https://api.stack.elevant.test";

export default defineConfig({
  testDir: "./tests/e2e-cycle",
  workers: 1,
  fullyParallel: false,
  timeout: 300_000,
  expect: { timeout: 30_000 },
  reporter: [["list"]],
  outputDir: "test-results/cycle",
  use: {
    channel: "chrome",
    headless: !process.env.E2E_CYCLE_HEADED,
    viewport: { width: 1440, height: 900 },
    actionTimeout: 30_000,
    navigationTimeout: 60_000,
    trace: "off",
    screenshot: "off",
    video: "off",
    acceptDownloads: true,
    launchOptions: { slowMo: Number(process.env.E2E_CYCLE_SLOWMO ?? 0) },
  },
  projects: [
    { name: "fase1", testMatch: /fase1-.*\.spec\.ts/ },
    { name: "fase2", testMatch: /fase2-.*\.spec\.ts/, dependencies: ["fase1"] },
    { name: "fase3", testMatch: /fase3-.*\.spec\.ts/, dependencies: ["fase2"] },
    { name: "fase4", testMatch: /fase4-.*\.spec\.ts/, dependencies: ["fase3"] },
  ],
  webServer: [
    {
      command: `npm run dev -- --hostname localhost --port ${publicPort}`,
      url: `http://localhost:${publicPort}`,
      env: { NEXT_PUBLIC_ELEVANT_API_URL: apiName },
      reuseExistingServer: false,
      timeout: 240_000,
    },
    {
      command: `npm run dev -- --hostname localhost --port ${privatePort}`,
      cwd: "../private-web",
      url: `http://localhost:${privatePort}/login`,
      env: {
        NEXT_PUBLIC_ELEVANT_API_URL: apiName,
        NEXT_PUBLIC_PROTOTYPE_API_URL: apiName,
        NEXT_PUBLIC_HR_DEMO_MODE: "dashboard-read-only",
      },
      reuseExistingServer: false,
      timeout: 300_000,
    },
  ],
});
