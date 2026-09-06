import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, test } from "vitest";

import { finalizeRunwayImageReceipt, prepareRunwayImageRequest } from "./runway-image-receipt.mjs";

describe("Runway image generation provenance", () => {
  test("pins two outputs, ordered direct references, prompt, and provider task ids", () => {
    const root = mkdtempSync(join(tmpdir(), "zenith-runway-receipt-"));
    const referenceA = join(root, "a.jpg");
    const referenceB = join(root, "b.png");
    const outputA = join(root, "01.png");
    const outputB = join(root, "02.png");
    const requestReceipt = join(root, "request.json");
    writeFileSync(referenceA, "A");
    writeFileSync(referenceB, "B");
    writeFileSync(outputA, "ONE");
    writeFileSync(outputB, "TWO");
    const job = {
      recipeId: "D01",
      prompt: "Create one continuous ecosystem.",
      count: 2,
      references: [
        { path: referenceA, role: "primary" },
        { path: referenceB, role: "donor" },
      ],
      outputs: [outputA, outputB],
      providerTaskIds: ["runway-task-01"],
      requestReceipt,
    };
    const prepared = prepareRunwayImageRequest(job, { createdAt: "2026-09-06T12:00:00.000Z" });
    writeFileSync(requestReceipt, `${JSON.stringify(prepared)}\n`);
    const receipt = finalizeRunwayImageReceipt(job, JSON.parse(readFileSync(requestReceipt, "utf8")));

    expect(receipt).toMatchObject({
      schema: "zenith.runway-image-generation.v1",
      provider: "runway",
      invocation: "runway-mcp",
      count: 2,
      providerTaskIds: ["runway-task-01"],
    });
    expect(receipt.references.map(({ role }) => role)).toEqual(["primary", "donor"]);
    expect(receipt.outputs.map(({ index, filename }) => [index, filename])).toEqual([
      [0, "01.png"],
      [1, "02.png"],
    ]);
  });

  test("rejects counts other than two", () => {
    expect(() =>
      prepareRunwayImageRequest({ recipeId: "bad", prompt: "x", count: 3, references: [], outputs: [] }),
    ).toThrow(/exactly 2 images/);
  });

  test("records the Runway MCP invocation mechanism in both request and generation receipts", () => {
    const root = mkdtempSync(join(tmpdir(), "zenith-runway-http-receipt-"));
    const reference = join(root, "reference.jpg");
    const outputA = join(root, "01.png");
    const outputB = join(root, "02.png");
    const requestReceipt = join(root, "request.json");
    for (const [path, bytes] of [
      [reference, "REFERENCE"],
      [outputA, "ONE"],
      [outputB, "TWO"],
    ]) {
      writeFileSync(path, bytes);
    }
    const job = {
      recipeId: "E01",
      invocation: "runway-mcp",
      prompt: "Create one continuous ecosystem.",
      references: [reference],
      outputs: [outputA, outputB],
      providerTaskIds: ["runway-task-01", "runway-task-02"],
      requestReceipt,
    };
    const prepared = prepareRunwayImageRequest(job, { createdAt: "2026-09-06T12:00:00.000Z" });
    writeFileSync(requestReceipt, `${JSON.stringify(prepared)}\n`);
    const receipt = finalizeRunwayImageReceipt(job, prepared);

    expect(prepared.invocation).toBe("runway-mcp");
    expect(receipt.invocation).toBe("runway-mcp");
  });

  test("can require a pixel-vision review before preparing a paid request", () => {
    const root = mkdtempSync(join(tmpdir(), "zenith-runway-review-gate-"));
    const reference = join(root, "reference.jpg");
    writeFileSync(reference, "REFERENCE");

    expect(() =>
      prepareRunwayImageRequest({
        recipeId: "E01",
        requireReferenceReview: true,
        prompt: "Create one continuous ecosystem.",
        references: [reference],
        outputs: [join(root, "01.png"), join(root, "02.png")],
      }),
    ).toThrow(/referenceReviewReceipt is required/);
  });
});
