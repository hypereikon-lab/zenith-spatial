import { d } from "typegpu";
import * as std from "typegpu/std";
import type { PlanarRoofProfileKernel } from "../schemas.js";
import { KERNEL_EPSILON } from "./constants.js";

/** Reads one of eight fixed-capacity profile values without CPU/GPU indexing drift. */
export function planarRoofPackedValueKernel(index: number, valuesA: d.v4f, valuesB: d.v4f): number {
  "use gpu";
  if (index === 0) return valuesA.x;
  if (index === 1) return valuesA.y;
  if (index === 2) return valuesA.z;
  if (index === 3) return valuesA.w;
  if (index === 4) return valuesB.x;
  if (index === 5) return valuesB.y;
  if (index === 6) return valuesB.z;
  return valuesB.w;
}

export function planarRoofAnchorPositionKernel(index: number, profile: PlanarRoofProfileKernel): number {
  "use gpu";
  return planarRoofPackedValueKernel(index, profile.positionsA, profile.positionsB);
}

export function planarRoofAnchorHeightKernel(index: number, profile: PlanarRoofProfileKernel): number {
  "use gpu";
  return planarRoofPackedValueKernel(index, profile.heightsA, profile.heightsB);
}

export function planarRoofWorldZKernel(position: number, width: number): number {
  "use gpu";
  return (std.clamp(position, 0, 1) - 0.5) * width;
}

export function planarRoofSegmentHeightKernel(
  normalizedPosition: number,
  segment: number,
  profile: PlanarRoofProfileKernel,
): number {
  "use gpu";
  const startPosition = planarRoofAnchorPositionKernel(segment, profile);
  const endPosition = planarRoofAnchorPositionKernel(segment + 1, profile);
  const startHeight = planarRoofAnchorHeightKernel(segment, profile);
  const endHeight = planarRoofAnchorHeightKernel(segment + 1, profile);
  const amount = std.clamp(
    (normalizedPosition - startPosition) / std.max(endPosition - startPosition, KERNEL_EPSILON),
    0,
    1,
  );
  return startHeight + amount * (endHeight - startHeight);
}

/** Evaluates an ordered, piecewise-planar roof cross-section. */
export function planarRoofHeightKernel(worldZ: number, width: number, profile: PlanarRoofProfileKernel): number {
  "use gpu";
  const position = std.clamp(worldZ / std.max(width, KERNEL_EPSILON) + 0.5, 0, 1);
  if (profile.count < 2) return planarRoofAnchorHeightKernel(0, profile);
  if (profile.count > 1 && position <= planarRoofAnchorPositionKernel(1, profile)) {
    return planarRoofSegmentHeightKernel(position, 0, profile);
  }
  if (profile.count > 2 && position <= planarRoofAnchorPositionKernel(2, profile)) {
    return planarRoofSegmentHeightKernel(position, 1, profile);
  }
  if (profile.count > 3 && position <= planarRoofAnchorPositionKernel(3, profile)) {
    return planarRoofSegmentHeightKernel(position, 2, profile);
  }
  if (profile.count > 4 && position <= planarRoofAnchorPositionKernel(4, profile)) {
    return planarRoofSegmentHeightKernel(position, 3, profile);
  }
  if (profile.count > 5 && position <= planarRoofAnchorPositionKernel(5, profile)) {
    return planarRoofSegmentHeightKernel(position, 4, profile);
  }
  if (profile.count > 6 && position <= planarRoofAnchorPositionKernel(6, profile)) {
    return planarRoofSegmentHeightKernel(position, 5, profile);
  }
  if (profile.count > 7) return planarRoofSegmentHeightKernel(position, 6, profile);
  return planarRoofAnchorHeightKernel(profile.count - 1, profile);
}

/** Lowest authored roof height across every active profile anchor. */
export function planarRoofMinimumHeightKernel(profile: PlanarRoofProfileKernel): number {
  "use gpu";
  let height = planarRoofAnchorHeightKernel(0, profile);
  if (profile.count > 1) height = std.min(height, planarRoofAnchorHeightKernel(1, profile));
  if (profile.count > 2) height = std.min(height, planarRoofAnchorHeightKernel(2, profile));
  if (profile.count > 3) height = std.min(height, planarRoofAnchorHeightKernel(3, profile));
  if (profile.count > 4) height = std.min(height, planarRoofAnchorHeightKernel(4, profile));
  if (profile.count > 5) height = std.min(height, planarRoofAnchorHeightKernel(5, profile));
  if (profile.count > 6) height = std.min(height, planarRoofAnchorHeightKernel(6, profile));
  if (profile.count > 7) height = std.min(height, planarRoofAnchorHeightKernel(7, profile));
  return height;
}

