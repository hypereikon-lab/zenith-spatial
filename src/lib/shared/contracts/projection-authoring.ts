import * as Schema from "effect/Schema";
import type { SourceProjectionMode } from "./projection-profile.js";

/** Exact aspect families available to the spatial image carrier. */
export const GENERATION_ASPECT_PRESETS = ["21:9", "16:9", "4:3", "1:1", "3:4", "9:16"] as const;
export type GenerationAspectPreset = (typeof GENERATION_ASPECT_PRESETS)[number];
export const CYLINDER_WALL_GENERATION_ASPECT_PRESET: GenerationAspectPreset = "21:9";

export const GenerationAspectPresetSchema = Schema.Literal(...GENERATION_ASPECT_PRESETS);

export type GenerationAspectProfile = {
  id: GenerationAspectPreset;
  label: string;
  ratio: number;
  gptImageWidth: number;
  gptImageHeight: number;
};

/**
 * Exact-aspect production rasters. Every GPT Image dimension is a multiple of
 * 16 and stays within gpt-image-2's documented edge, ratio and pixel limits.
 */
export const GENERATION_ASPECT_PROFILES: Readonly<Record<GenerationAspectPreset, GenerationAspectProfile>> = {
  "21:9": {
    id: "21:9",
    label: "21:9 ultrawide",
    ratio: 21 / 9,
    gptImageWidth: 2912,
    gptImageHeight: 1248,
  },
  "16:9": {
    id: "16:9",
    label: "16:9 landscape",
    ratio: 16 / 9,
    gptImageWidth: 2560,
    gptImageHeight: 1440,
  },
  "4:3": {
    id: "4:3",
    label: "4:3 landscape",
    ratio: 4 / 3,
    gptImageWidth: 1920,
    gptImageHeight: 1440,
  },
  "1:1": {
    id: "1:1",
    label: "1:1 square",
    ratio: 1,
    gptImageWidth: 1920,
    gptImageHeight: 1920,
  },
  "3:4": {
    id: "3:4",
    label: "3:4 portrait",
    ratio: 3 / 4,
    gptImageWidth: 1440,
    gptImageHeight: 1920,
  },
  "9:16": {
    id: "9:16",
    label: "9:16 portrait",
    ratio: 9 / 16,
    gptImageWidth: 1440,
    gptImageHeight: 2560,
  },
};

const finiteNumberSchema = Schema.Number.pipe(Schema.finite());
const positiveNumberSchema = finiteNumberSchema.pipe(Schema.positive());
const positiveIntegerSchema = Schema.Number.pipe(Schema.int(), Schema.positive());
const nonEmptyStringSchema = Schema.String.pipe(Schema.minLength(1));

export const MAX_PLANAR_ROOF_ANCHORS = 8;
export const PLANAR_ROOF_ANCHOR_ROLES = ["eave", "ridge", "valley", "break"] as const;

export const PlanarRoofAnchorSchema = Schema.Struct({
  id: nonEmptyStringSchema,
  /** Normalized cross-hall position. 0 is the left eave and 1 the right eave. */
  position: finiteNumberSchema.pipe(Schema.between(0, 1)),
  height: positiveNumberSchema,
  role: Schema.Literal(...PLANAR_ROOF_ANCHOR_ROLES),
});

export const AngularSpatialAnchorsSchema = Schema.Struct({
  /** Artist-authored upper semantic field stop on the dome, in world elevation. */
  semanticElevationDegrees: finiteNumberSchema.pipe(Schema.between(-89.9, 89.9)),
  /** Resolved physical horizon. Values away from 0 degrees are explicit calibration. */
  horizonElevationDegrees: finiteNumberSchema.pipe(Schema.between(-89.9, 89.9)),
});

export const PhysicalSpatialAnchorsSchema = Schema.Struct({
  /** Resolved physical horizon height. Differences from eyeHeight are explicit calibration. */
  horizonHeight: positiveNumberSchema,
});

export const AngularProjectionSurfaceSchema = Schema.Struct({
  kind: Schema.Literal("angular"),
  anchors: Schema.optional(AngularSpatialAnchorsSchema),
});

