import * as Schema from "effect/Schema";

import {
  CarrierRasterSchema,
  ProjectionSurfaceSchema,
  projectionSurfaceMatchesMode,
} from "../lib/shared/contracts/projection-authoring.js";
import { DomeSceneFrame0Schema } from "../lib/shared/contracts/dome-scene.js";
import { SourceProjectionModeSchema } from "../lib/shared/contracts/projection-profile.js";

export const ZENITH_SCHEMA_VERSION = 1;
export const IMAGE_PROVENANCE_VERSION = 2;
export const GENERATION_JOB_VERSION = 1;

const finiteNumber = Schema.Number.pipe(Schema.finite());
const positiveNumber = finiteNumber.pipe(Schema.positive());
const positiveInteger = Schema.Number.pipe(Schema.int(), Schema.positive());
const nonNegativeInteger = Schema.Number.pipe(Schema.int(), Schema.nonNegative());
const nonEmptyString = Schema.String.pipe(Schema.minLength(1));
const portableStorageRef = nonEmptyString.pipe(
  Schema.filter((value) => !value.startsWith("blob:") || "object URLs are runtime-only"),
);

export const MediaAssetSchema = Schema.mutable(
  Schema.Struct({
    id: nonEmptyString,
    kind: Schema.Literal("image"),
    filename: nonEmptyString,
    mime: nonEmptyString,
    width: positiveInteger,
    height: positiveInteger,
    storageRef: portableStorageRef,
    alt: Schema.optional(nonEmptyString),
    createdAt: nonEmptyString,
  }),
);

export const PlateDraftSchema = Schema.mutable(
  Schema.Struct({
    projectionMode: SourceProjectionModeSchema,
    surface: ProjectionSurfaceSchema,
    raster: CarrierRasterSchema,
    guideSplit: finiteNumber.pipe(Schema.between(0, 1)),
    horizonSplit: finiteNumber.pipe(Schema.between(0, 1)),
    frame: DomeSceneFrame0Schema,
  }),
).pipe(
  Schema.filter((draft) =>
    projectionSurfaceMatchesMode(draft.surface, draft.projectionMode)
      ? true
      : {
          path: ["surface"],
          message: `surface kind ${draft.surface.kind} does not match projection mode ${draft.projectionMode}`,
        },
  ),
);

export const ImageSpatialSpecSchema = Schema.mutable(
  Schema.Struct({
    sourceWidth: Schema.NullOr(positiveInteger),
    sourceHeight: Schema.NullOr(positiveInteger),
    sourceAspectRatio: positiveNumber,
    projectionMode: SourceProjectionModeSchema,
    surface: ProjectionSurfaceSchema,
    fit: Schema.Literal("contain", "cover", "stretch", "projection-aware"),
    scale: positiveNumber,
    offsetX: finiteNumber,
    offsetY: finiteNumber,
    rotationDegrees: finiteNumber,
    guideSplit: finiteNumber.pipe(Schema.between(0, 1)),
    horizonSplit: finiteNumber.pipe(Schema.between(0, 1)),
    safeRimRadius: finiteNumber.pipe(Schema.between(0, 1)),
    exterior: Schema.Literal("black", "transparent", "preserve"),
    targetWidth: positiveInteger,
    targetHeight: positiveInteger,
  }),
).pipe(
  Schema.filter((spec) => {
    const issues: Schema.FilterIssue[] = [];
    if (!projectionSurfaceMatchesMode(spec.surface, spec.projectionMode)) {
      issues.push({
        path: ["surface"],
        message: `surface kind ${spec.surface.kind} does not match projection mode ${spec.projectionMode}`,
      });
    }
    if ((spec.sourceWidth === null) !== (spec.sourceHeight === null)) {
      issues.push({ path: ["sourceWidth"], message: "source dimensions must be both present or both absent" });
    }
    return issues;
  }),
);

