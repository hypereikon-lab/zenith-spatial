import { z } from "zod";
import { DomeSceneFrame0Schema, type DomeSceneFrame0 } from "./dome-scene.js";
import {
  CarrierRasterSchema,
  ProjectionSurfaceSchema,
  carrierRasterForAspect,
  cloneCarrierRaster,
  normalizeProjectionSurfaceForMode,
  projectionSurfaceMatchesMode,
  type CarrierRaster,
  type ProjectionSurface,
} from "./projection-authoring.js";
import { SOURCE_PROJECTION_DEFAULT_GUIDES, SourceProjectionModeSchema } from "./projection-profile.js";

export const COMPOSITION_SEQUENCE_VERSION = 5;
export const COMPOSITION_REVISION_KINDS = ["plate-sketch", "clean-image", "reference-image"] as const;
export const COMPOSITION_REVISION_PARENT_ROLES = ["plate-sketch", "variation-source", "import-source"] as const;
export const COMPOSITION_STATUSES = ["draft", "ready", "stale"] as const;

const DEFAULT_IMAGE_TARGET_RASTER = carrierRasterForAspect("1:1");
const finiteNumberSchema = z.number().finite();
const positiveIntegerSchema = z.number().int().positive();
const projectionModeSchema = SourceProjectionModeSchema;

const jsonValueSchema: z.ZodType<CompositionSequenceJsonValue> = z.lazy(() =>
  z.union([
    z.string(),
    finiteNumberSchema,
    z.boolean(),
    z.null(),
    z.array(jsonValueSchema),
    z.record(z.string(), jsonValueSchema),
  ]),
);

export const CompositionRevisionMediaSchema = z
  .object({
    kind: z.literal("image"),
    url: z
      .string()
      .min(1)
      .refine((url) => !url.startsWith("blob:"), "object URLs are runtime-only and cannot be stored in a project"),
    name: z.string().optional(),
    mime: z.string().optional(),
    alt: z.string().optional(),
  })
  .strict();

export const CompositionRevisionParentSchema = z
  .object({
    revisionId: z.string().min(1),
    role: z.enum(COMPOSITION_REVISION_PARENT_ROLES),
  })
  .strict();

export const CompositionSourceAssetSchema = z
  .object({
    id: z.string().min(1),
    label: z.string().min(1),
    media: CompositionRevisionMediaSchema,
    width: positiveIntegerSchema,
    height: positiveIntegerSchema,
    aspect: finiteNumberSchema.positive(),
    createdAt: z.string(),
  })
  .strict();

export const PlateCompositionSnapshotSchema = z
  .object({
    projectionMode: projectionModeSchema,
    surface: ProjectionSurfaceSchema,
    raster: CarrierRasterSchema,
    guideSplit: finiteNumberSchema,
    horizonSplit: finiteNumberSchema,
    frame: DomeSceneFrame0Schema,
  })
  .strict()
  .superRefine((snapshot, ctx) => {
    if (!projectionSurfaceMatchesMode(snapshot.surface, snapshot.projectionMode)) {
      ctx.addIssue({
        code: "custom",
        path: ["surface"],
        message: `surface kind ${snapshot.surface.kind} does not match projection mode ${snapshot.projectionMode}`,
      });
    }
  });

export const ImageSpatialSpecSchema = z
  .object({
    sourceWidth: positiveIntegerSchema.nullable(),
    sourceHeight: positiveIntegerSchema.nullable(),
    sourceAspectRatio: finiteNumberSchema.positive(),
    projectionMode: projectionModeSchema,
    surface: ProjectionSurfaceSchema,
    fit: z.enum(["contain", "cover", "stretch", "projection-aware"]),
    scale: finiteNumberSchema.positive(),
    offsetX: finiteNumberSchema,
    offsetY: finiteNumberSchema,
    rotationDegrees: finiteNumberSchema,
    guideSplit: finiteNumberSchema.min(0).max(1),
    horizonSplit: finiteNumberSchema.min(0).max(1),
    safeRimRadius: finiteNumberSchema.min(0).max(1),
    exterior: z.enum(["black", "transparent", "preserve"]),
    targetWidth: positiveIntegerSchema,
    targetHeight: positiveIntegerSchema,
  })
  .strict()
  .superRefine((spec, ctx) => {
    if (!projectionSurfaceMatchesMode(spec.surface, spec.projectionMode)) {
      ctx.addIssue({
        code: "custom",
        path: ["surface"],
        message: `surface kind ${spec.surface.kind} does not match projection mode ${spec.projectionMode}`,
      });
    }
  });

