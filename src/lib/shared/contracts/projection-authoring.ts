import { z } from "zod";
import type { SourceProjectionMode } from "./projection-profile.js";

/** Exact aspect families available to the spatial image carrier. */
export const GENERATION_ASPECT_PRESETS = ["21:9", "16:9", "4:3", "1:1", "3:4", "9:16"] as const;
export type GenerationAspectPreset = (typeof GENERATION_ASPECT_PRESETS)[number];
export const CYLINDER_WALL_GENERATION_ASPECT_PRESET: GenerationAspectPreset = "21:9";

export const GenerationAspectPresetSchema = z.enum(GENERATION_ASPECT_PRESETS);

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

const finiteNumberSchema = z.number().finite();
const positiveNumberSchema = finiteNumberSchema.positive();
const positiveIntegerSchema = z.number().int().positive();

export const MAX_PLANAR_ROOF_ANCHORS = 8;
export const PLANAR_ROOF_ANCHOR_ROLES = ["eave", "ridge", "valley", "break"] as const;

export const PlanarRoofAnchorSchema = z
  .object({
    id: z.string().min(1),
    /** Normalized cross-hall position. 0 is the left eave and 1 the right eave. */
    position: finiteNumberSchema.min(0).max(1),
    height: positiveNumberSchema,
    role: z.enum(PLANAR_ROOF_ANCHOR_ROLES),
  })
  .strict();

export const AngularSpatialAnchorsSchema = z
  .object({
    /** Artist-authored upper semantic field stop on the dome, in world elevation. */
    semanticElevationDegrees: finiteNumberSchema.min(-89.9).max(89.9),
    /** Artist-authored viewing-horizon field stop on the dome, in world elevation. */
    horizonElevationDegrees: finiteNumberSchema.min(-89.9).max(89.9),
  })
  .strict();

export const PhysicalSpatialAnchorsSchema = z
  .object({
    /** Absolute venue-space height of the texture horizon above the floor. */
    horizonHeight: positiveNumberSchema,
  })
  .strict();

export const AngularProjectionSurfaceSchema = z
  .object({
    kind: z.literal("angular"),
    anchors: AngularSpatialAnchorsSchema.optional(),
  })
  .strict();

/** A measured rectilinear room with an observer/projector reference point. */
export const BoxRoomProjectionSurfaceSchema = z
  .object({
    kind: z.literal("box-room"),
    width: positiveNumberSchema,
    depth: positiveNumberSchema,
    height: positiveNumberSchema,
    eyeHeight: positiveNumberSchema,
    eyeX: finiteNumberSchema,
    eyeZ: finiteNumberSchema,
    anchors: PhysicalSpatialAnchorsSchema.optional(),
  })
  .strict()
  .superRefine((surface, ctx) => {
    if (surface.eyeHeight >= surface.height) {
      ctx.addIssue({ code: "custom", path: ["eyeHeight"], message: "observer height must be inside the room" });
    }
    if (Math.abs(surface.eyeX) >= surface.width * 0.5) {
      ctx.addIssue({ code: "custom", path: ["eyeX"], message: "observer X must be inside the room" });
    }
    if (Math.abs(surface.eyeZ) >= surface.depth * 0.5) {
      ctx.addIssue({ code: "custom", path: ["eyeZ"], message: "observer Z must be inside the room" });
    }
    if (surface.anchors && surface.anchors.horizonHeight >= surface.height) {
      ctx.addIssue({
        code: "custom",
        path: ["anchors", "horizonHeight"],
        message: "horizon anchor must remain inside the room",
      });
    }
  });

