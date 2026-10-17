import { defineConfig, devices } from "@playwright/test";

const persistTo = `.tmp/playwright-state-${Date.now()}`;

export default defineConfig({
  testDir: "apps/web/e2e",
  fullyParallel: false,
  timeout: 90_000,
  expect: {
    timeout: 10_000,
  },
  use: {
    baseURL: "http://127.0.0.1:54152",
    trace: "retain-on-failure",
  },
  webServer: [
    {
      command: `bun run --cwd apps/api wrangler d1 migrations apply openmemory-auth --local --persist-to ${persistTo} && bun run --cwd apps/api wrangler dev test/fixtures/session-worker.js --local --persist-to ${persistTo} --port 54150`,
      url: "http://127.0.0.1:54150",
      reuseExistingServer: false,
      timeout: 60_000,
    },
    {
      command: "bun run dev:web",
      url: "http://127.0.0.1:54152",
      reuseExistingServer: false,
      timeout: 60_000,
    },
  ],
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});
