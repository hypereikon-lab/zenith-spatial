import { describe, expect, test } from "vitest";
import {
  BoxRoomProjectionSurfaceSchema,
  CarrierRasterSchema,
  DoubleGableProjectionSurfaceSchema,
  GENERATION_ASPECT_PRESETS,
  carrierRasterForAspect,
  carrierRasterForProjection,
  exactGenerationAspectForDimensions,
  generationAspectForDimensions,
  governedGenerationAspectForProjection,
  gptImage2RasterIssues,
  normalizeProjectionSurfaceForMode,
  planarRoofProfile,
  projectionSurfacePhysicalHorizon,
  projectionSurfaceSummary,
} from "./projection-authoring.js";

describe("projection authoring contracts", () => {
  test.each(GENERATION_ASPECT_PRESETS)("provides a valid cross-model %s carrier raster", (aspectPreset) => {
    const raster = carrierRasterForAspect(aspectPreset);

    expect(CarrierRasterSchema.parse(raster)).toEqual(raster);
    expect(gptImage2RasterIssues(raster.width, raster.height)).toEqual([]);
    expect(raster.width * raster.height).toBeLessThanOrEqual(2560 * 1440);
  });

  test("governs cylinder-wall authoring at 21:9 without constraining other projections", () => {
    expect(governedGenerationAspectForProjection("cylinder-wall")).toBe("21:9");
    expect(carrierRasterForProjection("cylinder-wall", carrierRasterForAspect("1:1"))).toEqual(
      carrierRasterForAspect("21:9"),
    );

    expect(governedGenerationAspectForProjection("cave-270")).toBeNull();
    expect(carrierRasterForProjection("cave-270", carrierRasterForAspect("4:3"))).toEqual(
      carrierRasterForAspect("4:3"),
    );
  });

  test("selects the nearest supported aspect family without assuming a square", () => {
    expect(generationAspectForDimensions(2560, 1440)).toBe("16:9");
    expect(generationAspectForDimensions(1664, 1248)).toBe("4:3");
    expect(generationAspectForDimensions(1080, 1920)).toBe("9:16");
  });

  test("distinguishes exact shared aspects from unsupported custom input", () => {
    expect(exactGenerationAspectForDimensions(2912, 1248)).toBe("21:9");
    expect(exactGenerationAspectForDimensions(1919, 1081)).toBeNull();
  });

  test("accepts a measured asymmetric room with an off-centre observer", () => {
    const surface = {
      kind: "box-room" as const,
      width: 6,
      depth: 4,
      height: 3.5,
      eyeHeight: 1.4,
      eyeX: 0.75,
      eyeZ: -0.4,
    };

    expect(BoxRoomProjectionSurfaceSchema.parse(surface)).toEqual(surface);
    expect(normalizeProjectionSurfaceForMode(surface, "cave-270")).toEqual({
      ...surface,
      anchors: { horizonHeight: 1.4 },
    });
    expect(projectionSurfacePhysicalHorizon(surface)).toEqual({
      height: 1.4,
      upperLimit: 3.5,
      reference: "venue-floor",
    });
    expect(projectionSurfaceSummary(surface)).toContain("anchor 1.4 m");
  });

  test("rejects observer coordinates outside the measured room", () => {
    expect(() =>
      BoxRoomProjectionSurfaceSchema.parse({
        kind: "box-room",
        width: 6,
        depth: 4,
        height: 3.5,
        eyeHeight: 3.5,
        eyeX: 3,
        eyeZ: -2,
      }),
    ).toThrow(/observer/);
  });

  test("keeps legacy W-profile halls readable while accepting ordered planar anchors", () => {
    const surface = {
      kind: "double-gable-room" as const,
      length: 22.55,
      width: 23.143,
      eaveHeight: 9.39,
      ridgeHeight: 12.93,
      valleyHeight: 9.39,
      ridgeInset: 23.143 / 4,
      eyeHeight: 1.65,
      eyeX: 0,
      eyeZ: 0,
    };

    expect(DoubleGableProjectionSurfaceSchema.parse(surface)).toEqual(surface);
    expect(normalizeProjectionSurfaceForMode(surface, "hall-double-gable")).toEqual({
      ...surface,
      anchors: { horizonHeight: 1.65 },
    });
    expect(projectionSurfaceSummary(surface)).toContain("no floor");

    const profiled = {
      ...surface,
      roofProfile: [
        { id: "left", position: 0, height: 8.4, role: "eave" as const },
        { id: "ridge-a", position: 0.2, height: 12.8, role: "ridge" as const },
        { id: "valley", position: 0.56, height: 9.1, role: "valley" as const },
        { id: "ridge-b", position: 0.81, height: 13.6, role: "ridge" as const },
        { id: "right", position: 1, height: 8.9, role: "eave" as const },
      ],
    };
    expect(DoubleGableProjectionSurfaceSchema.parse(profiled)).toEqual(profiled);
    expect(projectionSurfacePhysicalHorizon(profiled)).toEqual({
      height: 1.65,
      upperLimit: 8.4,
      reference: "venue-floor",
    });
  });

  test("treats an explicit planar profile as authoritative over stale legacy gable fields", () => {
    const profiled = {
      kind: "double-gable-room" as const,
      length: 18,
      width: 12,
      eaveHeight: 10,
      ridgeHeight: 8,
      valleyHeight: 9,
      ridgeInset: 7,
      roofProfile: [
        { id: "left", position: 0, height: 7, role: "ridge" as const },
        { id: "high", position: 0.3, height: 11, role: "valley" as const },
        { id: "slope", position: 0.62, height: 9, role: "ridge" as const },
        { id: "right", position: 1, height: 7.5, role: "break" as const },
      ],
      eyeHeight: 1.7,
      eyeX: 1,
      eyeZ: -0.5,
    };

    expect(DoubleGableProjectionSurfaceSchema.parse(profiled)).toEqual(profiled);
    expect(planarRoofProfile(profiled).map((anchor) => anchor.role)).toEqual(["eave", "ridge", "break", "eave"]);
  });

  test("rejects folded or open planar roof profiles", () => {
    const surface = {
      ...normalizeProjectionSurfaceForMode(undefined, "hall-double-gable"),
      roofProfile: [
        { id: "left", position: 0.1, height: 8.4, role: "eave" as const },
        { id: "fold", position: 0.1, height: 12, role: "ridge" as const },
        { id: "right", position: 0.9, height: 8.4, role: "eave" as const },
      ],
    };
    expect(() => DoubleGableProjectionSurfaceSchema.parse(surface)).toThrow(/start|ordered|end/);
  });

  test("rejects impossible double-gable roof and observer geometry", () => {
    expect(() =>
      DoubleGableProjectionSurfaceSchema.parse({
        kind: "double-gable-room",
        length: 22.55,
        width: 23.143,
        eaveHeight: 9.39,
        ridgeHeight: 9.39,
        valleyHeight: 9.39,
        ridgeInset: 12,
        eyeHeight: 9.39,
        eyeX: 12,
        eyeZ: 0,
      }),
    ).toThrow(/ridge|observer/);
  });
});
