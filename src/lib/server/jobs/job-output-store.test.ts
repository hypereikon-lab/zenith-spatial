import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { createFileJobOutputStore } from "./job-output-store.js";
import { jobOutputResponse, parseByteRange } from "./job-output-response.js";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("job output storage", () => {
  test("stores content-addressed provider media and serves byte ranges", async () => {
    const rootDir = temporaryRoot();
    const store = createFileJobOutputStore({ rootDir });
    const bytes = new TextEncoder().encode("0123456789");
    const output = await store.store("job_output_1", {
      body: new Blob([bytes]).stream(),
      contentLength: bytes.byteLength,
      contentType: "image/png",
      sourceUrl: "https://provider.invalid/ephemeral.png",
      index: 0,
    });
    const outputId = output.url.split("/").at(-1) || "";

    expect(output).toMatchObject({ contentType: "image/png", name: expect.stringMatching(/\.png$/) });
    expect(output.url).not.toContain("provider.invalid");
    await expect(store.get("job_output_1", outputId)).resolves.toMatchObject({ byteLength: 10 });

    const response = await jobOutputResponse(
      "job_output_1",
      outputId,
      new Request("http://localhost/output", { headers: { Range: "bytes=2-5" } }),
      store,
    );
    expect(response.status).toBe(206);
    expect(response.headers.get("content-range")).toBe("bytes 2-5/10");
    expect(response.headers.get("accept-ranges")).toBe("bytes");
    expect(await response.text()).toBe("2345");
  });

  test("validates suffix, open-ended, and unsatisfiable byte ranges", () => {
    expect(parseByteRange("bytes=-3", 10)).toEqual({ start: 7, end: 9 });
    expect(parseByteRange("bytes=4-", 10)).toEqual({ start: 4, end: 9 });
    expect(parseByteRange("bytes=10-12", 10)).toBe("invalid");
    expect(parseByteRange("bytes=5-4", 10)).toBe("invalid");
    expect(parseByteRange("bytes=0-1,4-5", 10)).toBe("invalid");
  });
});

function temporaryRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "zenith-job-output-"));
  roots.push(root);
  return root;
}
