import { z, ZodError } from "zod";
import { ImageGenerationProvenanceV1Schema } from "./composition-sequence.js";

export const JOB_CONTRACT_VERSION = 1;
export const JOB_OPERATOR_IDS = ["inpaint-plate-sketch"] as const;
export const JOB_STATUSES = ["queued", "running", "succeeded", "failed", "cancelled"] as const;
export const JOB_EVENT_TYPES = ["queued", "started", "progress", "complete", "error", "cancelled"] as const;

export type JobOperatorIdV1 = (typeof JOB_OPERATOR_IDS)[number];
export type JobStatusV1 = (typeof JOB_STATUSES)[number];
export type JobEventTypeV1 = (typeof JOB_EVENT_TYPES)[number];
export type JobInputArtifactIdsV1 = ["plate-sketch"];
export type JobOutputArtifactIdsV1 = ["finished-image"];
export type JobOutputArtifactIdV1 = "finished-image";

export function jobArtifactsForOperator(_operatorId: JobOperatorIdV1) {
  return {
    inputArtifactIds: ["plate-sketch"] as JobInputArtifactIdsV1,
    outputArtifactIds: ["finished-image"] as JobOutputArtifactIdsV1,
    outputArtifactId: "finished-image" as JobOutputArtifactIdV1,
  };
}

export function jobInputArtifactIdsForInput(
  _operatorId: JobOperatorIdV1,
  _input: Record<string, unknown>,
): JobInputArtifactIdsV1 {
  return ["plate-sketch"];
}

const progressSchema = z.number().finite().min(0).max(1);
const dataUrlSchema = z.string().regex(/^data:[^,]*;base64,/i, "Expected a base64 data URL.");
const portableUrlSchema = z.string().refine((url) => !url.startsWith("blob:"), "object URLs are runtime-only");
const confirmationGrantSchema = z.string().trim().min(1, "A paid confirmation grant is required.");
const inputDigestSchema = z.string().regex(/^[a-f0-9]{64}$/i, "Expected a SHA-256 input digest.");
const inpaintSourceReferenceSchema = z
  .object({
    tag: z.string().regex(/^source_\d+$/),
    imageDataUrl: dataUrlSchema,
    filename: z.string().min(1),
  })
  .strict();

const inpaintJobInputSchema = z
  .object({
    prompt: z.string().trim().min(1),
    ratio: z
      .string()
      .regex(/^\d+:\d+$/)
      .optional(),
    filename: z.string().optional(),
    imageDataUrl: dataUrlSchema,
    model: z.literal("gpt_image_2").optional(),
    sourceImageDataUrl: z.union([dataUrlSchema, z.literal(""), z.null()]).optional(),
    sourceFilename: z.string().optional(),
    sourceImageTag: z.string().optional(),
    referenceImageTag: z.string().optional(),
    outputCount: z.literal(1).optional(),
    quality: z.enum(["low", "medium", "high", "auto"]).optional(),
    extraReferenceImages: z.array(inpaintSourceReferenceSchema).max(15).optional(),
    provenance: ImageGenerationProvenanceV1Schema,
  })
  .strict();

const publicJobErrorSchema = z
  .object({
    message: z.string(),
    status: z.number().int().min(100).max(599),
    code: z
      .enum(["invalid_input", "missing_secret", "upstream_failed", "timeout", "cancelled", "server_error"])
      .optional(),
    provider: z.enum(["zenith", "runway"]).optional(),
    providerTaskId: z.string().optional(),
  })
  .strict();

const jobOutputSchema = z
  .object({
    kind: z.literal("image"),
    dataUri: dataUrlSchema.optional(),
    url: portableUrlSchema.optional(),
    contentType: z.string().optional(),
    name: z.string().optional(),
  })
  .strict()
  .superRefine((output, ctx) => {
    if (!output.dataUri && !output.url)
      ctx.addIssue({ code: "custom", path: ["dataUri"], message: "output media is required" });
  });

export const CreateJobRequestV1Schema = z
  .object({
    version: z.literal(JOB_CONTRACT_VERSION),
    operatorId: z.literal("inpaint-plate-sketch"),
    confirmationGrant: confirmationGrantSchema,
    inputArtifactIds: z.tuple([z.literal("plate-sketch")]).optional(),
    outputArtifactIds: z.tuple([z.literal("finished-image")]).optional(),
    input: z.record(z.string(), z.unknown()),
  })
  .strict()
  .superRefine((request, ctx) => {
    const parsed = inpaintJobInputSchema.safeParse(request.input);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      ctx.addIssue({
        code: "custom",
        path: ["input", ...(issue?.path || [])],
        message: issue?.message || "invalid input",
      });
    }
  });