export const PlateCommitProvenanceSchema = Schema.mutable(
  Schema.Struct({
    version: Schema.Literal(1),
    projectId: nonEmptyString,
    compositionId: nonEmptyString,
    sourceAssetIds: Schema.mutable(Schema.Array(nonEmptyString)),
    draftFingerprint: nonEmptyString,
  }),
);

export const PlateCommitSchema = Schema.mutable(
  Schema.Struct({
    id: nonEmptyString,
    label: nonEmptyString,
    createdAt: nonEmptyString,
    mediaAssetId: nonEmptyString,
    draft: PlateDraftSchema,
    spatialSpec: ImageSpatialSpecSchema,
    provenance: PlateCommitProvenanceSchema,
  }),
).pipe(
  Schema.filter((commit) => {
    const issues: Schema.FilterIssue[] = [];
    if (
      commit.spatialSpec.targetWidth !== commit.draft.raster.width ||
      commit.spatialSpec.targetHeight !== commit.draft.raster.height
    ) {
      issues.push({ path: ["spatialSpec"], message: "Plate Commit spatial target must equal its exact draft raster" });
    }
    if (
      commit.spatialSpec.sourceWidth !== commit.draft.raster.width ||
      commit.spatialSpec.sourceHeight !== commit.draft.raster.height
    ) {
      issues.push({
        path: ["spatialSpec"],
        message: "Plate Commit source dimensions must equal its exact draft raster",
      });
    }
    return issues;
  }),
);

export const ImageGenerationProvenanceSchema = Schema.mutable(
  Schema.Struct({
    version: Schema.Literal(IMAGE_PROVENANCE_VERSION),
    projectId: nonEmptyString,
    compositionId: nonEmptyString,
    plateCommitId: nonEmptyString,
    inputDigest: nonEmptyString,
    model: nonEmptyString,
    carrierRaster: CarrierRasterSchema,
    spatialSpec: ImageSpatialSpecSchema,
  }),
).pipe(
  Schema.filter((provenance) =>
    provenance.carrierRaster.width === provenance.spatialSpec.targetWidth &&
    provenance.carrierRaster.height === provenance.spatialSpec.targetHeight
      ? true
      : { path: ["carrierRaster"], message: "carrier raster must match the spatial target" },
  ),
);

export const ImageTakeSchema = Schema.mutable(
  Schema.Struct({
    id: nonEmptyString,
    label: nonEmptyString,
    kind: Schema.Literal("generated", "imported"),
    createdAt: nonEmptyString,
    mediaAssetId: nonEmptyString,
    plateCommitId: Schema.NullOr(nonEmptyString),
    direction: Schema.String,
    strategy: Schema.Literal("integrated", "strict"),
    model: Schema.optional(nonEmptyString),
    prompt: Schema.optional(Schema.String),
    generationJobId: Schema.optional(nonEmptyString),
    generationOutputId: Schema.optional(nonEmptyString),
    spatialSpec: ImageSpatialSpecSchema,
    provenance: Schema.optional(ImageGenerationProvenanceSchema),
  }),
).pipe(
  Schema.filter((take) => {
    const issues: Schema.FilterIssue[] = [];
    if (take.kind === "generated" && take.plateCommitId === null) {
      issues.push({ path: ["plateCommitId"], message: "generated takes must reference their Plate Commit" });
    }
    if (take.provenance && take.provenance.plateCommitId !== take.plateCommitId) {
      issues.push({ path: ["provenance", "plateCommitId"], message: "take provenance must pin its Plate Commit" });
    }
    return issues;
  }),
);

