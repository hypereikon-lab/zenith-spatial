import { describe, expect, test } from "vitest";
import { readProgressStream } from "./progress-stream";

describe("readProgressStream", () => {
  test("returns the complete event result", async () => {
    const result = await readProgressStream(ndjsonResponse([{ type: "complete", result: { ok: true } }]));

    expect(result).toEqual({ ok: true });
  });

  test("reports malformed progress events with a useful request error", async () => {
    await expect(
      readProgressStream(textResponse("{not json}\n"), {
        errorPrefix: "Runway request failed",
      }),
    ).rejects.toThrow("Runway request failed: received malformed progress event.");
  });

  test("normalizes progress callbacks to the 0..1 range", async () => {
    const progress: number[] = [];

    await readProgressStream(
      ndjsonResponse([
        { type: "progress", stage: "Uploading", progress: 1.5 },
        { type: "progress", stage: "Queued", progress: -0.2 },
        { type: "progress", stage: "Unknown", progress: "not numeric" },
        { type: "complete", result: { ok: true } },
      ]),
      {
        onProgress: (_stage, value) => progress.push(value),
      },
    );

    expect(progress).toEqual([1, 0, 0, 1]);
  });

  test("reports structured job errors and cancellations", async () => {
    await expect(
      readProgressStream(ndjsonResponse([{ type: "error", error: { message: "Runway task failed.", status: 502 } }])),
    ).rejects.toThrow("Runway task failed.");

    await expect(
      readProgressStream(
        ndjsonResponse([{ type: "cancelled", error: { message: "Job was cancelled.", status: 499 } }]),
      ),
    ).rejects.toThrow("Job was cancelled.");
  });
});

function ndjsonResponse(events: unknown[]): Response {
  return textResponse(events.map((event) => JSON.stringify(event)).join("\n") + "\n");
}

function textResponse(text: string): Response {
  return new Response(text, {
    headers: {
      "content-type": "application/x-ndjson",
    },
  });
}
