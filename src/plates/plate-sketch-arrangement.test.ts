import { describe, expect, test } from "vitest";
import {
  arrangePlateSketchDefaults,
  countWarpedPlateSketchCorners,
  defaultPlateSketchPlacement,
  serializePlateSketchPlacement,
} from "./plate-sketch-arrangement.js";
import { DEFAULT_ACTIVE_PLATE_INDEX, DEFAULT_PLATE_PLACEMENTS } from "./default-plate-profile.js";
import { normalizePlatePlacement } from "./plate-placement.js";

describe("plate sketch arrangement", () => {
  test("uses captured default profile placements when the default plate count matches", () => {
    const plates = DEFAULT_PLATE_PLACEMENTS.map(() => ({ aspect: 1.25 }));
    const arrangement = arrangePlateSketchDefaults(plates);

    expect(arrangement.activeIndex).toBe(DEFAULT_ACTIVE_PLATE_INDEX);
    expect(arrangement.placements).toHaveLength(DEFAULT_PLATE_PLACEMENTS.length);
    expect(arrangement.placements[0].azimuth).toBeCloseTo(DEFAULT_PLATE_PLACEMENTS[0].azimuth);
    expect(arrangement.placements[0].scale).toBeCloseTo(DEFAULT_PLATE_PLACEMENTS[0].scale);
  });

  test("falls back to golden-angle placement for custom plate counts", () => {
    const first = defaultPlateSketchPlacement(0, 2, { aspect: 2 });
    const second = defaultPlateSketchPlacement(1, 2, { aspect: 2 });

    expect(first).toMatchObject({
      azimuth: -180,
      radius: 0.16,
      scale: 0.834386001800126,
      spin: 0,
      opacity: 1,
      flipX: false,
      flipY: false,
      aspect: 2,
    });
    expect(second.azimuth).toBeCloseTo(-42.492236);
    expect(second.radius).toBeCloseTo(0.94);
  });

  test("serializes placement values with commit precision and counts warped corners", () => {
    const placement = normalizePlatePlacement(
      {
        azimuth: 12.345678,
        radius: 0.3333333,
        scale: 0.7777777,
        spin: -9.876543,
        opacity: 0.5555555,
        flipX: true,
        flipY: false,
        cornerOffsets: {
          nw: { x: 0.00001, y: 0 },
          ne: { x: 0.2, y: 0 },
          se: { x: 0, y: -0.15 },
          sw: { x: 0, y: 0 },
        },
      },
      { aspect: 1 },
    );

    const serialized = serializePlateSketchPlacement(placement);

    expect(serialized).toMatchObject({
      azimuth: 12.3457,
      radius: 0.3333,
      scale: 0.7778,
      spin: -9.8765,
      opacity: 0.5556,
      flipX: true,
      flipY: false,
    });
    expect(serialized.cornerOffsets.nw.x).toBe(0);
    expect(countWarpedPlateSketchCorners([serialized])).toBe(2);
  });
});