export const CompositionSchema = Schema.mutable(
  Schema.Struct({
    id: nonEmptyString,
    label: nonEmptyString,
    sourceAssetIds: Schema.mutable(Schema.Array(nonEmptyString)),
    plateDraft: PlateDraftSchema,
    plateCommits: Schema.mutable(Schema.Array(PlateCommitSchema)),
    imageTakes: Schema.mutable(Schema.Array(ImageTakeSchema)),
    selectedPlateCommitId: Schema.NullOr(nonEmptyString),
    selectedImageTakeId: Schema.NullOr(nonEmptyString),
    generationDirection: Schema.String,
    generationStrategy: Schema.Literal("integrated", "strict"),
    notes: Schema.String,
    createdAt: nonEmptyString,
    updatedAt: nonEmptyString,
  }),
).pipe(
  Schema.filter((composition) => {
    const issues: Schema.FilterIssue[] = [];
    const commitIds = new Set(composition.plateCommits.map((commit) => commit.id));
    const takeIds = new Set(composition.imageTakes.map((take) => take.id));
    if (commitIds.size !== composition.plateCommits.length) {
      issues.push({ path: ["plateCommits"], message: "Plate Commit ids must be unique" });
    }
    if (takeIds.size !== composition.imageTakes.length) {
      issues.push({ path: ["imageTakes"], message: "Image Take ids must be unique" });
    }
    if (composition.selectedPlateCommitId && !commitIds.has(composition.selectedPlateCommitId)) {
      issues.push({ path: ["selectedPlateCommitId"], message: "selected Plate Commit is missing" });
    }
    if (composition.selectedImageTakeId && !takeIds.has(composition.selectedImageTakeId)) {
      issues.push({ path: ["selectedImageTakeId"], message: "selected Image Take is missing" });
    }
    for (const [index, take] of composition.imageTakes.entries()) {
      if (take.plateCommitId && !commitIds.has(take.plateCommitId)) {
        issues.push({ path: ["imageTakes", index, "plateCommitId"], message: "Image Take Plate Commit is missing" });
      }
    }
    return issues;
  }),
);

export const ProjectMetadataSchema = Schema.mutable(
  Schema.Struct({
    title: nonEmptyString,
    createdAt: nonEmptyString,
    updatedAt: nonEmptyString,
  }),
);

export const ProjectSchema = Schema.mutable(
  Schema.Struct({
    schemaVersion: Schema.Literal(ZENITH_SCHEMA_VERSION),
    id: nonEmptyString,
    metadata: ProjectMetadataSchema,
    assets: Schema.mutable(Schema.Record({ key: Schema.String, value: MediaAssetSchema })),
    compositions: Schema.mutable(Schema.Array(CompositionSchema).pipe(Schema.minItems(1))),
  }),
).pipe(
  Schema.filter((project) => {
    const issues: Schema.FilterIssue[] = [];
    const assetIds = new Set(Object.keys(project.assets));
    const compositionIds = new Set<string>();
    for (const [assetId, asset] of Object.entries(project.assets)) {
      if (assetId !== asset.id) issues.push({ path: ["assets", assetId], message: "asset key must equal asset id" });
    }
    for (const [index, composition] of project.compositions.entries()) {
      if (compositionIds.has(composition.id)) {
        issues.push({ path: ["compositions", index, "id"], message: "composition ids must be unique" });
      }
      compositionIds.add(composition.id);
      for (const assetId of composition.sourceAssetIds) {
        if (!assetIds.has(assetId)) {
          issues.push({ path: ["compositions", index, "sourceAssetIds"], message: `missing asset ${assetId}` });
        }
      }
      for (const commit of composition.plateCommits) {
        if (!assetIds.has(commit.mediaAssetId)) {
          issues.push({
            path: ["compositions", index, "plateCommits"],
            message: `missing asset ${commit.mediaAssetId}`,
          });
        }
        if (commit.provenance.projectId !== project.id || commit.provenance.compositionId !== composition.id) {
          issues.push({
            path: ["compositions", index, "plateCommits"],
            message: `Plate Commit ${commit.id} provenance does not match its Project and Composition`,
          });
        }
        const media = project.assets[commit.mediaAssetId];
        if (media && (media.width !== commit.draft.raster.width || media.height !== commit.draft.raster.height)) {
          issues.push({
            path: ["compositions", index, "plateCommits"],
            message: `Plate Commit ${commit.id} media does not match its exact raster`,
          });
        }
      }
      for (const take of composition.imageTakes) {
        if (!assetIds.has(take.mediaAssetId)) {
          issues.push({ path: ["compositions", index, "imageTakes"], message: `missing asset ${take.mediaAssetId}` });
        }
        if (
          take.provenance &&
          (take.provenance.projectId !== project.id || take.provenance.compositionId !== composition.id)
        ) {
          issues.push({
            path: ["compositions", index, "imageTakes"],
            message: `Image Take ${take.id} provenance does not match its Project and Composition`,
          });
        }
        const media = project.assets[take.mediaAssetId];
        if (
          take.kind === "generated" &&
          media &&
          (media.width !== take.spatialSpec.targetWidth || media.height !== take.spatialSpec.targetHeight)
        ) {
          issues.push({
            path: ["compositions", index, "imageTakes"],
            message: `Generated Image Take ${take.id} media does not match its exact spatial target`,
          });
        }
      }
    }
    return issues;
  }),
);

