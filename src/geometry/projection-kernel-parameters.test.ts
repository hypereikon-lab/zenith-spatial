import { describe, expect, test } from "vitest";
import { sizeOf } from "typegpu/data";
import { projectionKernelParamsSchema } from "../kernels/schemas.js";
import {
  ProjectionDomainCode,
  ProjectionKernelFlag,
  ProjectionModeCode,
  ProjectionTopologyCode,
} from "../kernels/projection/constants.js";
import { compileProjectionKernelParams } from "./projection-kernel-parameters.js";

describe("projection kernel parameter compiler", () => {
  test("uses explicit identity and independent box-room geometry", () => {
    const params = compileProjectionKernelParams({
      mode: "cave-270",
      width: 2560,
      height: 1440,
      innerSplit: 0.2,
      horizonSplit: 0.62,
      surface: {
        kind: "box-room",
        width: 6,
        depth: 4,
        height: 3.5,
        eyeHeight: 1.65,
        eyeX: 0.35,
        eyeZ: -0.2,
        anchors: { horizonHeight: 2.45 },
      },
    });

    expect(params.mode).toBe(ProjectionModeCode.Cave270);
    expect(params.topology).toBe(ProjectionTopologyCode.CavePerimeter);
    expect(params.domain).toBe(ProjectionDomainCode.Square);
    expect(params.flags & ProjectionKernelFlag.SurfaceCarrier).toBeTruthy();
    expect([params.boxSize.x, params.boxSize.y, params.boxSize.z]).toEqual([6, 4, 3.5]);
    expect([params.boxObserver.x, params.boxObserver.y, params.boxObserver.z]).toEqual([
      Math.fround(0.35),
      Math.fround(1.65),
      Math.fround(-0.2),
    ]);
    expect([params.rasterScale.x, params.rasterScale.y]).toEqual([Math.fround(1440 / 2560), 1]);
    expect(params.physicalHorizon).toBeCloseTo(0.7, 6);
  });

  test("describes radial and unwrapped cylinders without topology sentinels", () => {
    const radial = compileProjectionKernelParams({
      mode: "cylinder-zenith",
      width: 1920,
      height: 1920,
      innerSplit: 0.01,
      surface: {
        kind: "cylinder",
        radius: 3.2,
        height: 5,
        eyeHeight: 1.7,
        anchors: { horizonHeight: 1 },
      },
    });
    const wall = compileProjectionKernelParams({
      mode: "cylinder-wall",
      width: 2912,
      height: 1248,
      innerSplit: 0.58,
      surface: { kind: "cylinder", radius: 3.2, height: 5, eyeHeight: 1.7 },
    });

    expect(radial.mode).toBe(ProjectionModeCode.CylinderZenith);
    expect(radial.topology).toBe(ProjectionTopologyCode.CylinderRadial);
    expect(radial.physicalHorizon).toBeCloseTo(0.8, 6);
    expect(wall.mode).toBe(ProjectionModeCode.CylinderWall);
    expect(wall.topology).toBe(ProjectionTopologyCode.CylinderWall);
    expect(wall.domain).toBe(ProjectionDomainCode.Rectangular);
    expect(wall.flags & ProjectionKernelFlag.HorizontalWrap).toBeTruthy();
    expect([wall.cylinder.x, wall.cylinder.y, wall.cylinder.z]).toEqual([Math.fround(3.2), 5, Math.fround(1.7)]);
  });

  test("compiles the planar-profile hall into fixed-capacity typed shell parameters", () => {
    const params = compileProjectionKernelParams({
      mode: "hall-double-gable",
      width: 2912,
      height: 1248,
      surface: {
        kind: "double-gable-room",
        length: 22.55,
        width: 23.143,
        eaveHeight: 9.39,
        ridgeHeight: 12.93,
        valleyHeight: 9.39,
        ridgeInset: 23.143 / 4,
        eyeHeight: 1.65,
        eyeX: 0,
        eyeZ: 0,
      },
    });

    expect(params.mode).toBe(ProjectionModeCode.HallDoubleGable);
    expect(params.topology).toBe(ProjectionTopologyCode.GabledShell);
    expect(params.domain).toBe(ProjectionDomainCode.Square);
    expect(Array.from(params.boxSize)).toEqual([Math.fround(22.55), Math.fround(23.143), Math.fround(9.39)]);
    expect(Array.from(params.doubleGable)).toEqual([Math.fround(12.93), Math.fround(9.39), Math.fround(23.143 / 4), 0]);
    expect(params.roofProfile.count).toBe(5);
    expect(Array.from(params.roofProfile.positionsA)).toEqual([0, 0.25, 0.5, 0.75]);
    expect(Array.from(params.roofProfile.heightsA)).toEqual([
      Math.fround(9.39),
      Math.fround(12.93),
      Math.fround(9.39),
      Math.fround(12.93),
    ]);
  });

  test("allows a render-only cap raster split without changing authored placement normalization", () => {
    const params = compileProjectionKernelParams({
      mode: "cylinder-zenith",
      innerSplit: 0.02,
      rasterInnerSplit: 1,
      surface: { kind: "cylinder", radius: 3.2, height: 5, eyeHeight: 1.7 },
    });

    expect(params.innerSplit).toBe(1);
    expect(params.horizonSplit).toBe(1);
  });

  test("compiles independent angular semantic and horizon elevations", () => {
    const params = compileProjectionKernelParams({
      mode: "zenith-180",
      innerSplit: 0.3,
      horizonSplit: 0.7,
      surface: {
        kind: "angular",
        anchors: { semanticElevationDegrees: 60, horizonElevationDegrees: 15 },
      },
    });

    expect(params.physicalSemantic).toBeCloseTo(1 / 3, 6);
    expect(params.physicalHorizon).toBeCloseTo(5 / 6, 6);
  });

  test("has a stable TypeGPU-owned ABI size", () => {
    expect(sizeOf(projectionKernelParamsSchema)).toBe(272);
  });
});
