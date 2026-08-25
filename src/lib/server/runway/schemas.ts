import { z, ZodError } from "zod";
import type { ApiPayload } from "./types";
import { httpError } from "./errors";
import { gptImage2RasterIssues } from "../../shared/contracts/projection-authoring.js";
import { ImageGenerationProvenanceV1Schema } from "../../shared/contracts/composition-sequence.js";

const dataUrl = z.string().regex(/^data:[^,]*;base64,/i, "Expected a base64 data URL.");
const optionalDataUrl = z.union([dataUrl, z.literal(""), z.null()]).optional();
const referenceImage = z
  .object({
    tag: z.string().optional(),
    uri: z.string().optional(),
    imageDataUrl: optionalDataUrl,
    dataUri: optionalDataUrl,
    filename: z.string().optional(),
  })
  .passthrough();

const runwayInpaintPayload = z
  .object({
    imageDataUrl: dataUrl,
    prompt: z.string().trim().min(1, "Prompt is required."),
    ratio: z
      .string()
      .regex(/^\d+:\d+$/)
      .optional(),
    filename: z.string().optional(),
    model: z.literal("gpt_image_2").optional(),
    sourceImageDataUrl: optionalDataUrl,
    sourceFilename: z.string().optional(),
    sourceImageTag: z.string().optional(),
    referenceImageTag: z.string().optional(),
    outputCount: z.number().or(z.string()).optional(),
    quality: z.enum(["low", "medium", "high", "auto"]).optional(),
    extraReferenceImages: z.array(referenceImage).max(15).optional(),
    provenance: ImageGenerationProvenanceV1Schema,
  })
  .passthrough()
  .superRefine((payload, ctx) => {
    if (!payload.ratio) return;
    const [width, height] = payload.ratio.split(":").map(Number);
    for (const issue of gptImage2RasterIssues(width, height)) {
      ctx.addIssue({ code: "custom", path: ["ratio"], message: issue.message });
    }
  });

export function validateRunwayInpaintPayload(payload: ApiPayload): ApiPayload {
  const result = runwayInpaintPayload.safeParse(payload);
  if (result.success) return result.data as ApiPayload;
  throw httpError(400, formatZodError("Runway inpaint", result.error));
}

function formatZodError(label: string, error: ZodError): string {
  const issue = error.issues[0];
  return (
    label + " " + (issue?.path.length ? issue.path.join(".") : "payload") + ": " + (issue?.message || "invalid payload")
  );
}
