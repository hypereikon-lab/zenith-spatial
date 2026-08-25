import { d } from "typegpu";
import type { SourceProjectionMode } from "../lib/shared/contracts/projection-profile.js";
import {
  normalizeProjectionSurfaceForMode,
  planarRoofProfile,
  projectionSpatialAnchors,
  type DoubleGableProjectionSurface,
  type ProjectionSurface,
} from "../lib/shared/contracts/projection-authoring.js";
import { createFisheyeProjectionProfile } from "./fisheye-projection.js";
import {
  projectionCarrierProfile,
  sourceProjectionIsSurfaceCarrier,
  sourceProjectionUsesCircularDomain,
} from "./projection-carrier-profile.js";
import { normalizeSourceInnerGuideSplit, sourceGuideCarrierHorizonRadius } from "./source-guide-semantics.js";
import {
  ProjectionCenterCode,
  ProjectionDomainCode,
  ProjectionKernelFlag,
  projectionModeCode,
  ProjectionTopologyCode,
} from "../kernels/projection/constants.js";

export type ProjectionKernelParameterInput = {
  mode: SourceProjectionMode;
  width?: number | string | null;
  height?: number | string | null;
  radiusScale?: number | string | null;
  innerSplit?: number | string | null;
  /** Optional render-only carrier split; preserves authored placement coordinates. */
  rasterInnerSplit?: number | string | null;
  horizonSplit?: number | string | null;
  surface?: ProjectionSurface | null;
};

export function compileProjectionKernelParams({
  mode,
  width = 2,
  height = 2,
  radiusScale = 1,
  innerSplit,
  rasterInnerSplit,
  horizonSplit,
  surface,
}: ProjectionKernelParameterInput) {
  const carrier = projectionCarrierProfile(mode);
  const safeWidth = Math.max(1, Math.round(finiteNumber(width, 2)));
  const safeHeight = Math.max(1, Math.round(finiteNumber(height, 2)));
  const safeRadiusScale = clamp(finiteNumber(radiusScale, 1), 0.05, 2);
  const shortEdge = Math.min(safeWidth, safeHeight);
  const normalizedInnerSplit =
    rasterInnerSplit === undefined || rasterInnerSplit === null
      ? normalizeSourceInnerGuideSplit(innerSplit, mode)
      : clamp(finiteNumber(rasterInnerSplit, 1), 0.001, 1);
  const authoredHorizonSplit = sourceGuideCarrierHorizonRadius(mode, innerSplit, horizonSplit);
  const normalizedHorizonSplit =
    rasterInnerSplit === undefined || rasterInnerSplit === null
      ? authoredHorizonSplit
      : clamp(Math.max(normalizedInnerSplit, authoredHorizonSplit), normalizedInnerSplit, 1);
  const resolvedSurface = normalizeProjectionSurfaceForMode(surface, mode);
  const fieldOfViewDegrees = carrier.fieldOfViewDegrees ?? 180;
  const fisheye = createFisheyeProjectionProfile({
    width: safeWidth,
    height: safeHeight,
    radiusScale: safeRadiusScale,
    center: carrier.center,
    fieldOfViewDegrees,
  });
  const topology = topologyCode(mode);
  const domain = domainCode(mode);
  const radialRemap =
    !sourceProjectionIsSurfaceCarrier(mode) &&
    ((innerSplit !== undefined && innerSplit !== null) ||
      (rasterInnerSplit !== undefined && rasterInnerSplit !== null));
  let flags = 0;
  if (radialRemap) flags |= ProjectionKernelFlag.RadialRemap;
  if (sourceProjectionIsSurfaceCarrier(mode)) flags |= ProjectionKernelFlag.SurfaceCarrier;
  if (sourceProjectionUsesCircularDomain(mode)) flags |= ProjectionKernelFlag.CircularDomain;
  if (mode === "cylinder-wall") flags |= ProjectionKernelFlag.HorizontalWrap;

  const roofAnchors = resolvedSurface.kind === "double-gable-room" ? planarRoofProfile(resolvedSurface) : [];
  const roofProfile = compilePlanarRoofProfileKernelParams(
    resolvedSurface.kind === "double-gable-room" ? resolvedSurface : null,
  );
  const roofHeights = paddedRoofValues(roofAnchors.map((anchor) => anchor.height));

  const boxSize =
    resolvedSurface.kind === "box-room"
      ? d.vec3f(f32(resolvedSurface.width), f32(resolvedSurface.depth), f32(resolvedSurface.height))
      : resolvedSurface.kind === "double-gable-room"
        ? d.vec3f(f32(resolvedSurface.length), f32(resolvedSurface.width), f32(roofHeights[0]))
        : d.vec3f(0, 0, 0);
  const boxObserver =
    resolvedSurface.kind === "box-room" || resolvedSurface.kind === "double-gable-room"
      ? d.vec3f(f32(resolvedSurface.eyeX), f32(resolvedSurface.eyeHeight), f32(resolvedSurface.eyeZ))
      : d.vec3f(0, 0, 0);
  const doubleGable =
    resolvedSurface.kind === "double-gable-room"
      ? d.vec4f(f32(resolvedSurface.ridgeHeight), f32(resolvedSurface.valleyHeight), f32(resolvedSurface.ridgeInset), 0)
      : d.vec4f(0, 0, 0, 0);
  const cylinder =
    resolvedSurface.kind === "cylinder"
      ? d.vec3f(f32(resolvedSurface.radius), f32(resolvedSurface.height), f32(resolvedSurface.eyeHeight))
      : d.vec3f(0, 0, 0);
  const physicalAnchors = compilePhysicalAnchorPositions(mode, resolvedSurface, fieldOfViewDegrees);

  return {
    mode: projectionModeCode(mode),
    topology,
    center: carrier.center === "nadir" ? ProjectionCenterCode.Nadir : ProjectionCenterCode.Zenith,
    domain,
    flags: flags >>> 0,
    rasterSize: d.vec2f(f32(safeWidth), f32(safeHeight)),
    rasterScale: d.vec2f(f32(shortEdge / safeWidth), f32(shortEdge / safeHeight)),
    fisheyeScale: d.vec2f(f32(fisheye.fisheyeScaleX), f32(fisheye.fisheyeScaleY)),
    halfAngle: f32((fieldOfViewDegrees * 0.5 * Math.PI) / 180),
    innerSplit: f32(normalizedInnerSplit),
    horizonSplit: f32(normalizedHorizonSplit),
    physicalSemantic: f32(physicalAnchors.semantic),
    physicalHorizon: f32(physicalAnchors.horizon),
    centerAxis: d.vec3f(...(fisheye.centerAxis.map(f32) as [number, number, number])),
    imageRightAxis: d.vec3f(...(fisheye.imageRightAxis.map(f32) as [number, number, number])),
    imageUpAxis: d.vec3f(...(fisheye.imageUpAxis.map(f32) as [number, number, number])),
    boxSize,
    boxObserver,
    roofProfile,
    doubleGable,
    cylinder,
  };
}