/** A measured rectilinear room with an observer/projector reference point. */
export const BoxRoomProjectionSurfaceSchema = Schema.Struct({
  kind: Schema.Literal("box-room"),
  width: positiveNumberSchema,
  depth: positiveNumberSchema,
  height: positiveNumberSchema,
  eyeHeight: positiveNumberSchema,
  eyeX: finiteNumberSchema,
  eyeZ: finiteNumberSchema,
  anchors: Schema.optional(PhysicalSpatialAnchorsSchema),
}).pipe(
  Schema.filter((surface) => {
    const issues: Schema.FilterIssue[] = [];
    if (surface.eyeHeight >= surface.height) {
      issues.push({ path: ["eyeHeight"], message: "observer height must be inside the room" });
    }
    if (Math.abs(surface.eyeX) >= surface.width * 0.5) {
      issues.push({ path: ["eyeX"], message: "observer X must be inside the room" });
    }
    if (Math.abs(surface.eyeZ) >= surface.depth * 0.5) {
      issues.push({ path: ["eyeZ"], message: "observer Z must be inside the room" });
    }
    if (surface.anchors && surface.anchors.horizonHeight >= surface.height) {
      issues.push({
        path: ["anchors", "horizonHeight"],
        message: "horizon anchor must remain inside the room",
      });
    }
    return issues;
  }),
);

/** An extruded piecewise-planar hall: four vertical walls, 2–7 roof planes, and no floor. */
export const DoubleGableProjectionSurfaceSchema = Schema.Struct({
  kind: Schema.Literal("double-gable-room"),
  length: positiveNumberSchema,
  width: positiveNumberSchema,
  eaveHeight: positiveNumberSchema,
  ridgeHeight: positiveNumberSchema,
  valleyHeight: positiveNumberSchema,
  ridgeInset: positiveNumberSchema,
  /**
   * Active piecewise-planar roof cross-section. Legacy symmetric fields
   * remain readable while saved v4 projects migrate through this profile.
   */
  roofProfile: Schema.optional(
    Schema.Array(PlanarRoofAnchorSchema).pipe(Schema.minItems(3), Schema.maxItems(MAX_PLANAR_ROOF_ANCHORS)),
  ),
  eyeHeight: positiveNumberSchema,
  eyeX: finiteNumberSchema,
  eyeZ: finiteNumberSchema,
  anchors: Schema.optional(PhysicalSpatialAnchorsSchema),
}).pipe(
  Schema.filter((surface) => {
    const issues: Schema.FilterIssue[] = [];
    // The symmetric fields are a legacy serialization fallback. Once an
    // explicit planar profile exists, it is the only authoritative roof.
    if (!surface.roofProfile) {
      if (surface.ridgeHeight <= Math.max(surface.eaveHeight, surface.valleyHeight)) {
        issues.push({
          path: ["ridgeHeight"],
          message: "ridge height must be above the eaves and central valley",
        });
      }
      if (surface.ridgeInset >= surface.width * 0.5) {
        issues.push({
          path: ["ridgeInset"],
          message: "ridge inset must remain inside each half of the hall",
        });
      }
      if (surface.eyeHeight >= Math.min(surface.eaveHeight, surface.valleyHeight)) {
        issues.push({
          path: ["eyeHeight"],
          message: "observer height must remain below the lowest roof seam",
        });
      }
    }
    if (Math.abs(surface.eyeX) >= surface.length * 0.5) {
      issues.push({ path: ["eyeX"], message: "observer X must be inside the hall" });
    }
    if (Math.abs(surface.eyeZ) >= surface.width * 0.5) {
      issues.push({ path: ["eyeZ"], message: "observer Z must be inside the hall" });
    }
    if (surface.roofProfile) {
      if (Math.abs(surface.roofProfile[0].position) > 0.000_001) {
        issues.push({ path: ["roofProfile", 0, "position"], message: "roof profile must start at 0" });
      }
      const last = surface.roofProfile[surface.roofProfile.length - 1];
      if (Math.abs(last.position - 1) > 0.000_001) {
        issues.push({
          path: ["roofProfile", surface.roofProfile.length - 1, "position"],
          message: "roof profile must end at 1",
        });
      }
      for (let index = 1; index < surface.roofProfile.length; index += 1) {
        if (surface.roofProfile[index].position - surface.roofProfile[index - 1].position < 0.001) {
          issues.push({
            path: ["roofProfile", index, "position"],
            message: "roof anchors must be strictly ordered",
          });
        }
      }
      const minimumRoofHeight = Math.min(...surface.roofProfile.map((anchor) => anchor.height));
      if (surface.eyeHeight >= minimumRoofHeight) {
        issues.push({
          path: ["eyeHeight"],
          message: "observer height must remain below every planar roof anchor",
        });
      }
    }
    const anchorCeiling = surface.roofProfile
      ? Math.min(...surface.roofProfile.map((anchor) => anchor.height))
      : Math.min(surface.eaveHeight, surface.valleyHeight);
    if (surface.anchors && surface.anchors.horizonHeight >= anchorCeiling) {
      issues.push({
        path: ["anchors", "horizonHeight"],
        message: "horizon anchor must remain below every roof plane",
      });
    }
    return issues;
  }),
);

