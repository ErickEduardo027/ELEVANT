import { defineConfig, devices } from "@playwright/test";

const port = Number(process.env.E2E_PORT ?? 4173);
const baseURL = `http://127.0.0.1:${port}`;

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: true,
  workers: 2,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  retries: process.env.CI ? 2 : 0,
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    baseURL,
    channel: "chrome",
    trace: "on-first-retry",
    screenshot: "only-on-failure",
  },
  webServer: {
    command: `npm run dev -- --hostname 127.0.0.1 --port ${port}`,
    url: baseURL,
    env: { NEXT_PUBLIC_ELEVANT_API_URL: "https://api.e2e.elevant.test" },
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
  projects: [
    {
      name: "desktop",
      use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } },
    },
    {
      name: "tablet",
      use: {
        ...devices["iPad Pro 11"],
        defaultBrowserType: "chromium",
      },
    },
    {
      name: "mobile",
      use: {
        ...devices["iPhone 13"],
        defaultBrowserType: "chromium",
      },
    },
    // Anchos extremos y el salto a escritorio: solo repiten las comprobaciones
    // de desbordamiento para cubrir el layout sin duplicar toda la suite.
    {
      name: "phone-360",
      grep: /overflow/i,
      use: { ...devices["Pixel 5"], viewport: { width: 360, height: 780 }, defaultBrowserType: "chromium" },
    },
    {
      name: "laptop-1024",
      grep: /overflow/i,
      use: { ...devices["Desktop Chrome"], viewport: { width: 1024, height: 768 } },
    },
    {
      name: "wide-1920",
      grep: /overflow/i,
      use: { ...devices["Desktop Chrome"], viewport: { width: 1920, height: 1080 } },
    },
  ],
});
