import {
  normalizeSourceProjectionMode,
  sourceDirectionToMapPoint,
  sourceMapPointToDirection,
  sourceProjectionCenterLabel,
} from "../geometry/source-projection.js";
import {
  normalizeSourceGuideCarrierHorizonRadius,
  normalizeSourceInnerGuideSplit,
  sourceGuideCarrierHorizonRadius,
} from "../geometry/source-guide-semantics.js";
import type { SourceProjectionMode } from "../geometry/source-projection.js";
import type { DomeScenePlateLayer, DomeScenePlatePlacement } from "../lib/shared/contracts/dome-scene.js";
import {
  normalizeProjectionSurfaceForMode,
  type CarrierRaster,
  type ProjectionSurface,
} from "../lib/shared/contracts/projection-authoring.js";
import type { PlatePlacementInput } from "./plate-placement.js";

export type PlateProjectionGeometry = {
  mode: SourceProjectionMode | string | null | undefined;
  guideSplit?: number | string | null;
  horizonSplit?: number | string | null;
  surface?: ProjectionSurface | null;
  raster?: Pick<CarrierRaster, "width" | "height"> | null;
};

export function shouldFlipPlateVerticallyForProjectionChange(
  previousMode: SourceProjectionMode | string | null | undefined,
  nextMode: SourceProjectionMode | string | null | undefined,
): boolean {
  return projectionCenter(previousMode) !== projectionCenter(nextMode);
}

export function compensatePlatePlacementsForProjectionGeometryChange<T extends PlatePlacementInput>(
  placements: readonly T[],
  previousGeometry: PlateProjectionGeometry,
  nextGeometry: PlateProjectionGeometry,
): T[] {
  const previous = normalizedGeometry(previousGeometry);
  const next = normalizedGeometry(nextGeometry);
  if (sameProjectionGeometry(previous, next)) {
    return placements.map((placement) => ({ ...placement }));
  }
  const flipY = shouldFlipPlateVerticallyForProjectionChange(previous.mode, next.mode);

  return placements.map((placement) => {
    const radius = finiteRadius(placement.radius);
    const azimuth = finiteNumber(placement.azimuth, 0);
    const direction = sourceMapPointToDirection(
      { radius, azimuth },
      previous.mode,
      previous.raster.width,
      previous.raster.height,
      1,
      previous.guideSplit,
      previous.horizonSplit,
      previous.surface,
    );
    const mapped = direction
      ? sourceDirectionToMapPoint(
          direction,
          next.mode,
          next.raster.width,
          next.raster.height,
          1,
          next.guideSplit,
          next.horizonSplit,
          next.surface,
        )
      : null;

    return {
      ...placement,
      radius: mapped?.radius ?? remapCarrierRadius(radius, previous, next, flipY),
      azimuth: mapped?.azimuth ?? azimuth,
      ...(flipY ? { flipY: !placement.flipY } : {}),
    };
  });
}

export function compensateDomeScenePlateLayersForProjectionGeometryChange(
  layers: readonly DomeScenePlateLayer[],
  previousGeometry: PlateProjectionGeometry,
  nextGeometry: PlateProjectionGeometry,
): DomeScenePlateLayer[] {
  return layers.map((layer) => {
    const [placement] = compensatePlatePlacementsForProjectionGeometryChange(
      [layer.placement],
      previousGeometry,
      nextGeometry,
    ) as DomeScenePlatePlacement[];
    return { ...layer, placement };
  });
}

function remapCarrierRadius(
  radius: number,
  previous: Required<PlateProjectionGeometry> & { mode: SourceProjectionMode },
  next: Required<PlateProjectionGeometry> & { mode: SourceProjectionMode },
  reversesVerticalAxis: boolean,
): number {
  const previousHorizon = sourceGuideCarrierHorizonRadius(previous.mode, previous.guideSplit, previous.horizonSplit);
  const nextHorizon = sourceGuideCarrierHorizonRadius(next.mode, next.guideSplit, next.horizonSplit);
  const insideFraction = previousHorizon > 0.000001 ? radius / previousHorizon : 0;
  const outsideFraction = 1 - previousHorizon > 0.000001 ? (radius - previousHorizon) / (1 - previousHorizon) : 0;

  if (!reversesVerticalAxis) {
    return radius <= previousHorizon
      ? clamp01(insideFraction * nextHorizon)
      : clamp01(nextHorizon + outsideFraction * (1 - nextHorizon));
  }

  // Zenith- and nadir-centered carriers run away from the physical horizon in
  // opposite directions. Preserve the horizon-relative height when the exact
  // physical direction is outside the destination projection's field of view.
  return radius <= previousHorizon
    ? clamp01(nextHorizon + (1 - insideFraction) * (1 - nextHorizon))
    : clamp01(nextHorizon * (1 - outsideFraction));
}

function normalizedGeometry(geometry: PlateProjectionGeometry): {
  mode: SourceProjectionMode;
  guideSplit: number;
  horizonSplit: number;
  surface: ProjectionSurface;
  raster: { width: number; height: number };
} {
  const mode = normalizeSourceProjectionMode(geometry.mode);
  const guideSplit = normalizeSourceInnerGuideSplit(geometry.guideSplit, mode);
  return {
    mode,
    guideSplit,
    horizonSplit: normalizeSourceGuideCarrierHorizonRadius(mode, guideSplit, geometry.horizonSplit),
    surface: normalizeProjectionSurfaceForMode(geometry.surface, mode),
    raster: {
      width: Math.max(1, Number(geometry.raster?.width) || 2),
      height: Math.max(1, Number(geometry.raster?.height) || 2),
    },
  };
}

function sameProjectionGeometry(
  previous: {
    mode: SourceProjectionMode;
    guideSplit: number;
    horizonSplit: number;
    surface: ProjectionSurface;
    raster: { width: number; height: number };
  },
  next: {
    mode: SourceProjectionMode;
    guideSplit: number;
    horizonSplit: number;
    surface: ProjectionSurface;
    raster: { width: number; height: number };
  },
): boolean {
  return (
    previous.mode === next.mode &&
    Math.abs(previous.guideSplit - next.guideSplit) <= 0.0000001 &&
    Math.abs(previous.horizonSplit - next.horizonSplit) <= 0.0000001 &&
    JSON.stringify(previous.surface) === JSON.stringify(next.surface) &&
    previous.raster.width === next.raster.width &&
    previous.raster.height === next.raster.height
  );
}

function projectionCenter(mode: SourceProjectionMode | string | null | undefined): "zenith" | "nadir" {
  return sourceProjectionCenterLabel(normalizeSourceProjectionMode(mode)).toLowerCase() as "zenith" | "nadir";
}

function finiteRadius(value: unknown): number {
  return clamp01(finiteNumber(value, 0));
}

function finiteNumber(value: unknown, fallback: number): number {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(value, 1));
}
