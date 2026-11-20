import { describe, expect, test } from "vitest";
import type { Env } from "../src/env";
import { signUpAllowed } from "../src/passwordless";

describe("signup gate polarity", () => {
  const env = (value?: string) => ({ OPENMEMORY_ALLOW_SIGN_UP: value }) as Env;
  test("only the exact string true opens the gate", () => {
    expect(signUpAllowed(env("true"))).toBe(true);
  });
  test.each([
    undefined,
    "",
    "false",
    "1",
    "yes",
    "True",
    " true",
    "true ",
  ])("%s keeps the gate closed", (value) => {
    expect(signUpAllowed(env(value))).toBe(false);
  });
});
