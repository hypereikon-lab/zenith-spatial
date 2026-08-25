import tgpu, { d } from "typegpu";
import { describe, expect, test } from "vitest";
import { SOURCE_PROJECTION_MODES } from "../../lib/shared/contracts/projection-profile.js";
import type { SourceProjectionMode } from "../../lib/shared/contracts/projection-profile.js";
import { compileProjectionKernelParams } from "../../geometry/projection-kernel-parameters.js";
import { sourceDirectionToUv, sourceUvToDirection } from "../../geometry/source-projection.js";
import { sourceDirectionToUvKernel, sourceUvToDirectionKernel } from "./index.js";
import { planarRoofProfileKernelSchema } from "../schemas.js";

const UV_SAMPLES = [
  [0.5, 0.5],
  [0.5, 0.05],
  [0.95, 0.5],
  [0.5, 0.95],
  [0.05, 0.5],
  [0.23, 0.31],
  [0.78, 0.67],
] as const;

describe("authoritative projection kernel", () => {
  test.each(SOURCE_PROJECTION_MODES)("matches the existing CPU mapping for %s", (mode) => {
    const input = fixtureForMode(mode);
    const params = compileProjectionKernelParams(input);
    for (const [u, v] of UV_SAMPLES) {
      const expectedDirection = sourceUvToDirection(
        u,
        v,
        mode,
        Number(input.width),
        Number(input.height),
        input.radiusScale,
        input.innerSplit,
        input.horizonSplit,
        input.surface,
      );
      const actualDirection = callUvKernel(u, v, params);
      expectNullableVectorClose(actualDirection, expectedDirection, 4);
      if (!expectedDirection) continue;

      const expectedUv = sourceDirectionToUv(
        expectedDirection,
        mode,
        Number(input.width),
        Number(input.height),
        input.radiusScale,
        input.innerSplit,
        input.horizonSplit,
        input.surface,
      );
      const actualUv = callDirectionKernel(expectedDirection, params);
      expectNullableUvClose(actualUv, expectedUv, 4);
    }
  });

  test("preserves asymmetric room and observer geometry", () => {
    const input = fixtureForMode("cave-270");
    const params = compileProjectionKernelParams(input);
    const directions = [
      [0.7, -0.2, 1],
      [-1, 0.4, 0.2],
      [0.1, -1, -0.3],
      [0.3, 0.7, -1],
    ] as const;
    for (const direction of directions) {
      const expected = sourceDirectionToUv(
        [...direction],
        "cave-270",
        Number(input.width),
        Number(input.height),
        1,
        input.innerSplit,
        input.horizonSplit,
        input.surface,
      );
      expectNullableUvClose(callDirectionKernel(direction, params), expected, 4);
    }
  });

  test("resolves the complete projection dispatch and dependencies to WGSL", () => {
    const probe = () => {
      "use gpu";
      return sourceUvToDirectionKernel(
        d.vec2f(0.5, 0.5),
        0,
        0,
        0,
        d.vec2f(0.5, 0.5),
        Math.PI * 0.5,
        0.33,
        1,
        0.5,
        1,
        d.vec3f(0, 1, 0),
        d.vec3f(1, 0, 0),
        d.vec3f(0, 0, 1),
        d.vec3f(4, 4, 4),
        d.vec3f(0, 2, 0),
        planarRoofProfileKernelSchema({
          positionsA: d.vec4f(0, 0.25, 0.5, 0.75),
          positionsB: d.vec4f(1, 1, 1, 1),
          heightsA: d.vec4f(4, 5, 4, 5),
          heightsB: d.vec4f(4, 4, 4, 4),
          count: 5,
        }),
        d.vec4f(0, 0, 0, 0),
        d.vec3f(2, 4, 2),
      );
    };

    const wgsl = tgpu.resolve([probe]);
    expect(wgsl).toContain("fn sourceUvToDirectionKernel");
    expect(wgsl).toContain("fn caveCarrierUvToDirectionKernel");
    expect(wgsl).toContain("fn cylinderRadialUvToDirectionKernel");
    expect(wgsl).toContain("fn fisheyeUvToDirectionKernel");
  });
});

function fixtureForMode(mode: SourceProjectionMode) {
  return {
    mode,
    width: 2560,
    height: 1440,
    radiusScale: 1,
    innerSplit: mode === "cylinder-wall" ? 0.58 : mode.startsWith("cylinder-") ? 0.03 : 0.31,
    horizonSplit:
      mode === "cave-270" || mode === "hall-double-gable" ? 0.64 : mode.startsWith("cylinder-") ? 0.55 : 0.72,
    surface:
      mode === "cave-270"
        ? ({ kind: "box-room", width: 6, depth: 4, height: 3.5, eyeHeight: 1.6, eyeX: 0.35, eyeZ: -0.2 } as const)
        : mode === "hall-double-gable"
          ? ({
              kind: "double-gable-room",
              length: 22.55,
              width: 23.143,
              eaveHeight: 9.39,
              ridgeHeight: 12.93,
              valleyHeight: 9.39,
              ridgeInset: 5.78575,
              eyeHeight: 1.65,
              eyeX: 0.35,
              eyeZ: -0.2,
            } as const)
          : mode.startsWith("cylinder-")
            ? ({ kind: "cylinder", radius: 3, height: 4.5, eyeHeight: 1.7 } as const)
            : ({ kind: "angular" } as const),
  };
}

function callUvKernel(u: number, v: number, params: ReturnType<typeof compileProjectionKernelParams>) {
  const sample = sourceUvToDirectionKernel(
    d.vec2f(u, v),
    params.mode,
    params.topology,
    params.flags,
    params.fisheyeScale,
    params.halfAngle,
    params.innerSplit,
    params.horizonSplit,
    params.physicalSemantic,
    params.physicalHorizon,
    params.centerAxis,
    params.imageRightAxis,
    params.imageUpAxis,
    params.boxSize,
    params.boxObserver,
    params.roofProfile,
    params.doubleGable,
    params.cylinder,
  );
  return sample.w < 0.5 ? null : ([sample.x, sample.y, sample.z] as const);
}

function callDirectionKernel(
  direction: readonly [number, number, number],
  params: ReturnType<typeof compileProjectionKernelParams>,
) {
  const sample = sourceDirectionToUvKernel(
    d.vec3f(...direction),
    params.mode,
    params.topology,
    params.flags,
    params.fisheyeScale,
    params.halfAngle,
    params.innerSplit,
    params.horizonSplit,
    params.physicalSemantic,
    params.physicalHorizon,
    params.centerAxis,
    params.imageRightAxis,
    params.imageUpAxis,
    params.boxSize,
    params.boxObserver,
    params.roofProfile,
    params.doubleGable,
    params.cylinder,
  );
  return sample.z < 0.5 ? null : { u: sample.x, v: sample.y };
}

function expectNullableVectorClose(
  actual: readonly number[] | null,
  expected: readonly number[] | null,
  precision: number,
) {
  if (!actual || !expected) {
    expect(actual).toBe(expected);
    return;
  }
  expect(actual[0]).toBeCloseTo(expected[0], precision);
  expect(actual[1]).toBeCloseTo(expected[1], precision);
  expect(actual[2]).toBeCloseTo(expected[2], precision);
}

function expectNullableUvClose(
  actual: { u: number; v: number } | null,
  expected: { u: number; v: number } | null,
  precision: number,
) {
  if (!actual || !expected) {
    expect(actual).toBe(expected);
    return;
  }
  expect(actual.u).toBeCloseTo(expected.u, precision);
  expect(actual.v).toBeCloseTo(expected.v, precision);
}
