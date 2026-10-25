// Bound request bytes before JSON parsing, including chunked bodies without a
// Content-Length header. OAuth client metadata should comfortably fit in 64 KiB.
export const MAX_OAUTH_CLIENT_BODY_BYTES = 64 * 1024;

type OAuthClientRequestResult =
  | { input: unknown }
  | {
      status: 400 | 413 | 415;
      body: {
        error: "invalid_json" | "payload_too_large" | "unsupported_media_type";
      };
    };

export async function readOAuthClientRequest(
  request: Request,
): Promise<OAuthClientRequestResult> {
  const contentType = request.headers
    .get("content-type")
    ?.split(";", 1)[0]
    ?.trim()
    .toLowerCase();
  if (contentType !== "application/json") {
    return {
      status: 415,
      body: { error: "unsupported_media_type" as const },
    };
  }

  const length = Number(request.headers.get("content-length"));
  if (Number.isFinite(length) && length > MAX_OAUTH_CLIENT_BODY_BYTES) {
    return { status: 413, body: { error: "payload_too_large" as const } };
  }
  if (!request.body) {
    return { status: 400, body: { error: "invalid_json" as const } };
  }

  const reader = request.body.getReader();
  const decoder = new TextDecoder();
  let bytes = 0;
  let text = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > MAX_OAUTH_CLIENT_BODY_BYTES) {
        await reader.cancel().catch(() => {});
        return { status: 413, body: { error: "payload_too_large" as const } };
      }
      text += decoder.decode(value, { stream: true });
    }
    text += decoder.decode();
    return { input: JSON.parse(text) as unknown };
  } catch {
    // Never echo parser exceptions, submitted metadata or stream errors.
    return { status: 400, body: { error: "invalid_json" as const } };
  } finally {
    reader.releaseLock();
  }
}
