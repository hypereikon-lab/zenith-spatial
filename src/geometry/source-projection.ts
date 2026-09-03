import { d } from "typegpu";
import { createFisheyeProjectionProfile } from "./fisheye-projection.js";
import type { FisheyeProjectionProfile } from "./fisheye-projection.js";
import {
  normalizeSourceInnerGuideSplit,
  sourceGuideCarrierHorizonRadius,
  sourceGuideGeometry,
} from "./source-guide-semantics.js";
import { clamp } from "../projection.js";
import type { MapUv, Vec3 } from "../projection.js";
import { isSourceProjectionMode, type SourceProjectionMode } from "../lib/shared/contracts/projection-profile.js";
import type { ProjectionSurface } from "../lib/shared/contracts/projection-authoring.js";
import {
  projectionCarrierProfile,
  sourceProjectionIsCaveCarrier,
  sourceProjectionIsCylinderCarrier,
  sourceProjectionIsGabledShellCarrier,
  sourceProjectionIsSurfaceCarrier,
  sourceProjectionIsUnwrappedCylinderCarrier,
  sourceProjectionUsesCircularDomain,
} from "./projection-carrier-profile.js";
import { compileProjectionKernelParams } from "./projection-kernel-parameters.js";
import { sourceDirectionToUvKernel, sourceUvToDirectionKernel } from "../kernels/projection/index.js";

export { SOURCE_PROJECTION_MODES } from "../lib/shared/contracts/projection-profile.js";
export type { SourceProjectionMode } from "../lib/shared/contracts/projection-profile.js";
export {
  projectionCarrierProfile,
  projectionCarrierRenderTarget,
  sourceProjectionIsCaveCarrier,
  sourceProjectionIsCylinderCarrier,
  sourceProjectionIsGabledShellCarrier,
  sourceProjectionIsRadialCylinderCarrier,
  sourceProjectionIsSurfaceCarrier,
  sourceProjectionIsUnwrappedCylinderCarrier,
  sourceProjectionUsesCircularDomain,
} from "./projection-carrier-profile.js";

export type SourceProjectionGeometryRange = {
  thetaStart: number;
  thetaEnd: number;
};

export type SourceProjectionSummary = {
  mode: SourceProjectionMode;
  label: string;
  center: "Zenith" | "Nadir";
  fieldOfViewDegrees: number;
  halfAngleDegrees: number;
  horizonRadius: number;
  beyondHorizonDegrees: number;
  coverageLabel: string;
};

export type SourceMapPoint = {
  radius: number;
  azimuth: number;
};

export function normalizeSourceProjectionMode(value: unknown): SourceProjectionMode {
  return isSourceProjectionMode(value) ? value : "zenith-180";
}

export function sourceProjectionProfileForMode(
  mode: SourceProjectionMode,
  width = 2,
  height = 2,
  radiusScale: number | string | null = 1,
): FisheyeProjectionProfile {
  const carrier = projectionCarrierProfile(mode);
  // Surface carriers still need the common source-frame axes and raster scale
  // used by the uniform ABI. Their actual mapping never uses this compatibility
  // FOV; it branches to the exact CAVE/cylinder transforms below.
  const compatibilityFieldOfView = carrier.fieldOfViewDegrees ?? (carrier.topology === "square-perimeter" ? 270 : 180);
  return createFisheyeProjectionProfile({
    width,
    height,
    radiusScale,
    center: carrier.center,
    fieldOfViewDegrees: compatibilityFieldOfView,
  });
}

export function sourceProjectionGeometryRange(mode: SourceProjectionMode): SourceProjectionGeometryRange {
  if (sourceProjectionIsGabledShellCarrier(mode)) {
    return { thetaStart: 0, thetaEnd: Math.PI };
  }
  if (mode === "nadir-180") {
    return { thetaStart: Math.PI * 0.5, thetaEnd: Math.PI };
  }
  if (mode === "cave-270") {
    return { thetaStart: Math.PI * 0.25, thetaEnd: Math.PI };
  }
  if (sourceProjectionIsCylinderCarrier(mode)) {
    return { thetaStart: 0, thetaEnd: Math.PI };
  }
  if (mode === "zenith-230") {
    return { thetaStart: 0, thetaEnd: (Math.PI * 23) / 36 };
  }
  return { thetaStart: 0, thetaEnd: Math.PI * 0.5 };
}

