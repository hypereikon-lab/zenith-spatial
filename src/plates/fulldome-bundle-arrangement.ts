import { wrapDegrees } from "../projection.js";
import { normalizePlatePlacement, type NormalizedPlatePlacement, type PlateLike } from "./plate-placement.js";

export const FULLDOME_BUNDLE_ORIENTATIONS = ["profile", "mirrored"] as const;
export const FULLDOME_BUNDLE_LAYOUT = "upper-dominant-radial-v3" as const;

export type FulldomeBundleOrientation = (typeof FULLDOME_BUNDLE_ORIENTATIONS)[number];
export type FulldomeBundleSlot = "upper-dominant" | "front-center" | "front-left" | "front-right";

export type FulldomeBundleArrangementOptions = {
  /** Source that owns the large upper position. */
  readonly dominantIndex?: number;
  /** @deprecated Compatibility alias for pre-v2 callers. Use dominantIndex. */
  readonly zenithIndex?: number;
  /** Mirrors the spatial arrangement without mirroring source pixels. */
  readonly orientation?: FulldomeBundleOrientation;
};

export type FulldomeBundleArrangement = {
  readonly layout: typeof FULLDOME_BUNDLE_LAYOUT;
  readonly placements: NormalizedPlatePlacement[];
  readonly slots: FulldomeBundleSlot[];
  readonly activeIndex: number;
  readonly dominantIndex: number;
  readonly orientation: FulldomeBundleOrientation;
};

type FulldomeBundleProfile = Record<FulldomeBundleSlot, NormalizedPlatePlacement>;
type FulldomePairProfile = Pick<FulldomeBundleProfile, "upper-dominant" | "front-center">;

const BASE_PLACEMENT = {
  opacity: 1,
  flipX: false,
  flipY: false,
  cornerOffsets: {
    nw: { x: 0, y: 0 },
    ne: { x: 0, y: 0 },
    se: { x: 0, y: 0 },
    sw: { x: 0, y: 0 },
  },
} as const;

/**
 * Source-map layout for an equidistant 180° domemaster.
 *
 * The pair profile is captured from the authored Zenith Workbench composition:
 * the dominant source occupies the upper field with a small counter-clockwise
 * azimuth offset, while the secondary source sits in the lower/front field with
 * an intentional clockwise spin. The trio keeps its own balanced left/right
 * geometry rather than extrapolating the asymmetric pair.
 */
export const FULLDOME_BUNDLE_PROFILE: FulldomeBundleProfile = {
  "upper-dominant": {
    ...BASE_PLACEMENT,
    azimuth: 0,
    radius: 0.62,
    scale: 2.08,
    spin: 0,
  },
  "front-center": {
    ...BASE_PLACEMENT,
    azimuth: 180,
    radius: 0.61,
    scale: 1.72,
    spin: 0,
  },
  "front-left": {
    ...BASE_PLACEMENT,
    azimuth: -142,
    radius: 0.61,
    scale: 1.7,
    spin: 0,
  },
  "front-right": {
    ...BASE_PLACEMENT,
    azimuth: 142,
    radius: 0.61,
    scale: 1.7,
    spin: 0,
  },
};

/** Exact two-source default authored in the Zenith Workbench. */
export const FULLDOME_PAIR_PROFILE: FulldomePairProfile = {
  "upper-dominant": {
    ...BASE_PLACEMENT,
    azimuth: -14.6223,
    radius: 0.6058,
    scale: 2.17,
    spin: 0.8719,
  },
  "front-center": {
    ...BASE_PLACEMENT,
    azimuth: 157.3278,
    radius: 0.5176,
    scale: 1.55,
    spin: -22.238,
  },
};

/**
 * Places one curated pair or trio into a deterministic fulldome source map.
 *
 * The operation is image-agnostic. Curation chooses the dominant source;
 * Zenith only assigns a large upper slot and one or two substantial front
 * slots. Pair placement follows the authored default; trio placement remains
 * radially balanced around the central zenith.
 */
export function arrangeFulldomeBundle(
  plates: ReadonlyArray<PlateLike>,
  options: FulldomeBundleArrangementOptions,
): FulldomeBundleArrangement {
  if (plates.length !== 2 && plates.length !== 3) {
    throw new RangeError(`Fulldome bundles require exactly 2 or 3 visible sources; received ${plates.length}.`);
  }
  const dominantIndex = resolveDominantIndex(options);
  if (!Number.isInteger(dominantIndex) || dominantIndex < 0 || dominantIndex >= plates.length) {
    throw new RangeError(`Dominant source index ${dominantIndex} is outside this ${plates.length}-source bundle.`);
  }

  const orientation = options.orientation ?? "profile";
  const secondarySlots: FulldomeBundleSlot[] = plates.length === 2 ? ["front-center"] : ["front-left", "front-right"];
  const slots = plates.map<FulldomeBundleSlot>((_, index) => {
    if (index === dominantIndex) return "upper-dominant";
    const secondaryIndex = index < dominantIndex ? index : index - 1;
    return secondarySlots[secondaryIndex]!;
  });
  const placements = plates.map((plate, index) => {
    const slot = slots[index]!;
    const profile =
      plates.length === 2 ? FULLDOME_PAIR_PROFILE[slot as keyof FulldomePairProfile] : FULLDOME_BUNDLE_PROFILE[slot];
    const placement =
      orientation === "mirrored"
        ? { ...profile, azimuth: wrapDegrees(-profile.azimuth), spin: wrapDegrees(-profile.spin) }
        : profile;
    return normalizePlatePlacement(placement, plate);
  });

  return {
    layout: FULLDOME_BUNDLE_LAYOUT,
    placements,
    slots,
    activeIndex: dominantIndex,
    dominantIndex,
    orientation,
  };
}

export function isFulldomeBundleSize(count: number): count is 2 | 3 {
  return count === 2 || count === 3;
}

function resolveDominantIndex({ dominantIndex, zenithIndex }: FulldomeBundleArrangementOptions): number {
  if (dominantIndex !== undefined && zenithIndex !== undefined && dominantIndex !== zenithIndex) {
    throw new RangeError(`dominantIndex ${dominantIndex} conflicts with legacy zenithIndex ${zenithIndex}.`);
  }
  const resolved = dominantIndex ?? zenithIndex;
  if (resolved === undefined) throw new RangeError("dominantIndex is required.");
  return resolved;
}
