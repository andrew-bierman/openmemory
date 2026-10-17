import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { describe, expect, test, vi } from "vitest";

const source = readFileSync(
  new URL("../../api/src/index.ts", import.meta.url),
  "utf8",
);
const html =
  source.split("const LOGIN_HTML = `")[1]?.split("const CONSENT_HTML")[0] ?? "";

async function loginPage(
  capabilities: unknown,
  redirect = "/consent?client_id=test",
  failedPath?: string,
) {
  type Element = {
    value: string;
    disabled: boolean;
    hidden: boolean;
    textContent: string;
    children: Element[];
    classList: {
      add: ReturnType<typeof vi.fn>;
      remove: ReturnType<typeof vi.fn>;
    };
    appendChild(child: Element): void;
    onsubmit(event: { preventDefault(): void }): Promise<void>;
  };
  const elements = new Map<string, Element>();
  const element = (id: string) => {
    if (!elements.has(id))
      elements.set(id, {
        value: "",
        disabled: true,
        hidden: false,
        textContent: "",
        children: [],
        classList: { add: vi.fn(), remove: vi.fn() },
        appendChild(child: Element) {
          this.children.push(child);
        },
        onsubmit: async () => {},
      });
    const found = elements.get(id);
    if (!found) throw new Error("Missing element");
    return found;
  };
  const location = {
    origin: "https://memory.example",
    search: `?redirect=${encodeURIComponent(redirect)}`,
    href: "",
  };
  const fetch = vi.fn(async (path: string, _options?: { body: string }) => ({
    ok: path !== failedPath,
    json: async () =>
      path.endsWith("capabilities") ? capabilities : { success: true },
  }));
  runInNewContext(html.match(/<script>([\s\S]*?)<\/script>/)?.[1] ?? "", {
    document: { querySelector: element, createElement: () => ({}) },
    location,
    fetch,
    URL,
    URLSearchParams,
  });
  await vi.waitFor(() => expect(fetch).toHaveBeenCalled());
  return { element, location, fetch };
}

describe("passwordless login page", () => {
  test("removes password and signup controls", () => {
    expect(html).not.toContain('type="password"');
    expect(html).not.toContain("/api/auth/sign-up/email");
  });
  test("only renders configured providers and fails closed without email delivery", async () => {
    const page = await loginPage({
      emailOTP: false,
      socialProviders: ["github"],
    });
    await vi.waitFor(() =>
      expect(page.element("#providers").children).toHaveLength(1),
    );
    expect(page.element("#providers").children[0].textContent).toBe(
      "Continue with GitHub",
    );
    expect(page.element("#sendCode").disabled).toBe(true);
  });
  test("sends sign-in OTP, verifies it, and preserves consent redirect", async () => {
    const page = await loginPage({ emailOTP: true, socialProviders: [] });
    await vi.waitFor(() =>
      expect(page.element("#sendCode").disabled).toBe(false),
    );
    page.element("#email").value = "invited@example.com";
    await page.element("#authForm").onsubmit({ preventDefault() {} });
    expect(JSON.parse(page.fetch.mock.calls[1][1]?.body ?? "null")).toEqual({
      email: "invited@example.com",
      type: "sign-in",
    });
    page.element("#otp").value = "123456";
    await page.element("#verifyForm").onsubmit({ preventDefault() {} });
    expect(page.fetch.mock.calls[2][0]).toBe("/api/auth/sign-in/email-otp");
    expect(JSON.parse(page.fetch.mock.calls[2][1]?.body ?? "null")).toEqual({
      email: "invited@example.com",
      otp: "123456",
    });
    expect(page.location.href).toBe(
      "https://memory.example/consent?client_id=test",
    );
  });
  test("does not forward an external login redirect", async () => {
    const page = await loginPage(
      { emailOTP: true, socialProviders: [] },
      "https://evil.example",
    );
    page.element("#email").value = "invited@example.com";
    await vi.waitFor(() =>
      expect(page.element("#sendCode").disabled).toBe(false),
    );
    await page.element("#authForm").onsubmit({ preventDefault() {} });
    await page.element("#verifyForm").onsubmit({ preventDefault() {} });
    expect(page.location.href).toBe("https://memory.example/");
  });
  test("keeps all sign-in unavailable when capability discovery fails", async () => {
    const page = await loginPage(
      { emailOTP: true, socialProviders: ["google"] },
      "/",
      "/api/auth/capabilities",
    );
    await vi.waitFor(() =>
      expect(page.element("#status").textContent).toContain("unavailable"),
    );
    expect(page.element("#sendCode").disabled).toBe(true);
    expect(page.element("#providers").children).toHaveLength(0);
    await page.element("#authForm").onsubmit({ preventDefault() {} });
    expect(page.fetch).toHaveBeenCalledTimes(1);
  });
  test("failed verification clears code and never redirects", async () => {
    const page = await loginPage(
      { emailOTP: true, socialProviders: [] },
      "/",
      "/api/auth/sign-in/email-otp",
    );
    await vi.waitFor(() =>
      expect(page.element("#sendCode").disabled).toBe(false),
    );
    page.element("#email").value = "invited@example.com";
    await page.element("#authForm").onsubmit({ preventDefault() {} });
    page.element("#otp").value = "654321";
    await page.element("#verifyForm").onsubmit({ preventDefault() {} });
    expect(page.element("#otp").value).toBe("");
    expect(page.element("#error").textContent).toContain(
      "Sign-in could not be completed",
    );
    expect(page.location.href).toBe("");
  });
});
