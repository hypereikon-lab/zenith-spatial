export const DEFAULT_ACTIVE_PLATE_INDEX = 0;

export const PLATE_SKETCH_PRESET_IDS = ["equidistant", "original-authored"] as const;

export type PlateSketchPresetId = (typeof PLATE_SKETCH_PRESET_IDS)[number];

export const DEFAULT_PLATE_SKETCH_PRESET_ID: PlateSketchPresetId = "equidistant";

/**
 * Exact three-source placement captured from the supplied Zenith project.
 * The sources share one radius and scale and are separated by 120 degrees.
 */
export const EQUIDISTANT_PLATE_PLACEMENTS = [
  {
    azimuth: 0,
    radius: 0.5,
    scale: 1,
    spin: 0,
    opacity: 1,
    flipX: false,
    flipY: false,
  },
  {
    azimuth: 120,
    radius: 0.5,
    scale: 1,
    spin: 0,
    opacity: 1,
    flipX: false,
    flipY: false,
  },
  {
    azimuth: -120,
    radius: 0.5,
    scale: 1,
    spin: 0,
    opacity: 1,
    flipX: false,
    flipY: false,
  },
] as const;

/** The asymmetric Zenith default retained for existing artistic layouts. */
export const ORIGINAL_AUTHORED_PLATE_PLACEMENTS = [
  {
    azimuth: -8.898463670050432,
    radius: 0.5257978446693106,
    scale: 0.6812733176437584,
    spin: 16.30072568238097,
    opacity: 1,
    flipX: false,
    flipY: false,
  },
  {
    azimuth: 84.61687012594189,
    radius: 0.6472162968855301,
    scale: 1.55,
    spin: -22.238040365345114,
    opacity: 1,
    flipX: false,
    flipY: false,
  },
  {
    azimuth: -114.37962915281707,
    radius: 0.6394208138109876,
    scale: 2.17,
    spin: 0.8718582179355963,
    opacity: 1,
    flipX: false,
    flipY: false,
  },
] as const;

export const PLATE_SKETCH_PRESETS = {
  equidistant: {
    label: "Equidistant 120° · default",
    placements: EQUIDISTANT_PLATE_PLACEMENTS,
  },
  "original-authored": {
    label: "Original Zenith",
    placements: ORIGINAL_AUTHORED_PLATE_PLACEMENTS,
  },
} as const satisfies Record<
  PlateSketchPresetId,
  {
    readonly label: string;
    readonly placements: ReadonlyArray<
      (typeof EQUIDISTANT_PLATE_PLACEMENTS)[number] | (typeof ORIGINAL_AUTHORED_PLATE_PLACEMENTS)[number]
    >;
  }
>;

export const DEFAULT_PLATE_PLACEMENTS = PLATE_SKETCH_PRESETS[DEFAULT_PLATE_SKETCH_PRESET_ID].placements;

export const DEFAULT_PLATE_REFERENCES = [
  {
    name: "plate-01.png",
    url: "/default-plates/plate-01.png",
    width: 1024,
    height: 1024,
  },
  {
    name: "plate-02.png",
    url: "/default-plates/plate-02.png",
    width: 1424,
    height: 832,
  },
  {
    name: "plate-03.png",
    url: "/default-plates/plate-03.png",
    width: 1424,
    height: 832,
  },
] as const;