/** A measured circular cylinder with a vertical observer reference. */
export const CylinderProjectionSurfaceSchema = Schema.Struct({
  kind: Schema.Literal("cylinder"),
  radius: positiveNumberSchema,
  height: positiveNumberSchema,
  eyeHeight: positiveNumberSchema,
  anchors: Schema.optional(PhysicalSpatialAnchorsSchema),
}).pipe(
  Schema.filter((surface) => {
    const issues: Schema.FilterIssue[] = [];
    if (surface.eyeHeight >= surface.height) {
      issues.push({ path: ["eyeHeight"], message: "observer height must be inside the cylinder" });
    }
    if (surface.anchors && surface.anchors.horizonHeight >= surface.height) {
      issues.push({
        path: ["anchors", "horizonHeight"],
        message: "horizon anchor must remain inside the cylinder",
      });
    }
    return issues;
  }),
);

export const ProjectionSurfaceSchema = Schema.Union(
  AngularProjectionSurfaceSchema,
  BoxRoomProjectionSurfaceSchema,
  DoubleGableProjectionSurfaceSchema,
  CylinderProjectionSurfaceSchema,
);

export const CarrierRasterSchema = Schema.Struct({
  aspectPreset: GenerationAspectPresetSchema,
  width: positiveIntegerSchema,
  height: positiveIntegerSchema,
  /**
   * full-frame intentionally normalizes the carrier over the complete
   * rectangle. It is a topology map, so it need not look undistorted as a
   * conventional camera image. Physical preview is the truth surface.
   */
  domainFit: Schema.Literal("full-frame"),
}).pipe(
  Schema.filter((raster) => {
    const issues: Schema.FilterIssue[] = [];
    if (raster.width % 16 !== 0) {
      issues.push({ path: ["width"], message: "carrier width must be a multiple of 16" });
    }
    if (raster.height % 16 !== 0) {
      issues.push({ path: ["height"], message: "carrier height must be a multiple of 16" });
    }
    const expected = GENERATION_ASPECT_PROFILES[raster.aspectPreset].ratio;
    const actual = raster.width / raster.height;
    if (Math.abs(actual - expected) > 0.001) {
      issues.push({
        path: ["aspectPreset"],
        message: `carrier dimensions must preserve the ${raster.aspectPreset} aspect family`,
      });
    }
    for (const issue of gptImage2RasterIssues(raster.width, raster.height)) {
      issues.push({ path: issue.path, message: issue.message });
    }
    return issues;
  }),
);

export type AngularProjectionSurface = Schema.Schema.Type<typeof AngularProjectionSurfaceSchema>;
export type BoxRoomProjectionSurface = Schema.Schema.Type<typeof BoxRoomProjectionSurfaceSchema>;
export type PlanarRoofAnchor = Schema.Schema.Type<typeof PlanarRoofAnchorSchema>;
export type DoubleGableProjectionSurface = Schema.Schema.Type<typeof DoubleGableProjectionSurfaceSchema>;
export type CylinderProjectionSurface = Schema.Schema.Type<typeof CylinderProjectionSurfaceSchema>;
export type ProjectionSurface = Schema.Schema.Type<typeof ProjectionSurfaceSchema>;
export type AngularSpatialAnchors = Schema.Schema.Type<typeof AngularSpatialAnchorsSchema>;
export type PhysicalSpatialAnchors = Schema.Schema.Type<typeof PhysicalSpatialAnchorsSchema>;

