import { afterEach, describe, expect, test, vi } from "vitest";
import { cancelRunwayTask, downloadTaskOutputs } from "./http.js";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Runway HTTP boundary", () => {
  test("streams provider output bodies into the durable sink", async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response("VIDEO-BYTES", {
          headers: { "Content-Type": "video/mp4", "Content-Length": "11" },
        }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const outputSink = vi.fn(async (input) => ({
      url: "/api/jobs/job-1/outputs/output-1",
      contentType: input.contentType,
      name: "output.mp4",
      bodyText: await new Response(input.body).text(),
    }));

    const outputs = await downloadTaskOutputs(["https://provider.invalid/output.mp4"], undefined, 0.9, 0.98, {
      outputSink,
    });

    expect(outputSink).toHaveBeenCalledTimes(1);
    expect(outputSink.mock.calls[0][0]).toMatchObject({ contentLength: 11, contentType: "video/mp4", index: 0 });
    expect(outputs).toEqual([
      {
        url: "/api/jobs/job-1/outputs/output-1",
        contentType: "video/mp4",
        name: "output.mp4",
        bodyText: "VIDEO-BYTES",
      },
    ]);
  });

  test("uses the documented provider deletion endpoint and treats 404 as idempotent", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
      .mockResolvedValueOnce(Response.json({ error: "gone" }, { status: 404 }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(cancelRunwayTask("secret", "task-id-1")).resolves.toBeUndefined();
    await expect(cancelRunwayTask("secret", "task-id-1")).resolves.toBeUndefined();
    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      expect.stringMatching(/\/v1\/tasks\/task-id-1$/),
      expect.objectContaining({ method: "DELETE" }),
    );
  });
});
