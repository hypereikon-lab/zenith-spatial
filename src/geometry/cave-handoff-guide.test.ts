import { describe, expect, test } from "vitest";
import {
  CAVE_HANDOFF_GUIDE,
  caveGuideFloorBands,
  caveGuideHorizonBand,
  caveGuidePromptClause,
  caveGuideWallBands,
  caveGuideWallColor,
} from "./cave-handoff-guide.js";

describe("CAVE handoff guide contract", () => {
  test("defines a quiet floor zone, sparse wall bands, and horizon from one floor-band value", () => {
    const floorBand = CAVE_HANDOFF_GUIDE.floorBand;
    expect(caveGuideFloorBands()).toEqual([]);
    expect(caveGuideWallBands()).toEqual([
      (floorBand + caveGuideHorizonBand(floorBand)) * 0.5,
      caveGuideHorizonBand(floorBand) + (1 - caveGuideHorizonBand(floorBand)) * 0.5,
    ]);
    expect(caveGuideHorizonBand()).toBeCloseTo(floorBand + (1 - floorBand) * 0.5, 10);
    expect(caveGuideWallBands(0.5)).toEqual([0.625, 0.875]);
    expect(caveGuideHorizonBand(0.5)).toBeCloseTo(0.75, 10);
    expect(caveGuideHorizonBand(1 / 3, 0.58)).toBeCloseTo(0.58, 10);
    expect(caveGuideWallBands(1 / 3, 0.58)).toEqual([(1 / 3 + 0.58) * 0.5, 0.79]);
  });

  test("keeps optional contour density outside the committed field", () => {
    expect(CAVE_HANDOFF_GUIDE.noFloorSpokes).toBe(true);
    expect(CAVE_HANDOFF_GUIDE.wallRayCount).toBe(12);
    expect(CAVE_HANDOFF_GUIDE.wallRayCount).toBe(CAVE_HANDOFF_GUIDE.baseSpokeCount);
    expect(CAVE_HANDOFF_GUIDE.wallRayIntervalRadians).toBeCloseTo(Math.PI / 6, 10);
  });

  test("exposes the same scaffold vocabulary used by prompts", () => {
    const prompt = caveGuidePromptClause();
    expect(prompt).toContain("green center is missing floor-source content");
    expect(caveGuidePromptClause(0.5)).toContain("floor-to-wall anchor is 50% from the center");
    expect(caveGuidePromptClause(0.5)).toContain("eye-level anchor is 75% from the center");
    expect(caveGuidePromptClause(0.5, 0.62)).toContain("eye-level anchor is 62% from the center");
    expect(prompt).toContain("first authored color stop");
    expect(prompt).toContain("aqua lower-wall and blue upper-wall source regions");
    expect(prompt).toContain("seam-continuous hue tint encodes direction");
    expect(prompt).not.toContain("black");
    expect(prompt).not.toContain("grid rays");
  });

  test("keeps legacy diagnostic color selectors stable", () => {
    expect(caveGuideWallColor(0)).toEqual([...CAVE_HANDOFF_GUIDE.colors.lowerWall]);
    expect(caveGuideWallColor(0.49)).toEqual([...CAVE_HANDOFF_GUIDE.colors.lowerWall]);
    expect(caveGuideWallColor(0.5)).toEqual([...CAVE_HANDOFF_GUIDE.colors.upperWall]);
    expect(caveGuideWallColor(1)).toEqual([...CAVE_HANDOFF_GUIDE.colors.upperWall]);
  });
});