/** An extruded piecewise-planar hall: four vertical walls, 2–7 roof planes, and no floor. */
export const DoubleGableProjectionSurfaceSchema = z
  .object({
    kind: z.literal("double-gable-room"),
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
    roofProfile: z.array(PlanarRoofAnchorSchema).min(3).max(MAX_PLANAR_ROOF_ANCHORS).optional(),
    eyeHeight: positiveNumberSchema,
    eyeX: finiteNumberSchema,
    eyeZ: finiteNumberSchema,
    anchors: PhysicalSpatialAnchorsSchema.optional(),
  })
  .strict()
  .superRefine((surface, ctx) => {
    // The symmetric fields are a legacy serialization fallback. Once an
    // explicit planar profile exists, it is the only authoritative roof.
    if (!surface.roofProfile) {
      if (surface.ridgeHeight <= Math.max(surface.eaveHeight, surface.valleyHeight)) {
        ctx.addIssue({
          code: "custom",
          path: ["ridgeHeight"],
          message: "ridge height must be above the eaves and central valley",
        });
      }
      if (surface.ridgeInset >= surface.width * 0.5) {
        ctx.addIssue({
          code: "custom",
          path: ["ridgeInset"],
          message: "ridge inset must remain inside each half of the hall",
        });
      }
      if (surface.eyeHeight >= Math.min(surface.eaveHeight, surface.valleyHeight)) {
        ctx.addIssue({
          code: "custom",
          path: ["eyeHeight"],
          message: "observer height must remain below the lowest roof seam",
        });
      }
    }
    if (Math.abs(surface.eyeX) >= surface.length * 0.5) {
      ctx.addIssue({ code: "custom", path: ["eyeX"], message: "observer X must be inside the hall" });
    }
    if (Math.abs(surface.eyeZ) >= surface.width * 0.5) {
      ctx.addIssue({ code: "custom", path: ["eyeZ"], message: "observer Z must be inside the hall" });
    }
    if (surface.roofProfile) {
      if (Math.abs(surface.roofProfile[0].position) > 0.000_001) {
        ctx.addIssue({ code: "custom", path: ["roofProfile", 0, "position"], message: "roof profile must start at 0" });
      }
      const last = surface.roofProfile[surface.roofProfile.length - 1];
      if (Math.abs(last.position - 1) > 0.000_001) {
        ctx.addIssue({
          code: "custom",
          path: ["roofProfile", surface.roofProfile.length - 1, "position"],
          message: "roof profile must end at 1",
        });
      }
      for (let index = 1; index < surface.roofProfile.length; index += 1) {
        if (surface.roofProfile[index].position - surface.roofProfile[index - 1].position < 0.001) {
          ctx.addIssue({
            code: "custom",
            path: ["roofProfile", index, "position"],
            message: "roof anchors must be strictly ordered",
          });
        }
      }
      const minimumRoofHeight = Math.min(...surface.roofProfile.map((anchor) => anchor.height));
      if (surface.eyeHeight >= minimumRoofHeight) {
        ctx.addIssue({
          code: "custom",
          path: ["eyeHeight"],
          message: "observer height must remain below every planar roof anchor",
        });
      }
    }
    const anchorCeiling = surface.roofProfile
      ? Math.min(...surface.roofProfile.map((anchor) => anchor.height))
      : Math.min(surface.eaveHeight, surface.valleyHeight);
    if (surface.anchors && surface.anchors.horizonHeight >= anchorCeiling) {
      ctx.addIssue({
        code: "custom",
        path: ["anchors", "horizonHeight"],
        message: "horizon anchor must remain below every roof plane",
      });
    }
  });

/** A measured circular cylinder with a vertical observer reference. */
export const CylinderProjectionSurfaceSchema = z
  .object({
    kind: z.literal("cylinder"),
    radius: positiveNumberSchema,
    height: positiveNumberSchema,
    eyeHeight: positiveNumberSchema,
    anchors: PhysicalSpatialAnchorsSchema.optional(),
  })
  .strict()
  .superRefine((surface, ctx) => {
    if (surface.eyeHeight >= surface.height) {
      ctx.addIssue({ code: "custom", path: ["eyeHeight"], message: "observer height must be inside the cylinder" });
    }
    if (surface.anchors && surface.anchors.horizonHeight >= surface.height) {
      ctx.addIssue({
        code: "custom",
        path: ["anchors", "horizonHeight"],
        message: "horizon anchor must remain inside the cylinder",
      });
    }
  });

export const ProjectionSurfaceSchema = z.discriminatedUnion("kind", [
  AngularProjectionSurfaceSchema,
  BoxRoomProjectionSurfaceSchema,
  DoubleGableProjectionSurfaceSchema,
  CylinderProjectionSurfaceSchema,
]);