export type ProjectionSurfacePhysicalHorizon = {
  /** World-space height of the resolved physical-horizon plane above the venue floor. */
  height: number;
  /** Observer-derived height before an optional calibration offset is applied. */
  derivedHeight: number;
  /** Explicit installation calibration relative to the observer-derived plane. */
  calibrationOffset: number;
  /** Highest valid value before the plane exits the authored venue shell. */
  upperLimit: number;
  reference: "venue-floor";
};

export type ProjectionSurfaceAngularHorizon = {
  /** Resolved physical-horizon elevation. */
  elevationDegrees: number;
  /** Angular carriers derive their physical horizon at world elevation 0 degrees. */
  derivedElevationDegrees: 0;
  /** Explicit installation calibration relative to 0 degrees. */
  calibrationOffsetDegrees: number;
  reference: "observer-level";
};
export type CarrierRaster = Schema.Schema.Type<typeof CarrierRasterSchema>;

export const DEFAULT_ANGULAR_PROJECTION_SURFACE: AngularProjectionSurface = {
  kind: "angular",
  anchors: { semanticElevationDegrees: 45, horizonElevationDegrees: 0 },
};
export const DEFAULT_BOX_ROOM_PROJECTION_SURFACE: BoxRoomProjectionSurface = {
  kind: "box-room",
  width: 4,
  depth: 4,
  height: 4,
  eyeHeight: 2,
  eyeX: 0,
  eyeZ: 0,
  anchors: { horizonHeight: 2 },
};
export const DEFAULT_DOUBLE_GABLE_PROJECTION_SURFACE: DoubleGableProjectionSurface = {
  kind: "double-gable-room",
  length: 22.55,
  width: 23.143,
  eaveHeight: 9.39,
  ridgeHeight: 12.93,
  valleyHeight: 9.39,
  ridgeInset: 23.143 / 4,
  roofProfile: [
    { id: "left-eave", position: 0, height: 9.39, role: "eave" },
    { id: "left-ridge", position: 0.25, height: 12.93, role: "ridge" },
    { id: "center-valley", position: 0.5, height: 9.39, role: "valley" },
    { id: "right-ridge", position: 0.75, height: 12.93, role: "ridge" },
    { id: "right-eave", position: 1, height: 9.39, role: "eave" },
  ],
  eyeHeight: 1.65,
  eyeX: 0,
  eyeZ: 0,
  anchors: { horizonHeight: 1.65 },
};
export const DEFAULT_CYLINDER_PROJECTION_SURFACE: CylinderProjectionSurface = {
  kind: "cylinder",
  radius: 2,
  height: 4,
  eyeHeight: 2,
  anchors: { horizonHeight: 2 },
};

export function defaultProjectionSurface(mode: SourceProjectionMode): ProjectionSurface {
  if (mode === "cave-270") return { ...DEFAULT_BOX_ROOM_PROJECTION_SURFACE };
  if (mode === "hall-double-gable") return cloneProjectionSurface(DEFAULT_DOUBLE_GABLE_PROJECTION_SURFACE);
  if (mode.startsWith("cylinder-")) return { ...DEFAULT_CYLINDER_PROJECTION_SURFACE };
  return {
    ...DEFAULT_ANGULAR_PROJECTION_SURFACE,
    anchors: {
      semanticElevationDegrees: mode === "nadir-180" ? -45 : 45,
      horizonElevationDegrees: 0,
    },
  };
}

export function projectionSurfaceMatchesMode(surface: ProjectionSurface, mode: SourceProjectionMode): boolean {
  if (mode === "cave-270") return surface.kind === "box-room";
  if (mode === "hall-double-gable") return surface.kind === "double-gable-room";
  if (mode.startsWith("cylinder-")) return surface.kind === "cylinder";
  return surface.kind === "angular";
}

export function normalizeProjectionSurfaceForMode(
  surface: ProjectionSurface | null | undefined,
  mode: SourceProjectionMode,
): ProjectionSurface {
  if (surface && projectionSurfaceMatchesMode(surface, mode)) return cloneProjectionSurface(surface, mode);
  return defaultProjectionSurface(mode);
}

