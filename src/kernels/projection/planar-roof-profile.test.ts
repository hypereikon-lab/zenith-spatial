import tgpu, { d } from "typegpu";
import { describe, expect, test } from "vitest";
import { compilePlanarRoofProfileKernelParams } from "../../geometry/projection-kernel-parameters.js";
import { DEFAULT_DOUBLE_GABLE_PROJECTION_SURFACE } from "../../lib/shared/contracts/projection-authoring.js";
import { planarRoofProfileKernelSchema } from "../schemas.js";
import {
  planarRoofMaximumHeightKernel,
  planarRoofMinimumHeightKernel,
  planarRoofNormalizedHeightKernel,
  planarRoofSegmentSlopeKernel,
} from "./planar-roof-profile.js";

describe("planar roof profile field math", () => {
  test("turns the default eave-ridge-valley-ridge-eave profile into a physical height wave", () => {
    const surface = DEFAULT_DOUBLE_GABLE_PROJECTION_SURFACE;
    const profile = compilePlanarRoofProfileKernelParams(surface);
    const width = surface.width;

    expect(planarRoofMinimumHeightKernel(profile)).toBeCloseTo(9.39, 5);
    expect(planarRoofMaximumHeightKernel(profile)).toBeCloseTo(12.93, 5);
    expect(planarRoofNormalizedHeightKernel(-width * 0.5, width, profile)).toBeCloseTo(0, 6);
    expect(planarRoofNormalizedHeightKernel(-width * 0.25, width, profile)).toBeCloseTo(1, 6);
    expect(planarRoofNormalizedHeightKernel(0, width, profile)).toBeCloseTo(0, 6);
    expect(planarRoofNormalizedHeightKernel(width * 0.25, width, profile)).toBeCloseTo(1, 6);
    expect(planarRoofNormalizedHeightKernel(width * 0.5, width, profile)).toBeCloseTo(0, 6);
    expect(planarRoofSegmentSlopeKernel(0, width, profile)).toBeGreaterThan(0);
    expect(planarRoofSegmentSlopeKernel(1, width, profile)).toBeLessThan(0);
    expect(planarRoofSegmentSlopeKernel(2, width, profile)).toBeGreaterThan(0);
    expect(planarRoofSegmentSlopeKernel(3, width, profile)).toBeLessThan(0);
  });

  test("uses a neutral field for a flat roof", () => {
    const profile = {
      positionsA: d.vec4f(0, 0.5, 1, 1),
      positionsB: d.vec4f(1),
      heightsA: d.vec4f(8),
      heightsB: d.vec4f(8),
      count: 3,
    };

    expect(planarRoofNormalizedHeightKernel(-5, 10, profile)).toBeCloseTo(0.5, 6);
    expect(planarRoofNormalizedHeightKernel(0, 10, profile)).toBeCloseTo(0.5, 6);
    expect(planarRoofNormalizedHeightKernel(5, 10, profile)).toBeCloseTo(0.5, 6);
  });

  test("resolves the height and plane-normal inputs through TypeGPU", () => {
    const probe = () => {
      "use gpu";
      const profile = planarRoofProfileKernelSchema({
        positionsA: d.vec4f(0, 0.25, 0.5, 0.75),
        positionsB: d.vec4f(1, 1, 1, 1),
        heightsA: d.vec4f(9, 13, 9, 13),
        heightsB: d.vec4f(9, 9, 9, 9),
        count: 5,
      });
      return d.vec2f(planarRoofNormalizedHeightKernel(0, 20, profile), planarRoofSegmentSlopeKernel(0, 20, profile));
    };
    const shader = tgpu.resolve([probe]);

    expect(shader).toContain("fn planarRoofNormalizedHeightKernel");
    expect(shader).toContain("fn planarRoofSegmentSlopeKernel");
  });
});
