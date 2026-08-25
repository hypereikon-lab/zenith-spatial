import { z } from "zod";

/**
 * Persisted source-map projection identifiers.
 *
 * This is the JSON boundary for projection identity. Geometry owns the
 * numerical profiles; contracts and UI must import this list instead of
 * recreating projection unions locally.
 */
export const SOURCE_PROJECTION_MODES = [
  "zenith-180",
  "zenith-230",
  "nadir-180",
  "cave-270",
  "hall-double-gable",
  "cylinder-nadir",
  "cylinder-zenith",
  "cylinder-wall",
] as const;

export const SourceProjectionModeSchema = z.enum(SOURCE_PROJECTION_MODES);

export type SourceProjectionMode = (typeof SOURCE_PROJECTION_MODES)[number];

export const SOURCE_PROJECTION_DEFAULT_GUIDES: Readonly<
  Record<SourceProjectionMode, { innerSplit: number; horizonSplit: number }>
> = {
  "zenith-180": { innerSplit: 1 / 3, horizonSplit: 1 },
  "zenith-230": { innerSplit: 1 / 3, horizonSplit: 18 / 23 },
  "nadir-180": { innerSplit: 1 / 3, horizonSplit: 1 },
  "cave-270": { innerSplit: 1 / 3, horizonSplit: 2 / 3 },
  "hall-double-gable": { innerSplit: 0.36, horizonSplit: 0.68 },
  "cylinder-nadir": { innerSplit: 0.02, horizonSplit: 0.51 },
  "cylinder-zenith": { innerSplit: 0.02, horizonSplit: 0.51 },
  "cylinder-wall": { innerSplit: 0.5, horizonSplit: 1 },
};

export function isSourceProjectionMode(value: unknown): value is SourceProjectionMode {
  return SOURCE_PROJECTION_MODES.some((mode) => mode === value);
}
