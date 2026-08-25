import { describe, expect, test } from "vitest";
import { readFromArrayBuffer } from "typegpu";
import { sizeOf } from "typegpu/data";
import { encodeTypeGpuData } from "./encoding.js";
import { plateCompositeUniformSchema, plateGuideUniformSchema, projectionPreviewUniformSchema } from "./contracts.js";
import { compileProjectionKernelParams } from "../../geometry/projection-kernel-parameters.js";

describe("TypeGPU browser rendering contracts", () => {
  test("keeps the raw WGSL-compatible record sizes explicit", () => {
    expect(sizeOf(projectionPreviewUniformSchema)).toBe(416);
    expect(sizeOf(plateCompositeUniformSchema)).toBe(400);
    expect(sizeOf(plateGuideUniformSchema)).toBe(288);
  });

  test("round-trips named guide semantics without a handwritten byte offset", () => {
    const value = {
      projection: compileProjectionKernelParams({
        mode: "cylinder-wall",
        width: 1920,
        height: 1080,
        innerSplit: 0.64,
      }),
      lineWidth: 1 / 1080,
    };
    const encoded = encodeTypeGpuData(plateGuideUniformSchema, value);
    const decoded = readFromArrayBuffer(encoded.buffer as ArrayBuffer, plateGuideUniformSchema);

    expect(decoded.projection.mode).toBe(value.projection.mode);
    expect(decoded.projection.topology).toBe(value.projection.topology);
    expect(decoded.projection.innerSplit).toBeCloseTo(0.64);
    expectVectorClose(decoded.projection.rasterSize, value.projection.rasterSize);
    expect(decoded.lineWidth).toBeCloseTo(value.lineWidth);
  });
});

function expectVectorClose(actual: readonly number[], expected: readonly number[]): void {
  expect(actual).toHaveLength(expected.length);
  for (let index = 0; index < expected.length; index += 1) {
    expect(actual[index]).toBeCloseTo(expected[index]);
  }
}
