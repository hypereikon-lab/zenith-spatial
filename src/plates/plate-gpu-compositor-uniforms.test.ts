import { describe, expect, test } from "vitest";
import { readFromArrayBuffer } from "typegpu";
import { plateCompositeUniformSchema, plateGuideUniformSchema } from "../graphics/typegpu/contracts.js";
import {
  guideUniformData,
  guideUniformValue,
  placementUniformData,
  placementUniformValue,
} from "./plate-gpu-compositor-uniforms.js";
import { PLATE_UNIFORM_FLOATS } from "./plate-gpu-compositor-types.js";

describe("plate compositor projection uniforms", () => {
  test.each([
    ["cave-270", 3, 1, [4, 4, 4], [0, 2, 0], [0, 0, 0]],
    [
      "hall-double-gable",
      7,
      4,
      [Math.fround(22.55), Math.fround(23.143), Math.fround(9.39)],
      [0, Math.fround(1.65), 0],
      [0, 0, 0],
    ],
    ["cylinder-nadir", 4, 2, [0, 0, 0], [0, 0, 0], [2, 4, 2]],
    ["cylinder-zenith", 5, 2, [0, 0, 0], [0, 0, 0], [2, 4, 2]],
    ["cylinder-wall", 6, 3, [0, 0, 0], [0, 0, 0], [2, 4, 2]],
  ] as const)(
    "packs authoritative kernel parameters for %s",
    (mode, modeCode, topology, boxSize, boxObserver, cylinder) => {
      const input = {
        placement: { radius: 0.5, azimuth: 30, scale: 0.7 },
        plate: { canvas: {} as HTMLCanvasElement, width: 100, height: 100, aspect: 1 },
        plateFit: "contain",
        plateFeather: 0.02,
        outputWidth: 1024,
        outputHeight: 1024,
        sourceProjectionMode: mode,
      };
      const data = placementUniformData(input);
      const decoded = readFromArrayBuffer(data.buffer as ArrayBuffer, plateCompositeUniformSchema);
      expect(data).toHaveLength(PLATE_UNIFORM_FLOATS);
      expect(decoded.projection.mode).toBe(modeCode);
      expect(decoded.projection.topology).toBe(topology);
      expect(Array.from(decoded.projection.boxSize)).toEqual(boxSize);
      expect(Array.from(decoded.projection.boxObserver)).toEqual(boxObserver);
      expect(Array.from(decoded.projection.cylinder)).toEqual(cylinder);
      expect(placementUniformValue(input)).toMatchObject({ projection: { mode: modeCode, topology } });
    },
  );

  test("encodes cylinder guide topology and tiny cap constraints", () => {
    const nadir = guideUniformData(1024, 1024, "cylinder-nadir", 0, undefined);
    const zenith = guideUniformData(1024, 1024, "cylinder-zenith", 0.8, 0.9);
    const decodedNadir = readFromArrayBuffer(nadir.buffer as ArrayBuffer, plateGuideUniformSchema);
    const decodedZenith = readFromArrayBuffer(zenith.buffer as ArrayBuffer, plateGuideUniformSchema);
    expect(decodedNadir.projection.mode).toBe(4);
    expect(decodedNadir.projection.topology).toBe(2);
    expect(decodedNadir.projection.center).toBe(1);
    expect(decodedNadir.projection.innerSplit).toBeCloseTo(0.005, 8);
    expect(decodedNadir.projection.horizonSplit).toBeCloseTo(0.5025, 7);
    expect(decodedNadir.lineWidth).toBeCloseTo(1 / 1024, 10);
    expect(decodedZenith.projection.mode).toBe(5);
    expect(decodedZenith.projection.center).toBe(0);
    expect(decodedZenith.projection.innerSplit).toBe(0.25);
    expect(decodedZenith.projection.horizonSplit).toBeCloseTo(0.9, 7);
    const value = guideUniformValue(1024, 1024, "cylinder-nadir", 0);
    expect(value).toMatchObject({
      projection: { mode: 4, topology: 2, center: 1 },
      lineWidth: 1 / 1024,
    });
    expect(value.projection.innerSplit).toBeCloseTo(0.005, 8);
    expect(value.projection.horizonSplit).toBeCloseTo(0.5025, 7);
  });

  test("can rasterize the tiny cylinder cap at full texture radius without moving authored plates", () => {
    const input = {
      placement: { radius: 0.01, azimuth: 30, scale: 0.7 },
      plate: { canvas: {} as HTMLCanvasElement, width: 100, height: 100, aspect: 1 },
      plateFit: "contain",
      plateFeather: 0.02,
      outputWidth: 1024,
      outputHeight: 1024,
      sourceProjectionMode: "cylinder-zenith" as const,
      domeGuideSemanticSplit: 0.02,
    };
    const carrier = placementUniformData(input);
    const capDetail = placementUniformData({ ...input, rasterInnerSplit: 1 });
    const carrierDecoded = readFromArrayBuffer(carrier.buffer as ArrayBuffer, plateCompositeUniformSchema);
    const capDetailDecoded = readFromArrayBuffer(capDetail.buffer as ArrayBuffer, plateCompositeUniformSchema);

    expect(capDetailDecoded.projection.innerSplit).toBe(1);
    expect(Array.from(capDetailDecoded.plate.center)).toEqual(Array.from(carrierDecoded.plate.center));
    expect(Array.from(capDetailDecoded.plate.right)).toEqual(Array.from(carrierDecoded.plate.right));
    expect(Array.from(capDetailDecoded.plate.down)).toEqual(Array.from(carrierDecoded.plate.down));
    expect(Array.from(capDetailDecoded.plate.angularSize)).toEqual(Array.from(carrierDecoded.plate.angularSize));
    expect(Array.from(capDetailDecoded.plate.spin)).toEqual(Array.from(carrierDecoded.plate.spin));
    expect(Array.from(capDetailDecoded.plate.warpNorth)).toEqual(Array.from(carrierDecoded.plate.warpNorth));
    expect(Array.from(capDetailDecoded.plate.warpSouth)).toEqual(Array.from(carrierDecoded.plate.warpSouth));
  });

  test("encodes the unwrapped cylinder as a full-frame wall guide", () => {
    const wall = guideUniformData(1920, 1080, "cylinder-wall", 0.64, 1);
    const decoded = readFromArrayBuffer(wall.buffer as ArrayBuffer, plateGuideUniformSchema);
    expect(decoded.projection.mode).toBe(6);
    expect(decoded.projection.topology).toBe(3);
    expect(decoded.projection.domain).toBe(2);
    expect(decoded.projection.innerSplit).toBeCloseTo(0.64, 7);
    expect(decoded.projection.horizonSplit).toBe(1);
    expect(decoded.lineWidth).toBeCloseTo(1 / 1080, 10);
  });
});
