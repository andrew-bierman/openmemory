interface BudgetStatement {
  bind(...values: (string | number)[]): BudgetStatement;
  first<T>(): Promise<T | null>;
}
export interface EmailEnv {
  RESEND_API_KEY?: string;
  AUTH_EMAIL_FROM?: string;
  AUTH_EMAIL_MODE?: "staging" | "production";
  AUTH_EMAIL_ALLOWED_RECIPIENTS?: string;
  AUTH_EMAIL_RUN_ID?: string;
  AUTH_EMAIL_RUN_EXPIRES_AT?: string;
  SEND_BUDGET_DB?: { prepare(query: string): BudgetStatement };
}
export const RESERVE_ATTEMPT_SQL = `INSERT INTO send_budget (run_id, attempts, expires_at)
SELECT ?, 1, ? WHERE ? < ?
ON CONFLICT(run_id) DO UPDATE SET attempts = attempts + 1
WHERE attempts < 12 AND expires_at = excluded.expires_at AND expires_at > ?
RETURNING attempts`;
const emailPattern =
  /^[a-zA-Z0-9.!#$%&'*+/=?^_\x60{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]*[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]*[a-zA-Z0-9])?)+$/;
const isEmail = (value: unknown): value is string =>
  typeof value === "string" && value.length <= 254 && emailPattern.test(value);
async function boundedText(
  body: ReadableStream<Uint8Array> | null,
  maximum: number,
  signal: AbortSignal,
) {
  if (!body) throw new Error("Missing body");
  const reader = body.getReader();
  const cancel = () => {
    void reader.cancel().catch(() => {});
  };
  signal.addEventListener("abort", cancel, { once: true });
  if (signal.aborted) cancel();
  let size = 0;
  const chunks: Uint8Array[] = [];
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maximum) throw new Error("Body too large");
      chunks.push(value);
    }
  } finally {
    signal.removeEventListener("abort", cancel);
    void reader.cancel().catch(() => {});
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
}
async function withinDeadline<T>(
  operation: (signal: AbortSignal) => Promise<T>,
): Promise<T> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      operation(controller.signal),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          controller.abort();
          reject(new Error("Deadline exceeded"));
        }, 10_000);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}
export function createAuthEmailWorker(
  deps: { fetch?: typeof fetch; now?: () => number } = {},
) {
  const send = deps.fetch ?? globalThis.fetch.bind(globalThis);
  const now = deps.now ?? Date.now;
  return {
    async fetch(request: Request, env: EmailEnv): Promise<Response> {
      const fail = (status: number) =>
        new Response("Delivery unavailable", {
          status,
          headers: { "cache-control": "no-store" },
        });
      if (new URL(request.url).pathname !== "/send") return fail(404);
      if (request.method !== "POST") return fail(405);
      const recipients = (env.AUTH_EMAIL_ALLOWED_RECIPIENTS ?? "")
        .split(",")
        .map((value) => value.trim().toLowerCase());
      if (
        !env.RESEND_API_KEY?.trim() ||
        !isEmail(env.AUTH_EMAIL_FROM) ||
        !recipients.length ||
        !recipients.every(isEmail) ||
        !["staging", "production"].includes(env.AUTH_EMAIL_MODE ?? "")
      )
        return fail(503);
      const expiry = Date.parse(env.AUTH_EMAIL_RUN_EXPIRES_AT ?? "");
      if (
        env.AUTH_EMAIL_MODE === "staging" &&
        (!env.SEND_BUDGET_DB ||
          !/^[a-zA-Z0-9_-]{1,80}$/.test(env.AUTH_EMAIL_RUN_ID ?? "") ||
          !Number.isFinite(expiry) ||
          expiry <= now())
      )
        return fail(503);
      if (
        request.headers.get("content-type")?.split(";")[0]?.trim() !==
        "application/json"
      )
        return fail(400);
      let input: {
        email: string;
        otp: string;
        type: string;
        expiresIn: number;
      };
      try {
        input = JSON.parse(
          await withinDeadline((signal) =>
            boundedText(request.body, 1024, signal),
          ),
        );
        if (
          !input ||
          typeof input !== "object" ||
          Object.keys(input).sort().join(",") !== "email,expiresIn,otp,type" ||
          !isEmail(input.email) ||
          !recipients.includes(input.email.toLowerCase()) ||
          typeof input.otp !== "string" ||
          !/^\d{6}$/.test(input.otp) ||
          input.type !== "sign-in" ||
          input.expiresIn !== 300
        )
          return fail(400);
      } catch {
        return fail(400);
      }
      try {
        return await withinDeadline(async (signal) => {
          if (env.AUTH_EMAIL_MODE === "staging") {
            const time = now();
            const reserved = await env.SEND_BUDGET_DB?.prepare(
              RESERVE_ATTEMPT_SQL,
            )
              .bind(env.AUTH_EMAIL_RUN_ID ?? "", expiry, time, expiry, time)
              .first<{ attempts: number }>();
            if (!reserved || signal.aborted || now() >= expiry)
              return fail(429);
          }
          const response = await send("https://api.resend.com/emails", {
            method: "POST",
            redirect: "error",
            signal,
            headers: {
              authorization: `Bearer ${env.RESEND_API_KEY}`,
              "content-type": "application/json",
            },
            body: JSON.stringify({
              from: env.AUTH_EMAIL_FROM,
              to: [input.email.toLowerCase()],
              subject: "Your OpenMemory sign-in code",
              text: `Your OpenMemory sign-in code is ${input.otp}. It expires in 5 minutes. If you did not request this code, ignore this email.`,
            }),
          });
          if (!response.ok) {
            void response.body?.cancel().catch(() => {});
            return fail(502);
          }
          const accepted = JSON.parse(
            await boundedText(response.body, 4096, signal),
          );
          if (
            typeof accepted?.id !== "string" ||
            !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
              accepted.id,
            )
          )
            return fail(502);
          return new Response(null, {
            status: 204,
            headers: { "cache-control": "no-store" },
          });
        });
      } catch {
        return fail(502);
      }
    },
  };
}
export default createAuthEmailWorker();
