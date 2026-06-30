import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "apps/api/e2e",
  fullyParallel: false,
  timeout: 60_000,
  use: {
    baseURL:
      process.env.OPENMEMORY_LIVE_BASE_URL ??
      "https://openmemory-api.abbierman101.workers.dev",
    trace: "retain-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});