/** Clone JSON-safe surface data without relying on structuredClone accepting reactive proxies. */
export function cloneProjectionSurface(
  surface: ProjectionSurface,
  mode: SourceProjectionMode = "zenith-180",
): ProjectionSurface {
  if (surface.kind === "box-room") {
    return { ...surface, anchors: { ...projectionSpatialAnchors(surface) } };
  }
  if (surface.kind === "double-gable-room") {
    return {
      ...surface,
      anchors: { ...projectionSpatialAnchors(surface) },
      ...(surface.roofProfile ? { roofProfile: surface.roofProfile.map((anchor) => ({ ...anchor })) } : {}),
    };
  }
  if (surface.kind === "cylinder") return { ...surface, anchors: { ...projectionSpatialAnchors(surface) } };
  const fallback = defaultProjectionSurface(mode);
  return {
    kind: "angular",
    anchors: { ...(surface.anchors || (fallback.kind === "angular" ? fallback.anchors : undefined))! },
  };
}

export function projectionSpatialAnchors(surface: AngularProjectionSurface): AngularSpatialAnchors;
export function projectionSpatialAnchors(
  surface: BoxRoomProjectionSurface | DoubleGableProjectionSurface | CylinderProjectionSurface,
): PhysicalSpatialAnchors;
export function projectionSpatialAnchors(surface: ProjectionSurface): AngularSpatialAnchors | PhysicalSpatialAnchors {
  if (surface.kind === "angular") {
    return surface.anchors || { semanticElevationDegrees: 45, horizonElevationDegrees: 0 };
  }
  return surface.anchors || { horizonHeight: surface.eyeHeight };
}

/**
 * Physical horizon derived from the projection observer and carrier.
 *
 * Existing serialized anchor values remain the resolved value for archive and
 * PNG compatibility. Their difference from the derived value is interpreted as
 * an explicit installation calibration, rather than a second free horizon.
 */
export function projectionSurfaceAngularHorizon(surface: AngularProjectionSurface): ProjectionSurfaceAngularHorizon {
  const elevationDegrees = projectionSpatialAnchors(surface).horizonElevationDegrees;
  return {
    elevationDegrees,
    derivedElevationDegrees: 0,
    calibrationOffsetDegrees: elevationDegrees,
    reference: "observer-level",
  };
}

export function projectionSurfaceHorizonCalibrationOffset(surface: ProjectionSurface): number {
  if (surface.kind === "angular") return projectionSurfaceAngularHorizon(surface).calibrationOffsetDegrees;
  return projectionSpatialAnchors(surface).horizonHeight - surface.eyeHeight;
}

/** Applies an advanced physical-horizon calibration without changing its portable shape. */
export function withProjectionSurfaceHorizonCalibration(
  surface: ProjectionSurface,
  calibrationOffset: number,
): ProjectionSurface {
  if (surface.kind === "angular") {
    const anchors = projectionSpatialAnchors(surface);
    return {
      ...surface,
      anchors: {
        ...anchors,
        horizonElevationDegrees: calibrationOffset,
      },
    };
  }
  return {
    ...surface,
    anchors: { horizonHeight: surface.eyeHeight + calibrationOffset },
  };
}

/**
 * Keeps the current calibration offset when an editor changes the measured
 * observer height without explicitly changing the serialized horizon anchor.
 */
export function rebaseProjectionSurfaceHorizonForObserverChange(
  previous: ProjectionSurface,
  next: ProjectionSurface,
): ProjectionSurface {
  if (previous.kind === "angular" || next.kind === "angular" || previous.kind !== next.kind) return next;
  if (Math.abs(previous.eyeHeight - next.eyeHeight) <= 0.000_000_1) return next;
  if (previous.anchors?.horizonHeight !== next.anchors?.horizonHeight) return next;
  return withProjectionSurfaceHorizonCalibration(next, projectionSurfaceHorizonCalibrationOffset(previous));
}

/** Stable comparison key for venue/observer geometry, excluding texture anchors. */
export function projectionSurfaceGeometryFingerprint(surface: ProjectionSurface): string {
  const { anchors: _anchors, ...geometry } = surface;
  return JSON.stringify(geometry);
}

/**
 * Resolves the active planar profile while preserving legacy v4 hall files.
 * Geometry, renderers and prompts consume this helper rather than the old
 * symmetric eave/ridge/valley fields.
 */
