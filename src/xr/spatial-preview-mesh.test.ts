import { describe, expect, test } from "vitest";

import { createInitialZenithDocument, defaultImageSpatialSpec, selectedComposition } from "../domain/project.js";
import type { ImageSpatialSpec } from "../domain/schema.js";
import { DEFAULT_AUDIENCE_IN_SPACE } from "../domain/schema.js";
import type { SourceProjectionMode } from "../geometry/source-projection.js";
import { defaultProjectionSurface } from "../lib/shared/contracts/projection-authoring.js";
import { buildImmersiveCarrierMesh, immersiveArPlacement, immersiveVrModelMatrix } from "./spatial-preview-mesh.js";

const NOW = "2026-08-25T12:00:00.000Z";

describe("immersive spatial preview mesh", () => {
  test("builds a meter-scale dome with finite portable source UVs", () => {
    const document = createInitialZenithDocument({ now: NOW });
    const spec = defaultImageSpatialSpec(selectedComposition(document).plateDraft);
    const audience = { ...DEFAULT_AUDIENCE_IN_SPACE, domeRadiusMeters: 9 };
    const mesh = buildImmersiveCarrierMesh(spec, audience);
    let maximumRadius = 0;

    expect(mesh.indices.length).toBeGreaterThan(10_000);
    for (let index = 0; index < mesh.vertices.length; index += 5) {
      const radius = Math.hypot(mesh.vertices[index]!, mesh.vertices[index + 1]!, mesh.vertices[index + 2]!);
      maximumRadius = Math.max(maximumRadius, radius);
      expect(Number.isFinite(mesh.vertices[index + 3])).toBe(true);
      expect(Number.isFinite(mesh.vertices[index + 4])).toBe(true);
    }
    expect(maximumRadius).toBeCloseTo(9, 4);
  });

  test("maps a measured CAVE into a tessellated physical carrier", () => {
    const spec = measuredCaveSpec();
    const mesh = buildImmersiveCarrierMesh(spec, DEFAULT_AUDIENCE_IN_SPACE);

    expect(mesh.indices.length).toBeGreaterThan(100);
    expect(mesh.vertices.length % 5).toBe(0);
    for (let index = 0; index < mesh.vertices.length; index += 5) {
      expect(mesh.vertices[index + 3]).toBeGreaterThanOrEqual(-0.001);
      expect(mesh.vertices[index + 3]).toBeLessThanOrEqual(1.001);
      expect(mesh.vertices[index + 4]).toBeGreaterThanOrEqual(-0.001);
      expect(mesh.vertices[index + 4]).toBeLessThanOrEqual(1.001);
    }
  });

  test("places the authored audience floor origin at the VR tracking origin", () => {
    const spec = measuredCaveSpec();
    const audience = {
      ...DEFAULT_AUDIENCE_IN_SPACE,
      xMeters: 2,
      zMeters: -1,
      yawDegrees: 90,
    };
    const matrix = immersiveVrModelMatrix(audience, spec);
    const floorAtAudience = transformPoint(matrix, [audience.xMeters - 1, -2, audience.zMeters + 0.5]);
    const oneMeterForward = transformPoint(matrix, [audience.xMeters - 1 + 1, -2, audience.zMeters + 0.5]);

    expect(floorAtAudience).toEqual([0, 0, 0]);
    expect(oneMeterForward[0]).toBeCloseTo(0, 6);
    expect(oneMeterForward[2]).toBeCloseTo(-1, 6);
  });

  test("derives a bounded tabletop scale from venue dimensions", () => {
    const placement = immersiveArPlacement(DEFAULT_AUDIENCE_IN_SPACE, measuredCaveSpec());

    expect(placement.scale).toBeCloseTo(0.082, 6);
    expect(placement.scaleDenominator).toBe(12);
    expect(placement.modelMatrix[13]).toBeCloseTo(0.164, 6);
  });

  test.each(["hall-double-gable", "cylinder-nadir", "cylinder-zenith", "cylinder-wall"] as const)(
    "keeps %s carrier vertices and UVs finite",
    (mode) => {
      const mesh = buildImmersiveCarrierMesh(carrierSpec(mode), DEFAULT_AUDIENCE_IN_SPACE);
      expect(mesh.indices.length).toBeGreaterThan(30);
      expect([...mesh.vertices].every(Number.isFinite)).toBe(true);
    },
    10_000,
  );
});

function measuredCaveSpec(): ImageSpatialSpec {
  return {
    sourceWidth: 2048,
    sourceHeight: 2048,
    sourceAspectRatio: 1,
    projectionMode: "cave-270",
    surface: { kind: "box-room", width: 10, depth: 8, height: 4, eyeHeight: 2, eyeX: 1, eyeZ: -0.5 },
    fit: "projection-aware",
    scale: 1,
    offsetX: 0,
    offsetY: 0,
    rotationDegrees: 0,
    guideSplit: 0.3,
    horizonSplit: 0.65,
    safeRimRadius: 1,
    exterior: "preserve",
    targetWidth: 2048,
    targetHeight: 2048,
  };
}

function carrierSpec(mode: SourceProjectionMode): ImageSpatialSpec {
  return {
    ...measuredCaveSpec(),
    projectionMode: mode,
    surface: defaultProjectionSurface(mode),
    exterior: mode === "cylinder-wall" || mode === "hall-double-gable" ? "preserve" : "black",
  };
}

function transformPoint(matrix: ArrayLike<number>, point: readonly [number, number, number]) {
  return [
    clean(matrix[0]! * point[0] + matrix[4]! * point[1] + matrix[8]! * point[2] + matrix[12]!),
    clean(matrix[1]! * point[0] + matrix[5]! * point[1] + matrix[9]! * point[2] + matrix[13]!),
    clean(matrix[2]! * point[0] + matrix[6]! * point[1] + matrix[10]! * point[2] + matrix[14]!),
  ];
}

function clean(value: number): number {
  return Math.abs(value) < 0.000001 ? 0 : value;
}