export function sourceProjectionLabel(mode: SourceProjectionMode): string {
  return projectionCarrierProfile(mode).label;
}

export function sourceProjectionCenterLabel(mode: SourceProjectionMode): SourceProjectionSummary["center"] {
  return projectionCarrierProfile(mode).center === "nadir" ? "Nadir" : "Zenith";
}

export function sourceProjectionFieldOfViewDegrees(mode: SourceProjectionMode): number {
  return (
    projectionCarrierProfile(mode).fieldOfViewDegrees ??
    (sourceProjectionIsCylinderCarrier(mode) || sourceProjectionIsGabledShellCarrier(mode) ? 360 : 270)
  );
}

export function sourceProjectionBeyondHorizonDegrees(mode: SourceProjectionMode): number {
  return Math.max(0, sourceProjectionFieldOfViewDegrees(mode) * 0.5 - 90);
}

export function sourceProjectionHorizonRadius(
  mode: SourceProjectionMode,
  innerGuideSplit?: number | string | null,
  carrierHorizonRadius?: number | string | null,
): number {
  if (sourceProjectionIsSurfaceCarrier(mode)) {
    return sourceGuideGeometry(mode, innerGuideSplit, carrierHorizonRadius).horizonRadius;
  }
  const profile = sourceProjectionProfileForMode(mode);
  return (Math.PI * 0.5) / (profile.fieldOfViewDegrees * 0.5 * (Math.PI / 180));
}

export function sourceProjectionSummary(
  mode: SourceProjectionMode,
  innerGuideSplit?: number | string | null,
): SourceProjectionSummary {
  const fieldOfViewDegrees = sourceProjectionFieldOfViewDegrees(mode);
  return {
    mode,
    label: sourceProjectionLabel(mode),
    center: sourceProjectionCenterLabel(mode),
    fieldOfViewDegrees,
    halfAngleDegrees: fieldOfViewDegrees * 0.5,
    horizonRadius: sourceProjectionHorizonRadius(mode, innerGuideSplit),
    beyondHorizonDegrees: sourceProjectionBeyondHorizonDegrees(mode),
    coverageLabel: projectionCarrierProfile(mode).coverageLabel,
  };
}

export function sourceProjectionContainsDirection(direction: Vec3, mode: SourceProjectionMode): boolean {
  return sourceDirectionToUv(direction, mode) !== null;
}