const vec3 = Schema.mutable(Schema.Tuple(finiteNumber, finiteNumber, finiteNumber));
const quaternion = Schema.mutable(Schema.Tuple(finiteNumber, finiteNumber, finiteNumber, finiteNumber));

export const AudienceInSpaceSchema = Schema.mutable(
  Schema.Struct({
    xMeters: finiteNumber,
    zMeters: finiteNumber,
    eyeHeightMeters: positiveNumber,
    yawDegrees: finiteNumber,
    pitchDegrees: finiteNumber,
    fovDegrees: positiveNumber.pipe(Schema.between(30, 130)),
    domeRadiusMeters: positiveNumber,
  }),
);

export const DEFAULT_AUDIENCE_IN_SPACE = {
  xMeters: 0,
  zMeters: 0,
  eyeHeightMeters: 1.65,
  yawDegrees: 0,
  pitchDegrees: 0,
  fovDegrees: 82,
  domeRadiusMeters: 7.5,
} as const;

export const WorkspaceSchema = Schema.mutable(
  Schema.Struct({
    selectedCompositionId: nonEmptyString,
    room: Schema.Literal("compose", "generate", "review"),
    selectedLayerId: Schema.NullOr(nonEmptyString),
    viewMode: Schema.Literal("source-map", "dome-orbit", "dome-pov", "cave-room", "audience-space"),
    viewerMode: Schema.Literal("domemaster", "dome-check", "rim-check"),
    audience: Schema.optionalWith(AudienceInSpaceSchema, {
      default: () => ({ ...DEFAULT_AUDIENCE_IN_SPACE }),
    }),
    camera: Schema.mutable(
      Schema.Struct({
        position: vec3,
        orientation: quaternion,
        pivot: Schema.NullOr(vec3),
        fovDegrees: positiveNumber,
        nearMeters: positiveNumber,
        farMeters: positiveNumber,
        mode: Schema.Literal("inside", "orbit", "fly"),
      }),
    ),
  }),
);

export const ZenithDocumentSchema = Schema.mutable(
  Schema.Struct({
    project: ProjectSchema,
    workspace: WorkspaceSchema,
  }),
).pipe(
  Schema.filter((document) =>
    document.project.compositions.some((composition) => composition.id === document.workspace.selectedCompositionId)
      ? true
      : { path: ["workspace", "selectedCompositionId"], message: "selected composition is missing" },
  ),
);

export const GenerationSourceReferenceSchema = Schema.mutable(
  Schema.Struct({
    tag: nonEmptyString,
    imageDataUrl: nonEmptyString.pipe(Schema.pattern(/^data:[^,]*;base64,/i)),
    filename: nonEmptyString,
  }),
);

