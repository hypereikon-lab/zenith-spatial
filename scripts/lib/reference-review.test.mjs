import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";

import { createReferenceReview, verifyApprovedReferences } from "./reference-review.mjs";

describe("pixel-vision reference review", () => {
  test("approves only byte-identical reviewed images", () => {
    const root = mkdtempSync(join(tmpdir(), "zenith-reference-review-"));
    const approved = join(root, "forest.jpg");
    const rejected = join(root, "road.jpg");
    const receiptPath = join(root, "review.json");
    writeFileSync(approved, "FOREST");
    writeFileSync(rejected, "ROAD");
    const receipt = createReferenceReview([
      { path: approved, decision: "approved" },
      { path: rejected, decision: "rejected", reasons: ["road"] },
    ]);
    writeFileSync(receiptPath, JSON.stringify(receipt));

    expect(
      verifyApprovedReferences([{ filename: "forest.jpg", sha256: receipt.entries[0].sha256 }], receiptPath),
    ).toMatchObject({ reviewDigest: receipt.reviewDigest, reviewedImageCount: 1 });
    expect(() =>
      verifyApprovedReferences([{ filename: "road.jpg", sha256: receipt.entries[1].sha256 }], receiptPath),
    ).toThrow(/rejected/);
  });

  test("detects review-file tampering", () => {
    const root = mkdtempSync(join(tmpdir(), "zenith-reference-review-"));
    const image = join(root, "forest.jpg");
    const receiptPath = join(root, "review.json");
    writeFileSync(image, "FOREST");
    const receipt = createReferenceReview([{ path: image, decision: "approved" }]);
    receipt.entries[0].decision = "rejected";
    writeFileSync(receiptPath, JSON.stringify(receipt));
    expect(() =>
      verifyApprovedReferences([{ filename: "forest.jpg", sha256: receipt.entries[0].sha256 }], receiptPath),
    ).toThrow(/digest/);
  });
});
