import { describe, expect, test } from "vitest";
import { MAX_JSON_BYTES } from "./config";
import { readJsonPayload, streamProgressResponse } from "./route-response";

describe("server route response helpers", () => {
  test("parses JSON object payloads", async () => {
    const payload = await readJsonPayload(jsonRequest(JSON.stringify({ prompt: "repair the dome" })));

    expect(payload).toEqual({ prompt: "repair the dome" });
  });

  test("rejects malformed JSON as a bad request", async () => {
    await expect(readJsonPayload(jsonRequest("{"))).rejects.toMatchObject({
      status: 400,
      message: "Request body must be valid JSON.",
    });
  });

  test("rejects non-object JSON payloads", async () => {
    await expect(readJsonPayload(jsonRequest("[]"))).rejects.toMatchObject({
      status: 400,
      message: "Request body must be a JSON object.",
    });
  });

  test("rejects oversized requests from content length before parsing", async () => {
    const request = jsonRequest("{}", {
      "content-length": String(MAX_JSON_BYTES + 1),
    });

    await expect(readJsonPayload(request)).rejects.toMatchObject({
      status: 413,
      message: "Request is too large.",
    });
  });

  test("aborts the running job when the response stream is cancelled", async () => {
    let jobSignal: AbortSignal | undefined;
    let resolveSignalReady: () => void = () => {};
    const signalReady = new Promise<void>((resolve) => {
      resolveSignalReady = resolve;
    });

    const response = streamProgressResponse(
      (_onProgress, options) =>
        new Promise((_resolve, reject) => {
          jobSignal = options.signal;
          resolveSignalReady();
          options.signal?.addEventListener("abort", () => reject(options.signal?.reason), { once: true });
        }),
      "Runway request failed",
    );

    await signalReady;
    await response.body?.cancel("client disconnected");

    expect(jobSignal?.aborted).toBe(true);
    expect(jobSignal?.reason).toMatchObject({
      status: 499,
      message: "Response stream was cancelled.",
    });
  });

  test("aborts the running job when the request signal aborts", async () => {
    const requestAbort = new AbortController();
    let jobSignal: AbortSignal | undefined;
    let resolveSignalReady: () => void = () => {};
    const signalReady = new Promise<void>((resolve) => {
      resolveSignalReady = resolve;
    });

    streamProgressResponse(
      (_onProgress, options) =>
        new Promise((_resolve, reject) => {
          jobSignal = options.signal;
          resolveSignalReady();
          options.signal?.addEventListener("abort", () => reject(options.signal?.reason), { once: true });
        }),
      "Runway request failed",
      requestAbort.signal,
    );

    await signalReady;
    requestAbort.abort(new Error("browser aborted"));

    expect(jobSignal?.aborted).toBe(true);
    expect(jobSignal?.reason).toBeInstanceOf(Error);
    expect((jobSignal?.reason as Error).message).toBe("browser aborted");
  });
});

function jsonRequest(body: string, headers: Record<string, string> = {}): Request {
  return new Request("http://localhost/api/runway/inpaint", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...headers,
    },
    body,
  });
}
