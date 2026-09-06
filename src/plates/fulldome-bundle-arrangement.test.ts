import { describe, expect, test } from "vitest";

import { DEFAULT_PLATE_PLACEMENTS } from "./default-plate-profile.js";
import { arrangeFulldomeBundle, isFulldomeBundleSize } from "./fulldome-bundle-arrangement.js";

describe("fulldome bundle arrangement", () => {
  test("places the chosen trio source in the captured Plate 03 zenith slot", () => {
    const arrangement = arrangeFulldomeBundle([{ aspect: 1 }, { aspect: 1.5 }, { aspect: 2 }], {
      zenithIndex: 1,
    });

    expect(arrangement.slots).toEqual(["field-primary", "zenith", "field-secondary"]);
    expect(arrangement.activeIndex).toBe(1);
    expect(arrangement.placements[1]).toMatchObject(DEFAULT_PLATE_PLACEMENTS[2]);
    expect(arrangement.placements[0]).toMatchObject(DEFAULT_PLATE_PLACEMENTS[0]);
    expect(arrangement.placements[2]).toMatchObject(DEFAULT_PLATE_PLACEMENTS[1]);
  });

  test("supports a curated pair without inventing a third source", () => {
    const arrangement = arrangeFulldomeBundle([{ aspect: 1 }, { aspect: 2 }], { zenithIndex: 0 });

    expect(arrangement.slots).toEqual(["zenith", "field-primary"]);
    expect(arrangement.placements[0].scale).toBeCloseTo(DEFAULT_PLATE_PLACEMENTS[2].scale);
    expect(arrangement.placements[1].scale).toBeCloseTo(DEFAULT_PLATE_PLACEMENTS[0].scale);
  });

  test("mirrors spatial coordinates but never flips source pixels", () => {
    const profile = arrangeFulldomeBundle([{ aspect: 1 }, { aspect: 1 }], { zenithIndex: 1 });
    const mirrored = arrangeFulldomeBundle([{ aspect: 1 }, { aspect: 1 }], {
      zenithIndex: 1,
      orientation: "mirrored",
    });

    expect(mirrored.placements[0].azimuth).toBeCloseTo(-profile.placements[0].azimuth);
    expect(mirrored.placements[0].spin).toBeCloseTo(-profile.placements[0].spin);
    expect(mirrored.placements.every((placement) => !placement.flipX && !placement.flipY)).toBe(true);
  });

  test("rejects ambiguous source counts and invalid zenith assignments", () => {
    expect(() => arrangeFulldomeBundle([{ aspect: 1 }], { zenithIndex: 0 })).toThrow(/exactly 2 or 3/);
    expect(() => arrangeFulldomeBundle([{ aspect: 1 }, { aspect: 1 }], { zenithIndex: 2 })).toThrow(
      /outside this 2-source bundle/,
    );
    expect(isFulldomeBundleSize(2)).toBe(true);
    expect(isFulldomeBundleSize(4)).toBe(false);
  });
});