export function sourceDirectionToUv(
  direction: Vec3,
  mode: SourceProjectionMode,
  width = 2,
  height = 2,
  radiusScale: number | string | null = 1,
  innerGuideSplit?: number | string | null,
  carrierHorizonRadius?: number | string | null,
  surface?: ProjectionSurface | null,
): MapUv | null {
  const params = compileProjectionKernelParams({
    mode,
    width,
    height,
    radiusScale,
    innerSplit: innerGuideSplit,
    horizonSplit: carrierHorizonRadius,
    surface,
  });
  const sample = sourceDirectionToUvKernel(
    d.vec3f(direction[0], direction[1], direction[2]),
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

export function sourceMapPointToUv(point: SourceMapPoint, mode: SourceProjectionMode, width = 1, height = 1): MapUv {
  const azimuth = (point.azimuth * Math.PI) / 180;
  const sinAzimuth = Math.sin(azimuth);
  const cosAzimuth = Math.cos(azimuth);
  const radius = Math.max(0, Math.min(Number(point.radius) || 0, 1));
  if (sourceProjectionIsUnwrappedCylinderCarrier(mode)) {
    const signedAzimuth = ((((point.azimuth + 180) % 360) + 360) % 360) - 180;
    return {
      u: 0.5 + signedAzimuth / 360,
      v: 1 - radius,
    };
  }
  const squareScale =
    sourceProjectionIsCaveCarrier(mode) || sourceProjectionIsGabledShellCarrier(mode)
      ? 1 / Math.max(Math.abs(sinAzimuth), Math.abs(cosAzimuth), 0.000001)
      : 1;
  const dx = sinAzimuth * radius * squareScale;
  const dy = -cosAzimuth * radius * squareScale;
  const scale = sourceMapRasterScale(mode, width, height);
  return {
    u: 0.5 + dx * scale.x * 0.5,
    v: 0.5 + dy * scale.y * 0.5,
  };
}

export function sourceUvToMapPoint(
  u: number,
  v: number,
  mode: SourceProjectionMode,
  width = 1,
  height = 1,
): SourceMapPoint | null {
  if (u < -0.000001 || u > 1.000001 || v < -0.000001 || v > 1.000001) return null;
  if (sourceProjectionIsUnwrappedCylinderCarrier(mode)) {
    return {
      radius: 1 - Math.max(0, Math.min(v, 1)),
      azimuth: normalizeDegrees((Math.max(0, Math.min(u, 1)) - 0.5) * 360),
    };
  }
  const scale = sourceMapRasterScale(mode, width, height);
  const dx = ((Math.max(0, Math.min(u, 1)) - 0.5) * 2) / scale.x;
  const dy = ((Math.max(0, Math.min(v, 1)) - 0.5) * 2) / scale.y;
  const radius =
    sourceProjectionIsCaveCarrier(mode) || sourceProjectionIsGabledShellCarrier(mode)
      ? Math.max(Math.abs(dx), Math.abs(dy))
      : Math.hypot(dx, dy);
  if (sourceProjectionUsesCircularDomain(mode) && radius > 1.0001) return null;
  return {
    radius: Math.max(0, Math.min(radius, 1)),
    azimuth: normalizeDegrees((Math.atan2(dx, -dy) * 180) / Math.PI),
  };
}

export function sourceMapPointToDirection(
  point: SourceMapPoint,
  mode: SourceProjectionMode,
  width = 2,
  height = 2,
  radiusScale: number | string | null = 1,
  innerGuideSplit?: number | string | null,
  carrierHorizonRadius?: number | string | null,
  surface?: ProjectionSurface | null,
): Vec3 | null {
  const uv = sourceMapPointToUv(point, mode, width, height);
  return sourceUvToDirection(
    uv.u,
    uv.v,
    mode,
    width,
    height,
    radiusScale,
    innerGuideSplit,
    carrierHorizonRadius,
    surface,
  );
}

export function sourceDirectionToMapPoint(
  direction: Vec3,
  mode: SourceProjectionMode,
  width = 2,
  height = 2,
  radiusScale: number | string | null = 1,
  innerGuideSplit?: number | string | null,
  carrierHorizonRadius?: number | string | null,
  surface?: ProjectionSurface | null,
): SourceMapPoint | null {
  const uv = sourceDirectionToUv(
    direction,
    mode,
    width,
    height,
    radiusScale,
    innerGuideSplit,
    carrierHorizonRadius,
    surface,
  );
  return uv ? sourceUvToMapPoint(uv.u, uv.v, mode, width, height) : null;
}

function sourceMapRasterScale(mode: SourceProjectionMode, width: number, height: number): { x: number; y: number } {
  if (sourceProjectionIsSurfaceCarrier(mode)) return { x: 1, y: 1 };
  const safeWidth = Math.max(0.000001, Number(width) || 1);
  const safeHeight = Math.max(0.000001, Number(height) || 1);
  const shortEdge = Math.min(safeWidth, safeHeight);
  return { x: shortEdge / safeWidth, y: shortEdge / safeHeight };
}

export function sourceUvToDirection(
  u: number,
  v: number,
  mode: SourceProjectionMode,
  width = 2,
  height = 2,
  radiusScale: number | string | null = 1,
  innerGuideSplit?: number | string | null,
  carrierHorizonRadius?: number | string | null,
  surface?: ProjectionSurface | null,
): Vec3 | null {
  return createSourceUvToDirectionMapper({
    mode,
    width,
    height,
    radiusScale,
    innerGuideSplit,
    carrierHorizonRadius,
    surface,
  })(u, v);
}

/** Compiles the shared CPU/GPU kernel parameters once for dense raster reprojection. */
export function createSourceUvToDirectionMapper({
  mode,
  width = 2,
  height = 2,
  radiusScale = 1,
  innerGuideSplit,
  carrierHorizonRadius,
  surface,
}: {
  mode: SourceProjectionMode;
  width?: number;
  height?: number;
  radiusScale?: number | string | null;
  innerGuideSplit?: number | string | null;
  carrierHorizonRadius?: number | string | null;
  surface?: ProjectionSurface | null;
}): (u: number, v: number) => Vec3 | null {
  const params = compileProjectionKernelParams({
    mode,
    width,
    height,
    radiusScale,
    innerSplit: innerGuideSplit,
    horizonSplit: carrierHorizonRadius,
    surface,
  });
  return (u, v) => {
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
    return sample.w < 0.5 ? null : [sample.x, sample.y, sample.z];
  };
}

export function sourceProjectionUsesRadialCarrierRemap(
  mode: SourceProjectionMode,
  innerGuideSplit?: number | string | null,
): boolean {
  return (
    projectionCarrierProfile(mode).topology === "circular-fisheye" &&
    innerGuideSplit !== undefined &&
    innerGuideSplit !== null
  );
}

export function sourcePhysicalRadiusToCarrierRadius(
  physicalRadius: number,
  mode: SourceProjectionMode,
  innerGuideSplit?: number | string | null,
  carrierHorizonRadius?: number | string | null,
): number {
  if (!sourceProjectionUsesRadialCarrierRemap(mode, innerGuideSplit)) return clamp(physicalRadius, 0, 1);
  const anchors = sourceRadialCarrierAnchors(mode, innerGuideSplit, carrierHorizonRadius);
  return piecewiseMapRadius(clamp(physicalRadius, 0, 1), anchors.physical, anchors.carrier);
}

export function sourceCarrierRadiusToPhysicalRadius(
  carrierRadius: number,
  mode: SourceProjectionMode,
  innerGuideSplit?: number | string | null,
  carrierHorizonRadius?: number | string | null,
): number {
  if (!sourceProjectionUsesRadialCarrierRemap(mode, innerGuideSplit)) return clamp(carrierRadius, 0, 1);
  const anchors = sourceRadialCarrierAnchors(mode, innerGuideSplit, carrierHorizonRadius);
  return piecewiseMapRadius(clamp(carrierRadius, 0, 1), anchors.carrier, anchors.physical);
}

function sourceRadialCarrierAnchors(
  mode: SourceProjectionMode,
  innerGuideSplit?: number | string | null,
  carrierHorizonRadius?: number | string | null,
): { physical: [number, number, number, number]; carrier: [number, number, number, number] } {
  const split = normalizeSourceInnerGuideSplit(innerGuideSplit, mode);
  const horizon = clamp(sourceProjectionHorizonRadius(mode), 0.0001, 1);
  const semanticPhysical = clamp(horizon * 0.5, 0.0001, Math.max(horizon - 0.0001, 0.0001));
  const carrierHorizon = horizon < 0.999 ? sourceGuideCarrierHorizonRadius(mode, split, carrierHorizonRadius) : 1;
  return {
    physical: [0, semanticPhysical, horizon, 1],
    carrier: [0, split, carrierHorizon, 1],
  };
}

function piecewiseMapRadius(
  value: number,
  from: [number, number, number, number],
  to: [number, number, number, number],
): number {
  for (let index = 0; index < from.length - 1; index += 1) {
    const start = from[index];
    const end = from[index + 1];
    if (value <= end + 0.000001) {
      const amount = (value - start) / Math.max(end - start, 0.000001);
      return clamp(to[index] + amount * (to[index + 1] - to[index]), 0, 1);
    }
  }
  return 1;
}

function normalizeDegrees(value: number): number {
  return ((value % 360) + 360) % 360;
}
