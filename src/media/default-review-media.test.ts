import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";

import { readImageByteDimensions } from "./image-byte-dimensions.js";
import { DEFAULT_REVIEW_MEDIA_ID, defaultReviewMediaAsset } from "./default-review-media.js";

const DEMO_PATH = fileURLToPath(new URL("../../public/demo-media/forest-domemaster-180.png", import.meta.url));

describe("default Review media", () => {
  test("keeps the exact 1920 square domemaster demo bytes", () => {
    const bytes = readFileSync(DEMO_PATH);
    const asset = defaultReviewMediaAsset("2026-08-26T12:00:00.000Z");

    expect(asset).toMatchObject({
      id: DEFAULT_REVIEW_MEDIA_ID,
      filename: "forest-domemaster-180.png",
      mime: "image/png",
      width: 1920,
      height: 1920,
      storageRef: "/demo-media/forest-domemaster-180.png",
    });
    expect(readImageByteDimensions(bytes)).toEqual({ width: 1920, height: 1920 });
    expect(createHash("sha256").update(bytes).digest("hex")).toBe(
      "c7693a0f9061b3ca2958c62df256bb0e0ee863ff26322bc187bdf12221c44760",
    );
  });
});
