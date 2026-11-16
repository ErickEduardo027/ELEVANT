import { defineConfig, devices } from "@playwright/test";

// End-to-end against the real local stack (API on 127.0.0.1:8080, SQL Server and Mailpit on
// 127.0.0.1:8025): emails are really sent and read back from Mailpit. Not part of CI; run with
// `npm run test:e2e:stack` after `docker compose ... up` (see docs/deployment).
const port = Number(process.env.E2E_STACK_PORT ?? 4174);

export default defineConfig({
  testDir: "./tests/e2e-stack",
  workers: 1,
  timeout: 120_000,
  expect: { timeout: 20_000 },
  reporter: [["list"], ["html", { open: "never", outputFolder: "playwright-report-stack" }]],
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    channel: "chrome",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    ...devices["Desktop Chrome"],
  },
  webServer: {
    command: `npm run dev -- --hostname 127.0.0.1 --port ${port}`,
    url: `http://127.0.0.1:${port}`,
    // The browser talks to an HTTPS name (the CSP requires it); the spec forwards it to the local API.
    env: { NEXT_PUBLIC_ELEVANT_API_URL: "https://api.stack.elevant.test" },
    reuseExistingServer: false,
    timeout: 180_000,
  },
});
