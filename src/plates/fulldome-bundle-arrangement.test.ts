import { describe, expect, test } from "vitest";

import { sourceDirectionToMapPoint } from "../geometry/source-projection.js";
import { wrapDegrees } from "../projection.js";
import {
  FULLDOME_BUNDLE_LAYOUT,
  FULLDOME_BUNDLE_PROFILE,
  FULLDOME_PAIR_PROFILE,
  arrangeFulldomeBundle,
  isFulldomeBundleSize,
} from "./fulldome-bundle-arrangement.js";
import { directionFromPlateUv, preparePlatePlacement } from "./plate-placement.js";

describe("fulldome bundle arrangement", () => {
  test("places the chosen trio source large and upper, with substantial front sources", () => {
    const arrangement = arrangeFulldomeBundle([{ aspect: 1 }, { aspect: 1.5 }, { aspect: 2 }], {
      dominantIndex: 1,
    });

    expect(arrangement.layout).toBe(FULLDOME_BUNDLE_LAYOUT);
    expect(arrangement.slots).toEqual(["front-left", "upper-dominant", "front-right"]);
    expect(arrangement.activeIndex).toBe(1);
    expect(arrangement.placements[1]).toMatchObject(FULLDOME_BUNDLE_PROFILE["upper-dominant"]);
    expect(arrangement.placements[0]).toMatchObject(FULLDOME_BUNDLE_PROFILE["front-left"]);
    expect(arrangement.placements[2]).toMatchObject(FULLDOME_BUNDLE_PROFILE["front-right"]);
    expect(Math.min(arrangement.placements[0].scale, arrangement.placements[2].scale)).toBeGreaterThan(1.6);
    expect(arrangement.placements[1].scale).toBeGreaterThan(arrangement.placements[0].scale);
  });

  test("supports a curated pair without inventing a third source", () => {
    const arrangement = arrangeFulldomeBundle([{ aspect: 1 }, { aspect: 2 }], { dominantIndex: 0 });

    expect(arrangement.slots).toEqual(["upper-dominant", "front-center"]);
    expect(arrangement.placements[0].azimuth).toBeCloseTo(FULLDOME_PAIR_PROFILE["upper-dominant"].azimuth);
    expect(arrangement.placements[0].radius).toBeCloseTo(FULLDOME_PAIR_PROFILE["upper-dominant"].radius);
    expect(arrangement.placements[0].scale).toBeCloseTo(FULLDOME_PAIR_PROFILE["upper-dominant"].scale);
    expect(arrangement.placements[0].spin).toBeCloseTo(FULLDOME_PAIR_PROFILE["upper-dominant"].spin);
    expect(arrangement.placements[1].azimuth).toBeCloseTo(FULLDOME_PAIR_PROFILE["front-center"].azimuth);
    expect(arrangement.placements[1].radius).toBeCloseTo(FULLDOME_PAIR_PROFILE["front-center"].radius);
    expect(arrangement.placements[1].scale).toBeCloseTo(FULLDOME_PAIR_PROFILE["front-center"].scale);
    expect(arrangement.placements[1].spin).toBeCloseTo(FULLDOME_PAIR_PROFILE["front-center"].spin);
  });

  test("aligns every source top edge inward toward the central zenith", () => {
    const arrangement = arrangeFulldomeBundle([{ aspect: 16 / 9 }, { aspect: 16 / 9 }, { aspect: 16 / 9 }], {
      dominantIndex: 0,
    });

    for (const placement of arrangement.placements) {
      const prepared = preparePlatePlacement(placement, { aspect: 16 / 9 }, "zenith-180");
      const top = sourceDirectionToMapPoint(directionFromPlateUv(prepared, 0.5, 0), "zenith-180", 2, 2, 1);
      const bottom = sourceDirectionToMapPoint(directionFromPlateUv(prepared, 0.5, 1), "zenith-180", 2, 2, 1);
      expect(top).not.toBeNull();
      expect(bottom).not.toBeNull();
      expect(top!.radius).toBeLessThan(bottom!.radius);
    }
  });

  test("mirrors spatial coordinates but never flips source pixels", () => {
    const profile = arrangeFulldomeBundle([{ aspect: 1 }, { aspect: 1 }], { dominantIndex: 1 });
    const mirrored = arrangeFulldomeBundle([{ aspect: 1 }, { aspect: 1 }], {
      dominantIndex: 1,
      orientation: "mirrored",
    });

    expect(mirrored.placements[0].azimuth).toBeCloseTo(wrapDegrees(-profile.placements[0].azimuth));
    expect(mirrored.placements[0].spin).toBeCloseTo(wrapDegrees(-profile.placements[0].spin));
    expect(mirrored.placements.every((placement) => !placement.flipX && !placement.flipY)).toBe(true);
  });

  test("accepts the legacy option only as an equivalent alias", () => {
    const arrangement = arrangeFulldomeBundle([{ aspect: 1 }, { aspect: 1 }], { zenithIndex: 1 });
    expect(arrangement.dominantIndex).toBe(1);
    expect(() => arrangeFulldomeBundle([{ aspect: 1 }, { aspect: 1 }], { dominantIndex: 0, zenithIndex: 1 })).toThrow(
      /conflicts/,
    );
  });

  test("rejects ambiguous source counts and invalid dominant assignments", () => {
    expect(() => arrangeFulldomeBundle([{ aspect: 1 }], { dominantIndex: 0 })).toThrow(/exactly 2 or 3/);
    expect(() => arrangeFulldomeBundle([{ aspect: 1 }, { aspect: 1 }], { dominantIndex: 2 })).toThrow(
      /outside this 2-source bundle/,
    );
    expect(isFulldomeBundleSize(2)).toBe(true);
    expect(isFulldomeBundleSize(4)).toBe(false);
  });
});