export function compilePlanarRoofProfileKernelParams(surface: DoubleGableProjectionSurface | null) {
  const anchors = surface ? planarRoofProfile(surface) : [];
  const positions = paddedRoofValues(anchors.map((anchor) => anchor.position));
  const heights = paddedRoofValues(anchors.map((anchor) => anchor.height));
  return {
    positionsA: d.vec4f(...(positions.slice(0, 4) as [number, number, number, number])),
    positionsB: d.vec4f(...(positions.slice(4, 8) as [number, number, number, number])),
    heightsA: d.vec4f(...(heights.slice(0, 4) as [number, number, number, number])),
    heightsB: d.vec4f(...(heights.slice(4, 8) as [number, number, number, number])),
    count: anchors.length,
  };
}

function paddedRoofValues(values: number[]): [number, number, number, number, number, number, number, number] {
  const fallback = f32(values.at(-1) ?? 0);
  return Array.from({ length: 8 }, (_, index) => f32(values[index] ?? fallback)) as [
    number,
    number,
    number,
    number,
    number,
    number,
    number,
    number,
  ];
}

function topologyCode(mode: SourceProjectionMode): number {
  const topology = projectionCarrierProfile(mode).topology;
  if (topology === "square-perimeter") return ProjectionTopologyCode.CavePerimeter;
  if (topology === "gabled-shell") return ProjectionTopologyCode.GabledShell;
  if (topology === "circular-cylinder") return ProjectionTopologyCode.CylinderRadial;
  if (topology === "unwrapped-cylinder") return ProjectionTopologyCode.CylinderWall;
  return ProjectionTopologyCode.Fisheye;
}

function domainCode(mode: SourceProjectionMode): number {
  const topology = projectionCarrierProfile(mode).topology;
  if (topology === "square-perimeter") return ProjectionDomainCode.Square;
  if (topology === "gabled-shell") return ProjectionDomainCode.Square;
  if (topology === "unwrapped-cylinder") return ProjectionDomainCode.Rectangular;
  return ProjectionDomainCode.Circular;
}

function compilePhysicalAnchorPositions(
  mode: SourceProjectionMode,
  surface: ProjectionSurface,
  fieldOfViewDegrees: number,
): { semantic: number; horizon: number } {
  if (surface.kind === "box-room") {
    return { semantic: 0, horizon: projectionSpatialAnchors(surface).horizonHeight / surface.height };
  }
  if (surface.kind === "double-gable-room") {
    return { semantic: 0, horizon: projectionSpatialAnchors(surface).horizonHeight };
  }
  if (surface.kind === "cylinder") {
    const heightFraction = projectionSpatialAnchors(surface).horizonHeight / surface.height;
    return { semantic: 0, horizon: mode === "cylinder-zenith" ? 1 - heightFraction : heightFraction };
  }
  const anchors = projectionSpatialAnchors(surface);
  const halfAngleDegrees = Math.max(fieldOfViewDegrees * 0.5, 0.000001);
  const radialPosition = (elevationDegrees: number) =>
    clamp((mode === "nadir-180" ? elevationDegrees + 90 : 90 - elevationDegrees) / halfAngleDegrees, 0.0001, 0.9999);
  const semantic = radialPosition(anchors.semanticElevationDegrees);
  const horizon = radialPosition(anchors.horizonElevationDegrees);
  return {
    semantic: Math.min(semantic, Math.max(horizon - 0.0001, 0.0001)),
    horizon,
  };
}

function finiteNumber(value: unknown, fallback: number): number {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(Math.max(value, minimum), maximum);
}

function f32(value: number): number {
  return Math.fround(value);
}
