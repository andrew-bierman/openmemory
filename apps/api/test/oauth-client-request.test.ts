import { describe, expect, test } from "vitest";
import {
  MAX_OAUTH_CLIENT_BODY_BYTES,
  readOAuthClientRequest,
} from "../src/oauth-client-request";

function streamedRequest(chunks: Uint8Array[], contentLength?: string) {
  return new Request("https://openmemory.test/v1/oauth/clients", {
    method: "POST",
    headers: {
      "content-type": "application/json; charset=utf-8",
      ...(contentLength ? { "content-length": contentLength } : {}),
    },
    body: new ReadableStream({
      start(controller) {
        for (const chunk of chunks) controller.enqueue(chunk);
        controller.close();
      },
    }),
    duplex: "half",
  } as RequestInit);
}

const encode = (text: string) => new TextEncoder().encode(text);

describe("OAuth client request boundary", () => {
  test("accepts exactly the byte limit and rejects one extra byte without Content-Length", async () => {
    const body = encode(`"${"x".repeat(MAX_OAUTH_CLIENT_BODY_BYTES - 2)}"`);
    expect(await readOAuthClientRequest(streamedRequest([body]))).toEqual({
      input: "x".repeat(MAX_OAUTH_CLIENT_BODY_BYTES - 2),
    });
    expect(
      await readOAuthClientRequest(streamedRequest([body, encode(" ")])),
    ).toEqual({
      status: 413,
      body: { error: "payload_too_large" },
    });
  });

  test("counts UTF-8 bytes and does not trust a small Content-Length", async () => {
    const body = encode(
      JSON.stringify("é".repeat(MAX_OAUTH_CLIENT_BODY_BYTES / 2)),
    );
    expect(await readOAuthClientRequest(streamedRequest([body], "2"))).toEqual({
      status: 413,
      body: { error: "payload_too_large" },
    });
  });

  test("decodes UTF-8 characters split between chunks", async () => {
    const body = encode('{"name":"é"}');
    const split = body.indexOf(0xc3) + 1;
    expect(
      await readOAuthClientRequest(
        streamedRequest([body.slice(0, split), body.slice(split)]),
      ),
    ).toEqual({
      input: { name: "é" },
    });
  });

  test("does not disclose malformed JSON or stream failure details", async () => {
    const failedStream = new Request(
      "https://openmemory.test/v1/oauth/clients",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: new ReadableStream({
          start(controller) {
            controller.error(new Error("private-marker"));
          },
        }),
        duplex: "half",
      } as RequestInit,
    );
    for (const request of [
      streamedRequest([encode('{"private-marker":')]),
      failedStream,
    ]) {
      expect(await readOAuthClientRequest(request)).toEqual({
        status: 400,
        body: { error: "invalid_json" },
      });
    }
  });
});