export const IMAGE_GENERATION_PROVENANCE_VERSION = 1;
export const ImageGenerationProvenanceV1Schema = z
  .object({
    version: z.literal(IMAGE_GENERATION_PROVENANCE_VERSION),
    compositionId: z.string().min(1),
    sourceRevisionId: z.string().min(1),
    operatorId: z.literal("inpaint-plate-sketch"),
    model: z.string().min(1).optional(),
    carrierRaster: CarrierRasterSchema,
    spatialSpec: ImageSpatialSpecSchema,
  })
  .strict()
  .superRefine((provenance, ctx) => {
    if (
      provenance.carrierRaster.width !== provenance.spatialSpec.targetWidth ||
      provenance.carrierRaster.height !== provenance.spatialSpec.targetHeight
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["carrierRaster"],
        message: "carrier raster must match the spatial specification target dimensions",
      });
    }
  });

export const CompositionRevisionSchema = z
  .object({
    id: z.string().min(1),
    kind: z.enum(COMPOSITION_REVISION_KINDS),
    label: z.string().min(1),
    createdAt: z.string(),
    media: CompositionRevisionMediaSchema,
    normalizedMedia: CompositionRevisionMediaSchema.optional(),
    parents: z.array(CompositionRevisionParentSchema),
    operatorId: z.string().optional(),
    prompt: z.string().optional(),
    config: z.record(z.string(), jsonValueSchema).optional(),
    provenance: ImageGenerationProvenanceV1Schema.optional(),
    projectionProfile: projectionModeSchema,
    spatialSpec: ImageSpatialSpecSchema,
    plateComposition: PlateCompositionSnapshotSchema.optional(),
  })
  .strict()
  .superRefine((revision, ctx) => {
    if (revision.projectionProfile !== revision.spatialSpec.projectionMode) {
      ctx.addIssue({
        code: "custom",
        path: ["projectionProfile"],
        message: "projection profile must match spatial spec",
      });
    }
    if (revision.provenance) {
      if (revision.kind !== "clean-image") {
        ctx.addIssue({ code: "custom", path: ["provenance"], message: "provenance belongs to generated images" });
      }
      if (
        !revision.parents.some(
          (parent) => parent.role === "plate-sketch" && parent.revisionId === revision.provenance?.sourceRevisionId,
        )
      ) {
        ctx.addIssue({ code: "custom", path: ["parents"], message: "generated image must pin its Plate Sketch" });
      }
    }
  });

export const CompositionSchema = z
  .object({
    id: z.string().min(1),
    label: z.string().min(1),
    sourceAssetIds: z.array(z.string().min(1)),
    plateSketchRevisionId: z.string().nullable(),
    imageRevisionId: z.string().nullable(),
    plateDraft: PlateCompositionSnapshotSchema,
    status: z.enum(COMPOSITION_STATUSES),
    notes: z.string(),
    createdAt: z.string(),
    updatedAt: z.string(),
  })
  .strict();

export const CompositionSequenceSchema = z
  .object({
    version: z.literal(COMPOSITION_SEQUENCE_VERSION),
    revisionOrder: z.array(z.string()),
    revisions: z.record(z.string(), CompositionRevisionSchema),
    sourceAssetOrder: z.array(z.string()),
    sourceAssets: z.record(z.string(), CompositionSourceAssetSchema),
    compositions: z.array(CompositionSchema).min(1),
  })
  .strict()
  .superRefine((library, ctx) => {
    const revisionIds = new Set(Object.keys(library.revisions));
    const assetIds = new Set(Object.keys(library.sourceAssets));
    if (new Set(library.revisionOrder).size !== library.revisionOrder.length) {
      ctx.addIssue({ code: "custom", path: ["revisionOrder"], message: "revision order contains duplicates" });
    }
    for (const revisionId of library.revisionOrder) {
      if (!revisionIds.has(revisionId))
        ctx.addIssue({ code: "custom", path: ["revisionOrder"], message: `missing ${revisionId}` });
    }
    for (const [revisionId, revision] of Object.entries(library.revisions)) {
      if (revision.id !== revisionId)
        ctx.addIssue({ code: "custom", path: ["revisions", revisionId], message: "revision key differs" });
      for (const parent of revision.parents) {
        if (!revisionIds.has(parent.revisionId)) {
          ctx.addIssue({
            code: "custom",
            path: ["revisions", revisionId, "parents"],
            message: `missing ${parent.revisionId}`,
          });
        }
      }
    }
    for (const [assetId, asset] of Object.entries(library.sourceAssets)) {
      if (asset.id !== assetId)
        ctx.addIssue({ code: "custom", path: ["sourceAssets", assetId], message: "asset key differs" });
    }
    const compositionIds = new Set<string>();
    library.compositions.forEach((composition, index) => {
      if (compositionIds.has(composition.id))
        ctx.addIssue({ code: "custom", path: ["compositions", index, "id"], message: "duplicate composition" });
      compositionIds.add(composition.id);
      for (const assetId of composition.sourceAssetIds) {
        if (!assetIds.has(assetId))
          ctx.addIssue({
            code: "custom",
            path: ["compositions", index, "sourceAssetIds"],
            message: `missing ${assetId}`,
          });
      }
      for (const revisionId of [composition.plateSketchRevisionId, composition.imageRevisionId]) {
        if (revisionId && !revisionIds.has(revisionId))
          ctx.addIssue({ code: "custom", path: ["compositions", index], message: `missing ${revisionId}` });
      }
    });
  });