export function planarRoofProfile(surface: DoubleGableProjectionSurface): PlanarRoofAnchor[] {
  if (surface.roofProfile?.length) return canonicalPlanarRoofAnchorRoles(surface.roofProfile);
  const ridgePosition = surface.ridgeInset / surface.width;
  return [
    { id: "left-eave", position: 0, height: surface.eaveHeight, role: "eave" },
    { id: "left-ridge", position: ridgePosition, height: surface.ridgeHeight, role: "ridge" },
    { id: "center-valley", position: 0.5, height: surface.valleyHeight, role: "valley" },
    { id: "right-ridge", position: 1 - ridgePosition, height: surface.ridgeHeight, role: "ridge" },
    { id: "right-eave", position: 1, height: surface.eaveHeight, role: "eave" },
  ];
}

/** Geometry-derived labels keep imported metadata and model prompting honest. */
function canonicalPlanarRoofAnchorRoles(anchors: readonly PlanarRoofAnchor[]): PlanarRoofAnchor[] {
  return anchors.map((anchor, index) => {
    if (index === 0 || index === anchors.length - 1) return { ...anchor, role: "eave" };
    const previousHeight = anchors[index - 1].height;
    const nextHeight = anchors[index + 1].height;
    if (anchor.height > previousHeight && anchor.height > nextHeight) return { ...anchor, role: "ridge" };
    if (anchor.height < previousHeight && anchor.height < nextHeight) return { ...anchor, role: "valley" };
    return { ...anchor, role: "break" };
  });
}

/** Clone JSON-safe raster data without relying on structuredClone accepting reactive proxies. */
export function cloneCarrierRaster(raster: CarrierRaster): CarrierRaster {
  return { ...raster };
}

export function carrierRasterForAspect(aspectPreset: GenerationAspectPreset = "1:1"): CarrierRaster {
  const profile = GENERATION_ASPECT_PROFILES[aspectPreset];
  return {
    aspectPreset,
    width: profile.gptImageWidth,
    height: profile.gptImageHeight,
    domainFit: "full-frame",
  };
}

/**
 * Topologies may govern their authoring carrier when aspect is part of the
 * model-facing spatial harness rather than an arbitrary delivery choice.
 */
export function governedGenerationAspectForProjection(mode: SourceProjectionMode): GenerationAspectPreset | null {
  return mode === "cylinder-wall" ? CYLINDER_WALL_GENERATION_ASPECT_PRESET : null;
}

export function carrierRasterForProjection(
  mode: SourceProjectionMode,
  fallback: CarrierRaster = carrierRasterForAspect("1:1"),
): CarrierRaster {
  const governedAspect = governedGenerationAspectForProjection(mode);
  return governedAspect ? carrierRasterForAspect(governedAspect) : cloneCarrierRaster(fallback);
}

export function generationAspectProfile(aspectPreset: GenerationAspectPreset): GenerationAspectProfile {
  return GENERATION_ASPECT_PROFILES[aspectPreset];
}

export function generationAspectForDimensions(width: number, height: number): GenerationAspectPreset {
  const ratio = Math.max(1, Number(width)) / Math.max(1, Number(height));
  return GENERATION_ASPECT_PRESETS.reduce((nearest, candidate) => {
    const currentDistance = Math.abs(Math.log(ratio / GENERATION_ASPECT_PROFILES[nearest].ratio));
    const candidateDistance = Math.abs(Math.log(ratio / GENERATION_ASPECT_PROFILES[candidate].ratio));
    return candidateDistance < currentDistance ? candidate : nearest;
  }, "1:1" as GenerationAspectPreset);
}

export function exactGenerationAspectForDimensions(
  width: number,
  height: number,
  tolerance = 0.001,
): GenerationAspectPreset | null {
  const ratio = Math.max(1, Number(width)) / Math.max(1, Number(height));
  return (
    GENERATION_ASPECT_PRESETS.find(
      (candidate) => Math.abs(Math.log(ratio / GENERATION_ASPECT_PROFILES[candidate].ratio)) <= tolerance,
    ) ?? null
  );
}

export function gptImage2RatioForRaster(raster: Pick<CarrierRaster, "width" | "height">): string {
  return `${raster.width}:${raster.height}`;
}

