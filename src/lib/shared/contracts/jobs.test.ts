import { describe, expect, test } from "vitest";
import { carrierRasterForAspect } from "./projection-authoring.js";
import { defaultImageSpatialSpec } from "./composition-sequence.js";
import { CreateJobRequestV1Schema, jobArtifactsForOperator } from "./jobs.js";

describe("image generation job contract", () => {
  test("accepts only the single Plate Sketch to finished-image operation", () => {
    const carrierRaster = carrierRasterForAspect("1:1");
    const spatialSpec = defaultImageSpatialSpec();
    const provenance = {
      version: 1 as const,
      compositionId: "composition-1",
      sourceRevisionId: "plate-1",
      operatorId: "inpaint-plate-sketch" as const,
      carrierRaster,
      spatialSpec,
    };
    const request = {
      version: 1,
      operatorId: "inpaint-plate-sketch",
      confirmationGrant: "confirmed",
      inputArtifactIds: ["plate-sketch"],
      outputArtifactIds: ["finished-image"],
      input: {
        prompt: "Complete the authored Plate Sketch as one continuous spatial image.",
        imageDataUrl: "data:image/png;base64,AA==",
        extraReferenceImages: [
          {
            tag: "source_1",
            imageDataUrl: "data:image/webp;base64,AA==",
            filename: "macro-source.webp",
          },
        ],
        provenance,
      },
    };

    expect(CreateJobRequestV1Schema.safeParse(request).success).toBe(true);
    expect(jobArtifactsForOperator("inpaint-plate-sketch")).toEqual({
      inputArtifactIds: ["plate-sketch"],
      outputArtifactIds: ["finished-image"],
      outputArtifactId: "finished-image",
    });
    expect(CreateJobRequestV1Schema.safeParse({ ...request, operatorId: "generate-video" }).success).toBe(false);
    expect(
      CreateJobRequestV1Schema.safeParse({
        ...request,
        input: {
          ...request.input,
          extraReferenceImages: Array.from({ length: 16 }, (_, index) => ({
            tag: `source_${index + 1}`,
            imageDataUrl: "data:image/png;base64,AA==",
            filename: `source-${index + 1}.png`,
          })),
        },
      }).success,
    ).toBe(false);
  });
});
