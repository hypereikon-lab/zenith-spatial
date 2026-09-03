import { describe, expect, test } from "vitest";

import { DEFAULT_AUDIENCE_IN_SPACE } from "../domain/schema.js";
import { createInitialZenithDocument, defaultImageSpatialSpec, selectedComposition } from "../domain/project.js";
import { cameraBasisFromRigPose, quaternionFromEulerDegrees } from "./camera-rig.js";
import { carrierRasterForProjection, defaultProjectionSurface } from "../lib/shared/contracts/projection-authoring.js";
import { SOURCE_PROJECTION_MODES } from "../lib/shared/contracts/projection-profile.js";
import { dot, normalize, type Vec3 } from "../projection.js";
import {
  spatialPointToTileSample,
  spatialSurfacePointFromSourceUv,
  spatialTileCameraPosition,
  spatialTilePlan,
} from "./spatial-upscale.js";

describe("spatial upscale tile geometry", () => {
  test("anchors the front crop to the current Audience in Space gaze", () => {
    const audience = { ...DEFAULT_AUDIENCE_IN_SPACE, yawDegrees: 37, pitchDegrees: 18 };
    const [front] = spatialTilePlan(audience);
    const expected = cameraBasisFromRigPose({
      orientation: quaternionFromEulerDegrees(37, 18, 0),
      mode: "inside",
    });
    const actual = cameraBasisFromRigPose({ orientation: front!.orientation, mode: "inside" });

    expect(dot(actual.forward, expected.forward)).toBeCloseTo(1, 6);
    expect(dot(actual.up, expected.up)).toBeCloseTo(1, 6);
  });

  test("covers the full sphere with overlap at every cubemap seam", () => {
    const tiles = spatialTilePlan(DEFAULT_AUDIENCE_IN_SPACE);
    const camera: Vec3 = [0, 0, 0];
    for (let latitude = -90; latitude <= 90; latitude += 10) {
      for (let longitude = -180; longitude < 180; longitude += 10) {
        const pitch = (latitude * Math.PI) / 180;
        const yaw = (longitude * Math.PI) / 180;
        const point = normalize([Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), Math.cos(yaw) * Math.cos(pitch)]);
        const samples = tiles
          .map((tile) => spatialPointToTileSample(point, camera, tile, 110))
          .filter((sample) => sample && sample.weight > 0.000001);
        expect(samples.length).toBeGreaterThan(0);
      }
    }

    const seam = normalize([1, 0, 1]);
    const seamSamples = tiles
      .map((tile) => spatialPointToTileSample(seam, camera, tile, 110))
      .filter((sample) => sample && sample.weight > 0.000001);
    expect(seamSamples.length).toBeGreaterThanOrEqual(2);
  });

  test("covers every valid source-map region across all carrier geometries", () => {
    const baseDraft = selectedComposition(createInitialZenithDocument()).plateDraft;
    for (const mode of SOURCE_PROJECTION_MODES) {
      const raster = carrierRasterForProjection(mode, baseDraft.raster);
      const draft = {
        ...structuredClone(baseDraft),
        projectionMode: mode,
        surface: defaultProjectionSurface(mode),
        raster,
      };
      const spec = defaultImageSpatialSpec(draft);
      const camera = spatialTileCameraPosition(DEFAULT_AUDIENCE_IN_SPACE, spec);
      const tiles = spatialTilePlan(DEFAULT_AUDIENCE_IN_SPACE, {
        spatialSpec: spec,
        tileFovDegrees: 110,
      });
      let valid = 0;
      for (let y = 0; y < 31; y += 1) {
        for (let x = 0; x < 31; x += 1) {
          const point = spatialSurfacePointFromSourceUv((x + 0.5) / 31, (y + 0.5) / 31, spec);
          if (!point) continue;
          valid += 1;
          expect(
            tiles.some((tile) => {
              const sample = spatialPointToTileSample(point, camera, tile, 110);
              return Boolean(sample && sample.weight > 0.000001);
            }),
            `${mode} must cover source pixel ${x},${y}`,
          ).toBe(true);
        }
      }
      expect(valid).toBeGreaterThan(50);
    }
  });

  test.each([
    { mode: "zenith-180" as const, boundaryElevationDegrees: 0, expectedV: 1 },
    { mode: "zenith-230" as const, boundaryElevationDegrees: -25, expectedV: 1 },
    { mode: "nadir-180" as const, boundaryElevationDegrees: 0, expectedV: 0 },
  ])("places the $mode forward crop edge exactly on its visible angular rim", (example) => {
    const baseDraft = selectedComposition(createInitialZenithDocument()).plateDraft;
    const draft = {
      ...structuredClone(baseDraft),
      projectionMode: example.mode,
      surface: defaultProjectionSurface(example.mode),
      raster: carrierRasterForProjection(example.mode, baseDraft.raster),
    };
    const spec = defaultImageSpatialSpec(draft);
    const audience = { ...DEFAULT_AUDIENCE_IN_SPACE, xMeters: 1.2, zMeters: -0.4 };
    const camera = spatialTileCameraPosition(audience, spec);
    const [front] = spatialTilePlan(audience, {
      spatialSpec: spec,
      tileFovDegrees: 110,
    });
    const elevation = (example.boundaryElevationDegrees * Math.PI) / 180;
    const rimPoint: Vec3 = [0, Math.sin(elevation), Math.cos(elevation)];
    const sample = spatialPointToTileSample(rimPoint, camera, front!, 110);

    expect(sample).not.toBeNull();
    expect(sample!.u).toBeCloseTo(0.5, 6);
    expect(sample!.v).toBeCloseTo(example.expectedV, 6);
  });
});