export function gptImage2RasterIssues(
  width: number,
  height: number,
): Array<{ path: ["width" | "height"] | []; message: string }> {
  const issues: Array<{ path: ["width" | "height"] | []; message: string }> = [];
  if (!Number.isInteger(width) || width <= 0 || width % 16 !== 0) {
    issues.push({ path: ["width"], message: "gpt-image-2 width must be a positive multiple of 16" });
  }
  if (!Number.isInteger(height) || height <= 0 || height % 16 !== 0) {
    issues.push({ path: ["height"], message: "gpt-image-2 height must be a positive multiple of 16" });
  }
  if (Math.max(width, height) >= 3840) {
    issues.push({ path: [], message: "gpt-image-2 maximum edge must be less than 3840 pixels" });
  }
  const shortEdge = Math.max(1, Math.min(width, height));
  if (Math.max(width, height) / shortEdge > 3) {
    issues.push({ path: [], message: "gpt-image-2 long-to-short edge ratio must not exceed 3:1" });
  }
  const pixels = width * height;
  if (pixels < 655_360) {
    issues.push({ path: [], message: "gpt-image-2 raster must contain at least 655,360 pixels" });
  }
  if (pixels > 8_294_400) {
    issues.push({ path: [], message: "gpt-image-2 raster must not exceed 8,294,400 pixels" });
  }
  return issues;
}

export function projectionSurfaceSummary(surface: ProjectionSurface): string {
  if (surface.kind === "box-room") {
    return `${formatMeters(surface.width)} × ${formatMeters(surface.depth)} × ${formatMeters(surface.height)} room · physical horizon ${formatMeters(projectionSpatialAnchors(surface).horizonHeight)} · observer Y ${formatMeters(surface.eyeHeight)}, X ${formatMeters(surface.eyeX)}, Z ${formatMeters(surface.eyeZ)}`;
  }
  if (surface.kind === "double-gable-room") {
    const profile = planarRoofProfile(surface);
    const peak = Math.max(...profile.map((anchor) => anchor.height));
    return `${formatMeters(surface.length)} × ${formatMeters(surface.width)} profiled hall · physical horizon ${formatMeters(projectionSpatialAnchors(surface).horizonHeight)} · observer Y ${formatMeters(surface.eyeHeight)} · ${profile.length - 1} roof planes · peak ${formatMeters(peak)} · no floor`;
  }
  if (surface.kind === "cylinder") {
    return `Ø${formatMeters(surface.radius * 2)} × ${formatMeters(surface.height)} cylinder · physical horizon ${formatMeters(projectionSpatialAnchors(surface).horizonHeight)} · observer Y ${formatMeters(surface.eyeHeight)}`;
  }
  const anchors = projectionSpatialAnchors(surface);
  return `observer-centred angular surface · semantic ${Number(anchors.semanticElevationDegrees.toFixed(1))}° · physical horizon ${Number(anchors.horizonElevationDegrees.toFixed(1))}°`;
}

/**
 * Describes the resolved physical-horizon plane independently from image allocation.
 *
 * `surface.eyeHeight` remains the observer pose. `scene.horizonSplit` decides
 * where this plane is allocated in the carrier raster. Serialized anchors keep
 * the resolved value so legacy calibration and immutable image metadata remain exact.
 */
export function projectionSurfacePhysicalHorizon(surface: ProjectionSurface): ProjectionSurfacePhysicalHorizon | null {
  if (surface.kind === "box-room" || surface.kind === "cylinder") {
    const height = projectionSpatialAnchors(surface).horizonHeight;
    return {
      height,
      derivedHeight: surface.eyeHeight,
      calibrationOffset: height - surface.eyeHeight,
      upperLimit: surface.height,
      reference: "venue-floor",
    };
  }
  if (surface.kind === "double-gable-room") {
    const height = projectionSpatialAnchors(surface).horizonHeight;
    return {
      height,
      derivedHeight: surface.eyeHeight,
      calibrationOffset: height - surface.eyeHeight,
      upperLimit: Math.min(...planarRoofProfile(surface).map((anchor) => anchor.height)),
      reference: "venue-floor",
    };
  }
  return null;
}

function formatMeters(value: number): string {
  return `${Number(value.toFixed(2))} m`;
}
