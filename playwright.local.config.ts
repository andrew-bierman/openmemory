import { defineConfig, devices } from "@playwright/test";

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
      command: "bun run dev:api",
      url: "http://127.0.0.1:54150",
      reuseExistingServer: true,
      timeout: 60_000,
    },
    {
      command: "bun run dev:web",
      url: "http://127.0.0.1:54152",
      reuseExistingServer: true,
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
