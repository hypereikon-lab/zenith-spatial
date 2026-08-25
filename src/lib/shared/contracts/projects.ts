import { z, ZodError } from "zod";
import {
  PROJECT_ARTIFACT_INPUTS_BY_ID,
  PROJECT_ARTIFACT_PHASE_BY_ID,
  PROJECT_ARTIFACT_PHASE_IDS,
  PROJECT_ARTIFACT_SLOT_IDS,
  type ProjectArtifactSlotId,
} from "./artifact-topology.js";
import { DOME_SCENE_EDITOR_MODE_IDS } from "./dome-scene-editor.js";
import { DomeSceneSchema } from "./dome-scene.js";
import { CompositionSequenceSchema, ImageGenerationProvenanceV1Schema } from "./composition-sequence.js";
import { SOURCE_PROJECTION_MODES } from "./projection-profile.js";

export {
  PROJECT_ARTIFACT_INPUTS_BY_ID,
  PROJECT_ARTIFACT_PHASE_BY_ID,
  PROJECT_ARTIFACT_PHASE_IDS,
  PROJECT_ARTIFACT_SLOT_IDS,
} from "./artifact-topology.js";
export type { ProjectArtifactPhaseId, ProjectArtifactSlotId } from "./artifact-topology.js";
export * from "./dome-scene-editor.js";
export * from "./dome-scene.js";
export * from "./composition-sequence.js";
export * from "./projection-authoring.js";
export * from "./projection-profile.js";

export const PROJECT_SNAPSHOT_VERSION = 17;
export const PROJECT_ARTIFACT_STATUSES = ["missing", "ready", "working", "done", "warning", "stale"] as const;
export const PROJECT_MEDIA_KINDS = ["none", "image"] as const;
export const PROJECT_VIEWER_MODES = ["domemaster", "dome-check", "rim-check"] as const;

export type ProjectJsonValue =
  | string
  | number
  | boolean
  | null
  | ProjectJsonValue[]
  | { [key: string]: ProjectJsonValue };

const finiteNumberSchema = z.number().finite();
const projectJsonValueSchema: z.ZodType<ProjectJsonValue> = z.lazy(() =>
  z.union([
    z.string(),
    finiteNumberSchema,
    z.boolean(),
    z.null(),
    z.array(projectJsonValueSchema),
    z.record(z.string(), projectJsonValueSchema),
  ]),
);
const artifactSlotIdSchema = z.enum(PROJECT_ARTIFACT_SLOT_IDS);
const artifactPhaseIdSchema = z.enum(PROJECT_ARTIFACT_PHASE_IDS);
const projectionModeSchema = z.enum(SOURCE_PROJECTION_MODES);

export const ProjectArtifactMediaSchema = z
  .object({
    kind: z.enum(PROJECT_MEDIA_KINDS),
    url: z
      .string()
      .refine((url) => !url.startsWith("blob:"), "object URLs are runtime-only")
      .optional(),
    name: z.string().optional(),
    mime: z.string().optional(),
    alt: z.string().optional(),
    blob: z.null().optional(),
    file: z.null().optional(),
    canvas: z.null().optional(),
  })
  .strict()
  .superRefine((media, ctx) => {
    if (media.kind === "image" && !media.url) {
      ctx.addIssue({ code: "custom", path: ["url"], message: "image media requires a portable URL" });
    }
  })
  .transform(({ kind, url, name, mime, alt }) => ({
    kind,
    ...(url ? { url } : {}),
    ...(name ? { name } : {}),
    ...(mime ? { mime } : {}),
    ...(alt ? { alt } : {}),
  }));

export const ProjectArtifactResultSchema = z
  .object({
    id: z.string(),
    label: z.string(),
    createdAt: z.string(),
    media: ProjectArtifactMediaSchema,
    prompt: z.string().optional(),
    config: z.record(z.string(), projectJsonValueSchema).optional(),
    provenance: ImageGenerationProvenanceV1Schema.optional(),
    operatorId: z.string().optional(),
    selected: z.boolean().optional(),
  })
  .strict();

