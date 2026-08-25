import { DEFAULT_ACTIVE_PLATE_INDEX, DEFAULT_PLATE_PLACEMENTS } from "./default-plate-profile.js";
import { clamp, wrapDegrees } from "../projection.js";
import { normalizePlatePlacement } from "./plate-placement.js";
import type { NormalizedPlatePlacement, PlateLike, PlatePlacementInput } from "./plate-placement.js";

export type SerializedPlatePlacement = {
  azimuth: number;
  radius: number;
  scale: number;
  spin: number;
  opacity: number;
  flipX: boolean;
  flipY: boolean;
  cornerOffsets: {
    nw: { x: number; y: number };
    ne: { x: number; y: number };
    se: { x: number; y: number };
    sw: { x: number; y: number };
  };
};

export type PlateSketchArrangement = {
  placements: NormalizedPlatePlacement[];
  activeIndex: number;
};

export function arrangePlateSketchDefaults(plates: PlateLike[]): PlateSketchArrangement {
  return {
    placements: plates.map((plate, index) =>
      normalizePlatePlacement(defaultPlateSketchPlacement(index, plates.length, plate), plate),
    ),
    activeIndex: plates.length === DEFAULT_PLATE_PLACEMENTS.length ? DEFAULT_ACTIVE_PLATE_INDEX : 0,
  };
}

export function defaultPlateSketchPlacement(index: number, plateCount: number, plate: PlateLike): PlatePlacementInput {
  if (plateCount === DEFAULT_PLATE_PLACEMENTS.length && DEFAULT_PLATE_PLACEMENTS[index]) {
    return { ...DEFAULT_PLATE_PLACEMENTS[index] };
  }
  const goldenAngle = 137.507764;
  return {
    azimuth: wrapDegrees(index * goldenAngle + 180),
    radius: plateCount === 1 ? 0.35 : clamp(0.16 + 0.78 * Math.sqrt(index / Math.max(1, plateCount - 1)), 0, 0.94),
    scale: clamp(1.18 / Math.sqrt(Math.max(1, plateCount)), 0.22, 0.92),
    spin: 0,
    opacity: 1,
    flipX: false,
    flipY: false,
    aspect: plate.aspect,
  };
}

export function serializePlateSketchPlacement(placement: NormalizedPlatePlacement): SerializedPlatePlacement {
  return {
    azimuth: roundPlateSketchPlacementValue(placement.azimuth),
    radius: roundPlateSketchPlacementValue(placement.radius),
    scale: roundPlateSketchPlacementValue(placement.scale),
    spin: roundPlateSketchPlacementValue(placement.spin),
    opacity: roundPlateSketchPlacementValue(placement.opacity),
    flipX: placement.flipX,
    flipY: placement.flipY,
    cornerOffsets: {
      nw: {
        x: roundPlateSketchPlacementValue(placement.cornerOffsets.nw.x),
        y: roundPlateSketchPlacementValue(placement.cornerOffsets.nw.y),
      },
      ne: {
        x: roundPlateSketchPlacementValue(placement.cornerOffsets.ne.x),
        y: roundPlateSketchPlacementValue(placement.cornerOffsets.ne.y),
      },
      se: {
        x: roundPlateSketchPlacementValue(placement.cornerOffsets.se.x),
        y: roundPlateSketchPlacementValue(placement.cornerOffsets.se.y),
      },
      sw: {
        x: roundPlateSketchPlacementValue(placement.cornerOffsets.sw.x),
        y: roundPlateSketchPlacementValue(placement.cornerOffsets.sw.y),
      },
    },
  };
}

export function countWarpedPlateSketchCorners(placements: SerializedPlatePlacement[]): number {
  return placements.reduce(
    (count, placement) =>
      count +
      Object.values(placement.cornerOffsets).filter(
        (offset) => Math.abs(offset.x) > 0.0001 || Math.abs(offset.y) > 0.0001,
      ).length,
    0,
  );
}

function roundPlateSketchPlacementValue(value: number): number {
  return Math.round(value * 10000) / 10000;
}