export const PaidConfirmationGrantRequestV1Schema = z
  .object({
    version: z.literal(JOB_CONTRACT_VERSION),
    operatorId: z.literal("inpaint-plate-sketch"),
    inputDigest: inputDigestSchema,
  })
  .strict();

export const JobResultV1Schema = z
  .object({
    resultType: z.literal("runway-stream-result"),
    operatorId: z.literal("inpaint-plate-sketch"),
    outputArtifactId: z.literal("finished-image"),
    id: z.string().optional(),
    status: z.string().optional(),
    model: z.string().optional(),
    ratio: z.string().optional(),
    provenance: ImageGenerationProvenanceV1Schema.optional(),
    outputs: z.array(jobOutputSchema).min(1),
  })
  .strict();

const eventBase = z.object({
  version: z.literal(JOB_CONTRACT_VERSION),
  id: z.string(),
  jobId: z.string(),
  sequence: z.number().int().positive(),
  status: z.enum(JOB_STATUSES),
  stage: z.string(),
  progress: progressSchema,
  createdAt: z.string(),
});

export const JobEventV1Schema = z.discriminatedUnion("type", [
  eventBase.extend({ type: z.literal("queued"), status: z.literal("queued") }).strict(),
  eventBase.extend({ type: z.literal("started"), status: z.literal("running") }).strict(),
  eventBase
    .extend({
      type: z.literal("progress"),
      status: z.literal("running"),
      provider: z.literal("runway").optional(),
      providerTaskId: z.string().optional(),
      providerTaskStatus: z.string().optional(),
    })
    .strict(),
  eventBase.extend({ type: z.literal("complete"), status: z.literal("succeeded"), result: JobResultV1Schema }).strict(),
  eventBase.extend({ type: z.literal("error"), status: z.literal("failed"), error: publicJobErrorSchema }).strict(),
  eventBase
    .extend({ type: z.literal("cancelled"), status: z.literal("cancelled"), error: publicJobErrorSchema })
    .strict(),
]);

export const JobV1Schema = z
  .object({
    version: z.literal(JOB_CONTRACT_VERSION),
    id: z.string(),
    projectId: z.string(),
    operatorId: z.literal("inpaint-plate-sketch"),
    status: z.enum(JOB_STATUSES),
    stage: z.string(),
    progress: progressSchema,
    inputArtifactIds: z.tuple([z.literal("plate-sketch")]),
    outputArtifactIds: z.tuple([z.literal("finished-image")]),
    provenance: ImageGenerationProvenanceV1Schema.optional(),
    createdAt: z.string(),
    startedAt: z.string().optional(),
    finishedAt: z.string().optional(),
    result: JobResultV1Schema.optional(),
    error: publicJobErrorSchema.optional(),
  })
  .strict();

export type CreateJobRequestV1 = z.infer<typeof CreateJobRequestV1Schema>;
export type PaidConfirmationGrantRequestV1 = z.infer<typeof PaidConfirmationGrantRequestV1Schema>;
export type JobResultV1 = z.infer<typeof JobResultV1Schema>;
export type PublicJobErrorV1 = z.infer<typeof publicJobErrorSchema>;
export type JobEventV1 = z.infer<typeof JobEventV1Schema>;
export type JobV1 = z.infer<typeof JobV1Schema>;

export class JobContractParseError extends Error {
  status = 400;
  constructor(message: string) {
    super(message);
    this.name = "JobContractParseError";
  }
}

export const parseCreateJobRequest = (payload: unknown): CreateJobRequestV1 =>
  parse(CreateJobRequestV1Schema, payload, "Job create request");
export const parsePaidConfirmationGrantRequest = (payload: unknown): PaidConfirmationGrantRequestV1 =>
  parse(PaidConfirmationGrantRequestV1Schema, payload, "Paid confirmation request");
export const parseJob = (payload: unknown): JobV1 => parse(JobV1Schema, payload, "Job");
export const parseJobEvent = (payload: unknown): JobEventV1 => parse(JobEventV1Schema, payload, "Job event");
export const parseJobResult = (payload: unknown): JobResultV1 => parse(JobResultV1Schema, payload, "Job result");

function parse<T>(schema: z.ZodType<T>, payload: unknown, label: string): T {
  try {
    return schema.parse(payload);
  } catch (error) {
    if (error instanceof ZodError) {
      const issue = error.issues[0];
      throw new JobContractParseError(`${issue?.path.join(".") || label}: ${issue?.message || "invalid contract"}`);
    }
    throw error;
  }
}
