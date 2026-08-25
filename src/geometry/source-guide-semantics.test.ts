import { describe, expect, test } from "vitest";
import {
  normalizeSourceGuideBreakpoints,
  sourceGuideBreakpoints,
  sourceGuideCarrierHorizonRadius,
  sourceGuideGeometry,
  sourceGuideZones,
} from "./source-guide-semantics.js";

describe("source guide semantics", () => {
  test("exposes one editable split for 180-degree dome profiles", () => {
    const breakpoints = sourceGuideBreakpoints("zenith-180", 1 / 3);
    const zones = sourceGuideZones("zenith-180", 1 / 3);

    expect(breakpoints).toEqual([
      {
        id: "inner-split",
        label: "Sky / horizon split",
        radius: 1 / 3,
        editable: true,
        role: "semantic-split",
      },
    ]);
    expect(zones.map((zone) => zone.label)).toEqual(["Sky / overhead", "Horizon / human-level"]);
  });

  test("adds the physical horizon breakpoint for Zenith 230", () => {
    const breakpoints = sourceGuideBreakpoints("zenith-230", 1 / 3, 0.7);
    const zones = sourceGuideZones("zenith-230", 1 / 3, 0.7);
    const geometry = sourceGuideGeometry("zenith-230", 1 / 3, 0.7);

    expect(breakpoints.map((breakpoint) => breakpoint.id)).toEqual(["inner-split", "physical-horizon"]);
    expect(breakpoints[1].label).toBe("Physical horizon carrier");
    expect(breakpoints[1].radius).toBeCloseTo(0.7, 10);
    expect(breakpoints[1].editable).toBe(true);
    expect(zones.map((zone) => zone.id)).toEqual(["sky", "human-level", "below-horizon"]);
    expect(zones[1].endRadius).toBeCloseTo(0.7, 10);
    expect(geometry.hasPhysicalHorizon).toBe(true);
    expect(geometry.carrierHorizonRadius).toBeCloseTo(0.7, 10);
    expect(geometry.hasBelowHorizonSection).toBe(true);
  });

  test("adds a derived CAVE eye-level horizon breakpoint after the floor seam", () => {
    const breakpoints = sourceGuideBreakpoints("cave-270", 1 / 3);
    const zones = sourceGuideZones("cave-270", 1 / 3);
    const geometry = sourceGuideGeometry("cave-270", 1 / 3);

    expect(breakpoints.map((breakpoint) => breakpoint.id)).toEqual(["inner-split", "carrier-horizon"]);
    expect(breakpoints[0].label).toBe("Floor / wall seam");
    expect(breakpoints[0].radius).toBeCloseTo(1 / 3, 10);
    expect(breakpoints[0].editable).toBe(true);
    expect(breakpoints[1].label).toBe("Raster eye-line allocation");
    expect(breakpoints[1].radius).toBeCloseTo(2 / 3, 10);
    expect(breakpoints[1].editable).toBe(true);
    expect(sourceGuideCarrierHorizonRadius("cave-270", 0.5)).toBeCloseTo(0.75, 10);
    expect(geometry.horizonRadius).toBeCloseTo(1 / 3, 10);
    expect(geometry.carrierHorizonRadius).toBeCloseTo(2 / 3, 10);
    expect(zones.map((zone) => zone.label)).toEqual(["Floor carrier", "Lower wall carrier", "Upper wall carrier"]);
  });

  test("describes the double-gable roof seam, wall horizon, and open floor edge", () => {
    const breakpoints = sourceGuideBreakpoints("hall-double-gable");
    const zones = sourceGuideZones("hall-double-gable");

    expect(breakpoints[0]).toMatchObject({ label: "Roof / wall seam", radius: 0.36 });
    expect(breakpoints[1]).toMatchObject({ label: "Raster eye-line allocation" });
    expect(breakpoints[1].radius).toBeCloseTo(0.68, 10);
    expect(zones.map((zone) => zone.label)).toEqual([
      "Profiled planar ceiling",
      "Upper wall carrier",
      "Lower wall carrier",
    ]);
  });

  test("normalizes ordered editable breakpoint pairs", () => {
    expect(sourceGuideCarrierHorizonRadius("cave-270", 0.5, 0.6)).toBeCloseTo(0.6, 10);
    expect(sourceGuideCarrierHorizonRadius("cave-270", 0.5, 0.51)).toBeCloseTo(0.54, 10);
    expect(sourceGuideCarrierHorizonRadius("zenith-230", 0.66, 0.62)).toBeCloseTo(0.7, 10);
    expect(normalizeSourceGuideBreakpoints("zenith-180", 0.33, 0.55)).toEqual({
      innerSplit: 0.33,
      carrierHorizonRadius: 1,
    });
  });

  test.each([
    ["cylinder-nadir", "Floor cap / wall seam", ["Floor cap", "Lower cylinder wall", "Upper cylinder wall"]],
    ["cylinder-zenith", "Ceiling cap / wall seam", ["Ceiling cap", "Upper cylinder wall", "Lower cylinder wall"]],
  ] as const)("models %s as a tiny positive cap followed by a continuous wall", (mode, seamLabel, zoneLabels) => {
    const breakpoints = sourceGuideBreakpoints(mode);
    const zones = sourceGuideZones(mode);
    expect(breakpoints[0]).toMatchObject({ id: "inner-split", label: seamLabel, radius: 0.02 });
    expect(breakpoints[1]).toMatchObject({
      id: "carrier-horizon",
      label: "Raster eye-line allocation",
      radius: 0.51,
    });
    expect(zones.map((zone) => zone.label)).toEqual(zoneLabels);
    expect(normalizeSourceGuideBreakpoints(mode, 0)).toEqual({ innerSplit: 0.005, carrierHorizonRadius: 0.5025 });
    expect(normalizeSourceGuideBreakpoints(mode, 0.8)).toEqual({ innerSplit: 0.25, carrierHorizonRadius: 0.625 });
  });

  test("models the wall unwrap as a full rectangular lower-to-upper traversal", () => {
    const breakpoints = sourceGuideBreakpoints("cylinder-wall");
    const zones = sourceGuideZones("cylinder-wall");
    expect(breakpoints).toEqual([
      {
        id: "inner-split",
        label: "Lower / upper wall allocation",
        radius: 0.5,
        editable: true,
        role: "semantic-split",
      },
    ]);
    expect(zones.map((zone) => zone.label)).toEqual(["Lower cylinder wall", "Upper cylinder wall"]);
    expect(sourceGuideGeometry("cylinder-wall")).toMatchObject({
      horizonRadius: 0.5,
      carrierHorizonRadius: null,
      hasCarrierHorizon: false,
      hasBelowHorizonSection: true,
    });
  });
});
