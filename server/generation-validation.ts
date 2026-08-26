import { createHash } from "node:crypto";
import { Buffer } from "node:buffer";
import { Effect } from "effect";

import { canonicalGenerationInput } from "../src/domain/generation.js";
import type { GenerationInput } from "../src/domain/schema.js";
import { gptImage2RasterIssues } from "../src/lib/shared/contracts/projection-authoring.js";
import { readImageByteDimensions } from "../src/media/image-byte-dimensions.js";
import { invalidInput } from "./errors.js";

const MAX_PROMPT_LENGTH = 32_000;
const MIN_IMAGE_BYTES = 512;

export type ParsedImageDataUrl = {
  readonly mime: string;
  readonly bytes: Uint8Array;
};

export function serverGenerationInputDigest(input: GenerationInput): string {
  return createHash("sha256").update(canonicalGenerationInput(input)).digest("hex");
}

/** Complete semantic validation. This must run before a grant is consumed or a provider is called. */
export function validateGenerationInput(projectId: string, input: GenerationInput) {
  return Effect.try({
    try: () => {
      if (input.provenance.projectId !== projectId) {
        throw new Error("The route project does not match generation provenance.");
      }
      if (!input.prompt.trim()) throw new Error("A generation prompt is required.");
      if (input.prompt.length > MAX_PROMPT_LENGTH) {
        throw new Error(`The generation prompt exceeds ${MAX_PROMPT_LENGTH} characters.`);
      }
      const raster = input.provenance.carrierRaster;
      if (input.ratio !== raster.aspectPreset) {
        throw new Error("The model ratio does not match the pinned carrier raster.");
      }
      const rasterIssue = gptImage2RasterIssues(raster.width, raster.height)[0];
      if (rasterIssue) throw new Error(rasterIssue.message);
      const plate = parseImageDataUrl(input.imageDataUrl);
      const plateDimensions = readImageByteDimensions(plate.bytes);
      if (!plateDimensions) throw new Error("The committed Plate Sketch is not a supported encoded image.");
      if (plateDimensions.width !== raster.width || plateDimensions.height !== raster.height) {
        throw new Error(
          `The committed Plate Sketch is ${plateDimensions.width}×${plateDimensions.height}; the pinned carrier requires exactly ${raster.width}×${raster.height} pixels.`,
        );
      }
      for (const reference of input.sourceReferences) parseImageDataUrl(reference.imageDataUrl);
      const digest = serverGenerationInputDigest(input);
      if (input.provenance.inputDigest !== digest) {
        throw new Error("Generation provenance does not match the request digest.");
      }
      return { input, inputDigest: digest };
    },
    catch: (cause) =>
      invalidInput(cause instanceof Error ? cause.message : "The generation request is invalid.", cause),
  });
}

export function parseImageDataUrl(dataUrl: string): ParsedImageDataUrl {
  const match = /^data:([^,;]+)(?:;[^,]*)?;base64,([\s\S]+)$/i.exec(dataUrl);
  if (!match) throw new Error("Expected a base64 image data URL.");
  const mime = match[1]!.toLowerCase();
  if (!mime.startsWith("image/")) throw new Error("Expected image media in the generation request.");
  const buffer = Buffer.from(match[2]!, "base64");
  if (buffer.byteLength < MIN_IMAGE_BYTES) throw new Error("Generation image media is too small.");
  return { mime, bytes: new Uint8Array(buffer) };
}