export const CarrierRasterSchema = z
  .object({
    aspectPreset: GenerationAspectPresetSchema,
    width: positiveIntegerSchema,
    height: positiveIntegerSchema,
    /**
     * full-frame intentionally normalizes the carrier over the complete
     * rectangle. It is a topology map, so it need not look undistorted as a
     * conventional camera image. Physical preview is the truth surface.
     */
    domainFit: z.literal("full-frame"),
  })
  .strict()
  .superRefine((raster, ctx) => {
    if (raster.width % 16 !== 0) {
      ctx.addIssue({ code: "custom", path: ["width"], message: "carrier width must be a multiple of 16" });
    }
    if (raster.height % 16 !== 0) {
      ctx.addIssue({ code: "custom", path: ["height"], message: "carrier height must be a multiple of 16" });
    }
    const expected = GENERATION_ASPECT_PROFILES[raster.aspectPreset].ratio;
    const actual = raster.width / raster.height;
    if (Math.abs(actual - expected) > 0.001) {
      ctx.addIssue({
        code: "custom",
        path: ["aspectPreset"],
        message: `carrier dimensions must preserve the ${raster.aspectPreset} aspect family`,
      });
    }
    for (const issue of gptImage2RasterIssues(raster.width, raster.height)) {
      ctx.addIssue({ code: "custom", path: issue.path, message: issue.message });
    }
  });

export type AngularProjectionSurface = z.infer<typeof AngularProjectionSurfaceSchema>;
export type BoxRoomProjectionSurface = z.infer<typeof BoxRoomProjectionSurfaceSchema>;
export type PlanarRoofAnchor = z.infer<typeof PlanarRoofAnchorSchema>;
export type DoubleGableProjectionSurface = z.infer<typeof DoubleGableProjectionSurfaceSchema>;
export type CylinderProjectionSurface = z.infer<typeof CylinderProjectionSurfaceSchema>;
export type ProjectionSurface = z.infer<typeof ProjectionSurfaceSchema>;
export type AngularSpatialAnchors = z.infer<typeof AngularSpatialAnchorsSchema>;
export type PhysicalSpatialAnchors = z.infer<typeof PhysicalSpatialAnchorsSchema>;

export type ProjectionSurfacePhysicalHorizon = {
  /** World-space height of the authored texture-horizon plane above the venue floor. */
  height: number;
  /** Highest valid value before the plane exits the authored venue shell. */
  upperLimit: number;
  reference: "venue-floor";
};
export type CarrierRaster = z.infer<typeof CarrierRasterSchema>;

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
    return `${formatMeters(surface.width)} × ${formatMeters(surface.depth)} × ${formatMeters(surface.height)} room · anchor ${formatMeters(projectionSpatialAnchors(surface).horizonHeight)} · observer Y ${formatMeters(surface.eyeHeight)}, X ${formatMeters(surface.eyeX)}, Z ${formatMeters(surface.eyeZ)}`;
  }
  if (surface.kind === "double-gable-room") {
    const profile = planarRoofProfile(surface);
    const peak = Math.max(...profile.map((anchor) => anchor.height));
    return `${formatMeters(surface.length)} × ${formatMeters(surface.width)} profiled hall · anchor ${formatMeters(projectionSpatialAnchors(surface).horizonHeight)} · observer Y ${formatMeters(surface.eyeHeight)} · ${profile.length - 1} roof planes · peak ${formatMeters(peak)} · no floor`;
  }
  if (surface.kind === "cylinder") {
    return `Ø${formatMeters(surface.radius * 2)} × ${formatMeters(surface.height)} cylinder · anchor ${formatMeters(projectionSpatialAnchors(surface).horizonHeight)} · observer Y ${formatMeters(surface.eyeHeight)}`;
  }
  const anchors = projectionSpatialAnchors(surface);
  return `observer-centred angular surface · semantic ${Number(anchors.semanticElevationDegrees.toFixed(1))}° · horizon ${Number(anchors.horizonElevationDegrees.toFixed(1))}°`;
}

/**
 * Describes the authored texture-horizon plane independently from source-map allocation.
 *
 * `surface.eyeHeight` remains the observer pose. `scene.horizonSplit` decides
 * where this plane is allocated in the carrier raster. Neither value is a
 * substitute for the authored world-space anchor height.
 */
export function projectionSurfacePhysicalHorizon(surface: ProjectionSurface): ProjectionSurfacePhysicalHorizon | null {
  if (surface.kind === "box-room" || surface.kind === "cylinder") {
    return {
      height: projectionSpatialAnchors(surface).horizonHeight,
      upperLimit: surface.height,
      reference: "venue-floor",
    };
  }
  if (surface.kind === "double-gable-room") {
    return {
      height: projectionSpatialAnchors(surface).horizonHeight,
      upperLimit: Math.min(...planarRoofProfile(surface).map((anchor) => anchor.height)),
      reference: "venue-floor",
    };
  }
  return null;
}

function formatMeters(value: number): string {
  return `${Number(value.toFixed(2))} m`;
}