export const ProjectArtifactRecordSchema = z
  .object({
    id: artifactSlotIdSchema,
    type: artifactSlotIdSchema,
    phase: artifactPhaseIdSchema,
    label: z.string(),
    summary: z.string(),
    status: z.enum(PROJECT_ARTIFACT_STATUSES),
    inputs: z.array(artifactSlotIdSchema),
    operatorId: z.string().optional(),
    projectionProfile: projectionModeSchema,
    provenance: ImageGenerationProvenanceV1Schema.optional(),
    prompt: z.string().optional(),
    config: z.record(z.string(), projectJsonValueSchema).optional(),
    media: ProjectArtifactMediaSchema,
    results: z.array(ProjectArtifactResultSchema),
    createdAt: z.string().optional(),
    updatedAt: z.string().optional(),
    warnings: z.array(z.string()),
    qcNotes: z.array(z.string()),
    stale: z.boolean(),
  })
  .strict();

const artifactSchemas = Object.fromEntries(
  PROJECT_ARTIFACT_SLOT_IDS.map((id) => [id, ProjectArtifactRecordSchema]),
) as Record<ProjectArtifactSlotId, typeof ProjectArtifactRecordSchema>;

export const ProjectArtifactsSchema = z
  .object(artifactSchemas)
  .strict()
  .superRefine((artifacts, ctx) => {
    for (const id of PROJECT_ARTIFACT_SLOT_IDS) {
      const artifact = artifacts[id];
      if (artifact.id !== id || artifact.type !== id) {
        ctx.addIssue({ code: "custom", path: [id], message: `artifact identity must be ${id}` });
      }
      if (artifact.phase !== PROJECT_ARTIFACT_PHASE_BY_ID[id]) {
        ctx.addIssue({ code: "custom", path: [id, "phase"], message: "artifact phase differs" });
      }
      if (JSON.stringify(artifact.inputs) !== JSON.stringify(PROJECT_ARTIFACT_INPUTS_BY_ID[id])) {
        ctx.addIssue({ code: "custom", path: [id, "inputs"], message: "artifact inputs differ" });
      }
    }
  });

export const ProjectMediaPreviewSchema = z
  .object({
    open: z.boolean(),
    media: ProjectArtifactMediaSchema,
    summary: z.string(),
    updatedAt: z.string(),
  })
  .strict();

export const DomeSceneWorkspaceSchema = z
  .object({
    modeId: z.enum(DOME_SCENE_EDITOR_MODE_IDS),
    selectedArtifactId: artifactSlotIdSchema,
    viewerMode: z.enum(PROJECT_VIEWER_MODES),
    selectedCompositionId: z.string().nullable(),
    mediaPreview: ProjectMediaPreviewSchema,
  })
  .strict();

export const DomeSceneGenerationSchema = z
  .object({
    prompt: z.string(),
    direction: z.string(),
    mode: z.enum(["integrated", "strict"]),
  })
  .strict();

export const DomeSceneProjectSchema = z
  .object({
    scene: DomeSceneSchema,
    sequence: CompositionSequenceSchema,
    workspace: DomeSceneWorkspaceSchema,
    artifacts: ProjectArtifactsSchema,
    generation: DomeSceneGenerationSchema,
  })
  .strict();

export const ProjectSnapshotSchema = z
  .object({
    version: z.literal(PROJECT_SNAPSHOT_VERSION),
    createdAt: z.string(),
    project: DomeSceneProjectSchema,
  })
  .strict();

export type ProjectArtifactMedia = z.infer<typeof ProjectArtifactMediaSchema>;
export type ProjectArtifactResult = z.infer<typeof ProjectArtifactResultSchema>;
export type ProjectArtifactRecord = z.infer<typeof ProjectArtifactRecordSchema>;
export type DomeSceneWorkspace = z.infer<typeof DomeSceneWorkspaceSchema>;
export type DomeSceneGeneration = z.infer<typeof DomeSceneGenerationSchema>;
export type DomeSceneProject = z.infer<typeof DomeSceneProjectSchema>;
export type ProjectSnapshot = z.infer<typeof ProjectSnapshotSchema>;

export class ProjectSnapshotParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProjectSnapshotParseError";
  }
}

export function parseProjectSnapshot(payload: unknown): ProjectSnapshot {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new ProjectSnapshotParseError("Project snapshot must be a JSON object.");
  }
  try {
    return ProjectSnapshotSchema.parse(payload);
  } catch (error) {
    if (error instanceof ZodError) {
      const issue = error.issues[0];
      const path = issue?.path.length ? ` at ${issue.path.join(".")}` : "";
      throw new ProjectSnapshotParseError(`Invalid Zenith project${path}: ${issue?.message || "schema mismatch"}.`);
    }
    throw error;
  }
}
