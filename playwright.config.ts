import { defineConfig, devices } from "@playwright/test";

// A fixed loopback address and a fresh database prevent tests from reaching a
// deployed site or silently attaching to somebody's development server.
const baseURL = "http://127.0.0.1:5199";

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  failOnFlakyTests: !!process.env.CI,
  workers: process.env.CI ? 2 : undefined,
  timeout: 60_000,
  globalTimeout: 8 * 60_000,
  expect: { timeout: 10_000 },
  outputDir: "test-results",
  reporter: [["list"], ["html", { open: "never" }], ["junit", { outputFile: "test-results/results.xml" }]],
  use: {
    baseURL,
    locale: "en-NZ",
    timezoneId: "Pacific/Auckland",
    reducedMotion: "reduce",
    trace: { mode: "retain-on-failure", screenshots: false, snapshots: true },
    screenshot: "off"
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    { name: "mobile", use: { ...devices["Pixel 7"] } },
    { name: "firefox", use: { ...devices["Desktop Firefox"] } },
    { name: "webkit", use: { ...devices["Desktop Safari"] } }
  ],
  webServer: {
    command: "bun scripts/ci/serve.ts",
    url: baseURL,
    reuseExistingServer: false,
    timeout: 60_000,
    stdout: "pipe",
    stderr: "pipe",
    gracefulShutdown: { signal: "SIGTERM", timeout: 12_000 }
  }
});