export const GenerationInputSchema = Schema.mutable(
  Schema.Struct({
    imageDataUrl: nonEmptyString.pipe(Schema.pattern(/^data:[^,]*;base64,/i)),
    prompt: nonEmptyString,
    direction: Schema.String,
    strategy: Schema.Literal("integrated", "strict"),
    model: Schema.Literal("gpt_image_2"),
    ratio: nonEmptyString.pipe(Schema.pattern(/^\d+:\d+$/)),
    quality: Schema.Literal("low", "medium", "high", "auto"),
    outputCount: Schema.Literal(1),
    referenceImageTag: Schema.Literal("plate_sketch"),
    sourceReferences: Schema.mutable(Schema.Array(GenerationSourceReferenceSchema).pipe(Schema.maxItems(15))),
    provenance: ImageGenerationProvenanceSchema,
  }),
);

export const PaidConfirmationRequestSchema = Schema.mutable(
  Schema.Struct({
    version: Schema.Literal(GENERATION_JOB_VERSION),
    action: Schema.Literal("generate-image"),
    inputDigest: nonEmptyString.pipe(Schema.pattern(/^[a-f0-9]{64}$/i)),
  }),
);

export const GenerationServiceStatusSchema = Schema.mutable(
  Schema.Struct({
    configured: Schema.Boolean,
    provider: Schema.Literal("runway"),
    model: Schema.Literal("gpt_image_2"),
  }),
);

export const PaidConfirmationGrantSchema = Schema.mutable(
  Schema.Struct({
    grant: nonEmptyString,
    inputDigest: nonEmptyString.pipe(Schema.pattern(/^[a-f0-9]{64}$/i)),
    expiresAt: nonEmptyString,
  }),
);

export const CreateGenerationJobRequestSchema = Schema.mutable(
  Schema.Struct({
    version: Schema.Literal(GENERATION_JOB_VERSION),
    action: Schema.Literal("generate-image"),
    confirmationGrant: nonEmptyString,
    input: GenerationInputSchema,
  }),
);

export const GenerationJobOutputSchema = Schema.mutable(
  Schema.Struct({
    id: nonEmptyString,
    url: nonEmptyString,
    contentType: nonEmptyString,
    filename: nonEmptyString,
    width: positiveInteger,
    height: positiveInteger,
  }),
);

export const PublicJobErrorSchema = Schema.mutable(
  Schema.Struct({
    message: nonEmptyString,
    status: Schema.Number.pipe(Schema.int(), Schema.between(100, 599)),
    code: Schema.Literal("invalid_input", "missing_secret", "upstream_failed", "timeout", "cancelled", "server_error"),
    provider: Schema.Literal("zenith", "runway"),
  }),
);

export const GenerationJobSchema = Schema.mutable(
  Schema.Struct({
    version: Schema.Literal(GENERATION_JOB_VERSION),
    id: nonEmptyString,
    projectId: nonEmptyString,
    compositionId: nonEmptyString,
    plateCommitId: nonEmptyString,
    status: Schema.Literal("queued", "running", "succeeded", "failed", "cancelled"),
    stage: nonEmptyString,
    progress: finiteNumber.pipe(Schema.between(0, 1)),
    createdAt: nonEmptyString,
    startedAt: Schema.optional(nonEmptyString),
    finishedAt: Schema.optional(nonEmptyString),
    provenance: ImageGenerationProvenanceSchema,
    direction: Schema.String,
    strategy: Schema.Literal("integrated", "strict"),
    prompt: nonEmptyString,
    model: Schema.Literal("gpt_image_2"),
    outputs: Schema.mutable(Schema.Array(GenerationJobOutputSchema)),
    error: Schema.optional(PublicJobErrorSchema),
  }),
);

export const GenerationJobEventSchema = Schema.mutable(
  Schema.Struct({
    version: Schema.Literal(GENERATION_JOB_VERSION),
    id: nonEmptyString,
    jobId: nonEmptyString,
    sequence: positiveInteger,
    type: Schema.Literal("queued", "started", "progress", "complete", "error", "cancelled"),
    status: Schema.Literal("queued", "running", "succeeded", "failed", "cancelled"),
    stage: nonEmptyString,
    progress: finiteNumber.pipe(Schema.between(0, 1)),
    createdAt: nonEmptyString,
    job: GenerationJobSchema,
  }),
);

