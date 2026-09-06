import { wrapDegrees } from "../projection.js";
import { DEFAULT_PLATE_PLACEMENTS } from "./default-plate-profile.js";
import { normalizePlatePlacement, type NormalizedPlatePlacement, type PlateLike } from "./plate-placement.js";

export const FULLDOME_BUNDLE_ORIENTATIONS = ["profile", "mirrored"] as const;

export type FulldomeBundleOrientation = (typeof FULLDOME_BUNDLE_ORIENTATIONS)[number];
export type FulldomeBundleSlot = "field-primary" | "field-secondary" | "zenith";

export type FulldomeBundleArrangementOptions = {
  /** Index of the source that must occupy the upper/zenith slot. */
  readonly zenithIndex: number;
  /** Mirrors the captured spatial profile without mirroring source pixels. */
  readonly orientation?: FulldomeBundleOrientation;
};

export type FulldomeBundleArrangement = {
  readonly placements: NormalizedPlatePlacement[];
  readonly slots: FulldomeBundleSlot[];
  readonly activeIndex: number;
  readonly orientation: FulldomeBundleOrientation;
};

const PROFILE_INDEX_BY_SLOT: Record<FulldomeBundleSlot, number> = {
  "field-primary": 0,
  "field-secondary": 1,
  zenith: 2,
};

/**
 * Places one curated pair or trio into the proven Plate 03 fulldome profile.
 *
 * The operation is deliberately image-agnostic: curation decides which source
 * owns the zenith slot, while Zenith only applies deterministic geometry.
 */
export function arrangeFulldomeBundle(
  plates: ReadonlyArray<PlateLike>,
  { zenithIndex, orientation = "profile" }: FulldomeBundleArrangementOptions,
): FulldomeBundleArrangement {
  if (plates.length !== 2 && plates.length !== 3) {
    throw new RangeError(`Fulldome bundles require exactly 2 or 3 visible sources; received ${plates.length}.`);
  }
  if (!Number.isInteger(zenithIndex) || zenithIndex < 0 || zenithIndex >= plates.length) {
    throw new RangeError(`Zenith source index ${zenithIndex} is outside this ${plates.length}-source bundle.`);
  }

  const fieldSlots: FulldomeBundleSlot[] =
    plates.length === 2 ? ["field-primary"] : ["field-primary", "field-secondary"];
  const slots = plates.map<FulldomeBundleSlot>((_, index) => {
    if (index === zenithIndex) return "zenith";
    const fieldIndex = index < zenithIndex ? index : index - 1;
    return fieldSlots[fieldIndex]!;
  });
  const placements = plates.map((plate, index) => {
    const slot = slots[index]!;
    const profile = DEFAULT_PLATE_PLACEMENTS[PROFILE_INDEX_BY_SLOT[slot]]!;
    const placement =
      orientation === "mirrored"
        ? { ...profile, azimuth: wrapDegrees(-profile.azimuth), spin: wrapDegrees(-profile.spin) }
        : profile;
    return normalizePlatePlacement(placement, plate);
  });

  return {
    placements,
    slots,
    activeIndex: zenithIndex,
    orientation,
  };
}

export function isFulldomeBundleSize(count: number): count is 2 | 3 {
  return count === 2 || count === 3;
}