export const CompositionSequenceWorkspaceSchema = z.object({ selectedCompositionId: z.string().nullable() }).strict();

export type CompositionSequenceJsonValue =
  | string
  | number
  | boolean
  | null
  | CompositionSequenceJsonValue[]
  | { [key: string]: CompositionSequenceJsonValue };
export type CompositionRevisionMedia = z.infer<typeof CompositionRevisionMediaSchema>;
export type CompositionRevisionParent = z.infer<typeof CompositionRevisionParentSchema>;
export type CompositionSourceAsset = z.infer<typeof CompositionSourceAssetSchema>;
export type PlateCompositionSnapshot = z.infer<typeof PlateCompositionSnapshotSchema>;
export type ImageSpatialSpec = z.infer<typeof ImageSpatialSpecSchema>;
export type ImageGenerationProvenanceV1 = z.infer<typeof ImageGenerationProvenanceV1Schema>;
export type CompositionRevision = z.infer<typeof CompositionRevisionSchema>;
export type Composition = z.infer<typeof CompositionSchema>;
export type CompositionSequence = z.infer<typeof CompositionSequenceSchema>;
export type CompositionSequenceWorkspace = z.infer<typeof CompositionSequenceWorkspaceSchema>;

export function parseCompositionSequence(value: unknown): CompositionSequence {
  return CompositionSequenceSchema.parse(value);
}

export function defaultImageSpatialSpec({
  projectionMode = "zenith-180",
  surface,
  guideSplit,
  horizonSplit,
  sourceWidth = null,
  sourceHeight = null,
  targetWidth = DEFAULT_IMAGE_TARGET_RASTER.width,
  targetHeight = DEFAULT_IMAGE_TARGET_RASTER.height,
}: {
  projectionMode?: ImageSpatialSpec["projectionMode"];
  surface?: ProjectionSurface;
  guideSplit?: number;
  horizonSplit?: number;
  sourceWidth?: number | null;
  sourceHeight?: number | null;
  targetWidth?: number;
  targetHeight?: number;
} = {}): ImageSpatialSpec {
  const defaults = SOURCE_PROJECTION_DEFAULT_GUIDES[projectionMode];
  return {
    sourceWidth,
    sourceHeight,
    sourceAspectRatio: sourceWidth && sourceHeight ? sourceWidth / sourceHeight : 1,
    projectionMode,
    surface: normalizeProjectionSurfaceForMode(surface, projectionMode),
    fit: "contain",
    scale: 1,
    offsetX: 0,
    offsetY: 0,
    rotationDegrees: 0,
    guideSplit: clamp01(guideSplit ?? defaults.innerSplit),
    horizonSplit: clamp01(horizonSplit ?? defaults.horizonSplit),
    safeRimRadius: projectionMode.startsWith("cylinder-") || projectionMode === "hall-double-gable" ? 1 : 0.96,
    exterior:
      projectionMode === "cave-270" || projectionMode === "hall-double-gable" || projectionMode === "cylinder-wall"
        ? "preserve"
        : "black",
    targetWidth,
    targetHeight,
  };
}

export function emptyPlateComposition({
  projectionMode = "zenith-180",
  surface,
  raster = carrierRasterForAspect("1:1"),
  guideSplit,
  horizonSplit,
}: {
  projectionMode?: PlateCompositionSnapshot["projectionMode"];
  surface?: ProjectionSurface;
  raster?: CarrierRaster;
  guideSplit?: number;
  horizonSplit?: number;
} = {}): PlateCompositionSnapshot {
  const defaults = SOURCE_PROJECTION_DEFAULT_GUIDES[projectionMode];
  const frame: DomeSceneFrame0 = { plateFit: "contain", plateFeather: 0.02, activeLayerId: null, plateLayers: [] };
  return {
    projectionMode,
    surface: normalizeProjectionSurfaceForMode(surface, projectionMode),
    raster: cloneCarrierRaster(raster),
    guideSplit: clamp01(guideSplit ?? defaults.innerSplit),
    horizonSplit: clamp01(horizonSplit ?? defaults.horizonSplit),
    frame,
  };
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));
}