export const DurableJobJournalSchema = Schema.mutable(
  Schema.Struct({
    job: GenerationJobSchema,
    events: Schema.mutable(Schema.Array(GenerationJobEventSchema)),
    input: GenerationInputSchema,
    providerTaskId: Schema.optional(nonEmptyString),
  }),
);

export type MediaAsset = Schema.Schema.Type<typeof MediaAssetSchema>;
export type PlateDraft = Schema.Schema.Type<typeof PlateDraftSchema>;
export type ImageSpatialSpec = Schema.Schema.Type<typeof ImageSpatialSpecSchema>;
export type PlateCommitProvenance = Schema.Schema.Type<typeof PlateCommitProvenanceSchema>;
export type PlateCommit = Schema.Schema.Type<typeof PlateCommitSchema>;
export type ImageGenerationProvenance = Schema.Schema.Type<typeof ImageGenerationProvenanceSchema>;
export type ImageTake = Schema.Schema.Type<typeof ImageTakeSchema>;
export type Composition = Schema.Schema.Type<typeof CompositionSchema>;
export type Project = Schema.Schema.Type<typeof ProjectSchema>;
export type Workspace = Schema.Schema.Type<typeof WorkspaceSchema>;
export type AudienceInSpace = Schema.Schema.Type<typeof AudienceInSpaceSchema>;
export type ZenithDocument = Schema.Schema.Type<typeof ZenithDocumentSchema>;
export type GenerationSourceReference = Schema.Schema.Type<typeof GenerationSourceReferenceSchema>;
export type GenerationInput = Schema.Schema.Type<typeof GenerationInputSchema>;
export type PaidConfirmationRequest = Schema.Schema.Type<typeof PaidConfirmationRequestSchema>;
export type GenerationServiceStatus = Schema.Schema.Type<typeof GenerationServiceStatusSchema>;
export type PaidConfirmationGrant = Schema.Schema.Type<typeof PaidConfirmationGrantSchema>;
export type CreateGenerationJobRequest = Schema.Schema.Type<typeof CreateGenerationJobRequestSchema>;
export type GenerationJobOutput = Schema.Schema.Type<typeof GenerationJobOutputSchema>;
export type PublicJobError = Schema.Schema.Type<typeof PublicJobErrorSchema>;
export type GenerationJob = Schema.Schema.Type<typeof GenerationJobSchema>;
export type GenerationJobEvent = Schema.Schema.Type<typeof GenerationJobEventSchema>;
export type DurableJobJournal = Schema.Schema.Type<typeof DurableJobJournalSchema>;

export function decodeSchemaSync<S extends Schema.Schema.AnyNoContext>(
  schema: S,
  value: unknown,
): Schema.Schema.Type<S> {
  return Schema.decodeUnknownSync(schema)(value, { onExcessProperty: "error" });
}

export function decodeSchemaEither<S extends Schema.Schema.AnyNoContext>(schema: S, value: unknown) {
  return Schema.decodeUnknownEither(schema)(value, { onExcessProperty: "error" });
}

export function encodeSchemaSync<S extends Schema.Schema.AnyNoContext>(
  schema: S,
  value: Schema.Schema.Type<S>,
): Schema.Schema.Encoded<S> {
  return Schema.encodeSync(schema)(value);
}

export function terminalGenerationJob(job: GenerationJob): boolean {
  return job.status === "succeeded" || job.status === "failed" || job.status === "cancelled";
}

export function nextEventSequence(events: readonly GenerationJobEvent[]): number {
  return events.length === 0 ? 1 : events[events.length - 1]!.sequence + 1;
}

export function nonNegativeRevision(value: number): number {
  return Math.max(0, Math.round(value));
}

export const RevisionNumberSchema = nonNegativeInteger;