/** Highest authored roof height across every active profile anchor. */
export function planarRoofMaximumHeightKernel(profile: PlanarRoofProfileKernel): number {
  "use gpu";
  let height = planarRoofAnchorHeightKernel(0, profile);
  if (profile.count > 1) height = std.max(height, planarRoofAnchorHeightKernel(1, profile));
  if (profile.count > 2) height = std.max(height, planarRoofAnchorHeightKernel(2, profile));
  if (profile.count > 3) height = std.max(height, planarRoofAnchorHeightKernel(3, profile));
  if (profile.count > 4) height = std.max(height, planarRoofAnchorHeightKernel(4, profile));
  if (profile.count > 5) height = std.max(height, planarRoofAnchorHeightKernel(5, profile));
  if (profile.count > 6) height = std.max(height, planarRoofAnchorHeightKernel(6, profile));
  if (profile.count > 7) height = std.max(height, planarRoofAnchorHeightKernel(7, profile));
  return height;
}

/**
 * Normalized physical height of the piecewise-planar roof at worldZ.
 * A flat profile resolves to the neutral midpoint instead of a false ridge.
 */
export function planarRoofNormalizedHeightKernel(
  worldZ: number,
  width: number,
  profile: PlanarRoofProfileKernel,
): number {
  "use gpu";
  const minimum = planarRoofMinimumHeightKernel(profile);
  const maximum = planarRoofMaximumHeightKernel(profile);
  const range = maximum - minimum;
  if (range <= KERNEL_EPSILON) return 0.5;
  return std.clamp((planarRoofHeightKernel(worldZ, width, profile) - minimum) / range, 0, 1);
}

/** Physical rise/run slope of one authored roof plane. */
export function planarRoofSegmentSlopeKernel(segment: number, width: number, profile: PlanarRoofProfileKernel): number {
  "use gpu";
  const safeSegment = std.clamp(segment, 0, 6);
  const startPosition = planarRoofAnchorPositionKernel(safeSegment, profile);
  const endPosition = planarRoofAnchorPositionKernel(safeSegment + 1, profile);
  const startHeight = planarRoofAnchorHeightKernel(safeSegment, profile);
  const endHeight = planarRoofAnchorHeightKernel(safeSegment + 1, profile);
  const run = std.max((endPosition - startPosition) * width, KERNEL_EPSILON);
  return (endHeight - startHeight) / run;
}

/** Returns the zero-based planar roof segment containing worldZ. */
export function planarRoofSegmentKernel(worldZ: number, width: number, profile: PlanarRoofProfileKernel): number {
  "use gpu";
  const position = std.clamp(worldZ / std.max(width, KERNEL_EPSILON) + 0.5, 0, 1);
  if (profile.count < 2 || position <= planarRoofAnchorPositionKernel(1, profile)) return 0;
  if (profile.count < 3 || position <= planarRoofAnchorPositionKernel(2, profile)) return 1;
  if (profile.count < 4 || position <= planarRoofAnchorPositionKernel(3, profile)) return 2;
  if (profile.count < 5 || position <= planarRoofAnchorPositionKernel(4, profile)) return 3;
  if (profile.count < 6 || position <= planarRoofAnchorPositionKernel(5, profile)) return 4;
  if (profile.count < 7 || position <= planarRoofAnchorPositionKernel(6, profile)) return 5;
  return 6;
}

/** Distance in metres to the nearest internal ridge/valley/break anchor. */
export function planarRoofNearestInteriorAnchorDistanceKernel(
  worldZ: number,
  width: number,
  profile: PlanarRoofProfileKernel,
): number {
  "use gpu";
  let distance = d.f32(1e30);
  if (profile.count > 2) {
    distance = std.min(
      distance,
      std.abs(worldZ - planarRoofWorldZKernel(planarRoofAnchorPositionKernel(1, profile), width)),
    );
  }
  if (profile.count > 3) {
    distance = std.min(
      distance,
      std.abs(worldZ - planarRoofWorldZKernel(planarRoofAnchorPositionKernel(2, profile), width)),
    );
  }
  if (profile.count > 4) {
    distance = std.min(
      distance,
      std.abs(worldZ - planarRoofWorldZKernel(planarRoofAnchorPositionKernel(3, profile), width)),
    );
  }
  if (profile.count > 5) {
    distance = std.min(
      distance,
      std.abs(worldZ - planarRoofWorldZKernel(planarRoofAnchorPositionKernel(4, profile), width)),
    );
  }
  if (profile.count > 6) {
    distance = std.min(
      distance,
      std.abs(worldZ - planarRoofWorldZKernel(planarRoofAnchorPositionKernel(5, profile), width)),
    );
  }
  if (profile.count > 7) {
    distance = std.min(
      distance,
      std.abs(worldZ - planarRoofWorldZKernel(planarRoofAnchorPositionKernel(6, profile), width)),
    );
  }
  return distance;
}
