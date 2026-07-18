import { describe, expect, test } from "vitest";
import {
  DEFAULT_API_URL,
  getProductionDefaultApiUrl,
  isLocalApiUrl,
} from "./connection-defaults";

describe("connection defaults", () => {
  test("keeps the local API URL for development origins", () => {
    expect(DEFAULT_API_URL).toBe("http://127.0.0.1:54150");
    expect(isLocalApiUrl(DEFAULT_API_URL)).toBe(true);
    expect(
      getProductionDefaultApiUrl({
        hostname: "127.0.0.1",
        origin: "http://127.0.0.1:54152",
        protocol: "http:",
      }),
    ).toBeNull();
  });

  test("uses same-origin API calls for hosted HTTPS dashboards", () => {
    expect(
      getProductionDefaultApiUrl({
        hostname: "openmemory-api.abbierman101.workers.dev",
        origin: "https://openmemory-api.abbierman101.workers.dev",
        protocol: "https:",
      }),
    ).toBe("https://openmemory-api.abbierman101.workers.dev");
  });
});
