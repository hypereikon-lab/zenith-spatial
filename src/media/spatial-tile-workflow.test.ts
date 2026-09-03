import { describe, expect, test } from "vitest";

import { FULLDOME_MASTER_DIMENSION, resolveSpatialTileOutputSize } from "./spatial-tile-workflow.js";

describe("spatial tile reconstruction output", () => {
  const source = { targetWidth: 1920, targetHeight: 1920 };

  test("pins an externally processed tile set to the exact 4K domemaster raster", () => {
    expect(
      resolveSpatialTileOutputSize(source, 1.875, {
        width: FULLDOME_MASTER_DIMENSION,
        height: FULLDOME_MASTER_DIMENSION,
      }),
    ).toEqual({ width: 4096, height: 4096 });
  });

  test("keeps scale-derived dimensions for legacy reconstruction", () => {
    expect(resolveSpatialTileOutputSize(source, 1.875)).toEqual({ width: 3600, height: 3600 });
  });

  test("accepts 4K within the browser memory guard", () => {
    expect(() => resolveSpatialTileOutputSize(source, 1, { width: 4096, height: 4096 })).not.toThrow();
  });

  test("rejects an unsafe scale-derived 7200 square master", () => {
    expect(() => resolveSpatialTileOutputSize(source, 3.75)).toThrow("7200×7200");
  });
});
