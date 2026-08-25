import {
  finishJob,
  getArtifact,
  startJob,
  syncServerJob,
  updateJob,
  workbench,
} from "../artifacts/artifact-store.svelte.js";
import { getArtifactMediaHandle } from "../artifacts/artifact-media-handles.js";
import type { OperatorId } from "../artifacts/artifact-types.js";
import {
  ImageGenerationProvenanceV1Schema,
  type ImageGenerationProvenanceV1,
} from "../lib/shared/contracts/composition-sequence.js";
import {
  CYLINDER_WALL_GENERATION_ASPECT_PRESET,
  gptImage2RatioForRaster,
} from "../lib/shared/contracts/projection-authoring.js";
import { readArtifactMediaAsDataUrl, toRuntimeArtifactMedia } from "../artifacts/artifact-runtime-media.js";
import { requestPaidConfirmationGrant, requestRunwayJob, type RunwayStreamResult } from "../runway/client.js";
import { applyOperatorArtifactResult, runwayOutputArtifactMedia } from "./operator-artifact-results.js";
import { getOperator } from "./operator-registry.js";
import { captureFinishedImage, selectedCompositionState } from "./workbench-sequence-commands.js";
import {
  committedPlateSketchMatchesDraft,
  plateSketchRevisionForComposition,
  presentationMediaForRevision,
} from "../sequence/composition-sequence.js";
import { compileRepairPromptForProjectionSnapshot } from "../inpaint/inpaint-prompts.js";
import { assertExactImagePixelDimensions } from "../media/image-pixel-dimensions.js";
import { activeWorkbenchRuntime } from "../artifacts/workbench-runtime.svelte.js";
import { inpaintSourceReferenceInputs } from "./inpaint-source-reference-inputs.js";

export async function executePaidOperator(operatorId: OperatorId): Promise<void> {
  if (operatorId !== "inpaint-plate-sketch") throw new Error("Action " + operatorId + " is not a paid image action.");
  const operator = getOperator(operatorId);
  const target = selectedCommittedPlateTarget();
  const snapshot = target.revision.plateComposition!;
  if (
    snapshot.projectionMode === "cylinder-wall" &&
    snapshot.raster.aspectPreset !== CYLINDER_WALL_GENERATION_ASPECT_PRESET
  ) {
    throw new Error("Cylinder Wall generation requires a 21:9 Plate Sketch. Rebuild and recommit this composition.");
  }
  const plateSketch = await readArtifactMediaAsDataUrl(
    getArtifact("plate-sketch"),
    getArtifactMediaHandle("plate-sketch"),
  );
  await assertExactImagePixelDimensions(plateSketch, snapshot.raster, "Committed Plate Sketch");
  const prompt = compileRepairPromptForProjectionSnapshot(
    workbench.project.generation.prompt,
    snapshot,
    workbench.project.generation.direction,
    workbench.project.generation.mode,
  );
  const sourceReferences =
    workbench.project.generation.mode === "integrated"
      ? await inpaintSourceReferenceInputs({
          snapshot,
          sequence: workbench.project.sequence,
          mediaRegistry: activeWorkbenchRuntime.compositionSourceMedia,
        })
      : [];
  const provenance = ImageGenerationProvenanceV1Schema.parse({
    version: 1,
    compositionId: target.composition.id,
    sourceRevisionId: target.revision.id,
    operatorId,
    model: "gpt_image_2",
    carrierRaster: snapshot.raster,
    spatialSpec: target.revision.spatialSpec,
  });
  const input = {
    imageDataUrl: plateSketch,
    model: "gpt_image_2" as const,
    ratio: gptImage2RatioForRaster(snapshot.raster),
    prompt,
    quality: "high" as const,
    outputCount: 1 as const,
    referenceImageTag: "plate_sketch",
    sourceImageTag: "source",
    ...(sourceReferences.length > 0 ? { extraReferenceImages: sourceReferences } : {}),
    provenance,
  };
  const confirmationGrant = await requestPaidConfirmationGrant(operatorId, input);
  startJob(operatorId, operator.label);
  const result = await requestRunwayJob(operatorId, input, {
    confirmationGrant,
    inputArtifactIds: ["plate-sketch"],
    onJobCreated: syncServerJob,
    onProgress: (stage, progress) => updateJob(operatorId, stage, progress),
  });
  const echoedProvenance = requireMatchingImageProvenance(result, provenance);
  const outputMedia = runwayOutputArtifactMedia({
    result,
    kind: "image",
    label: "Inpainted Image",
    fallbackMime: "image/png",
    emptyMessage: "Image endpoint returned no output.",
  });
  const revision = await captureFinishedImage({
    media: outputMedia,
    provenance: echoedProvenance,
    label: outputMedia.name || target.composition.label + " Image",
    prompt,
  });
  if (selectedCompositionState()?.id !== target.composition.id) {
    finishJob(operatorId, "Complete · attached to " + target.composition.label);
    return;
  }
  applyOperatorArtifactResult({
    artifactId: "finished-image",
    operatorId,
    media: toRuntimeArtifactMedia(presentationMediaForRevision(revision)),
    resultLabel: "Inpainted Image",
    summary: "Inpainted image ready from " + (result.model || "image endpoint") + ".",
    prompt,
    provenance: revision.provenance,
    projectionProfile: revision.projectionProfile,
  });
}

function selectedCommittedPlateTarget() {
  const composition = selectedCompositionState();
  if (!composition) throw new Error("Select a composition before generating an image.");
  const revision = plateSketchRevisionForComposition(workbench.project.sequence, composition);
  if (!revision?.plateComposition) throw new Error("Commit this composition as a Plate Sketch first.");
  if (!committedPlateSketchMatchesDraft(workbench.project.sequence, composition)) {
    throw new Error("This composition changed after its Plate Sketch was committed. Commit it again first.");
  }
  return { composition, revision };
}

function requireMatchingImageProvenance(
  result: RunwayStreamResult,
  expected: ImageGenerationProvenanceV1,
): ImageGenerationProvenanceV1 {
  const parsed = ImageGenerationProvenanceV1Schema.safeParse(result.provenance);
  if (!parsed.success) throw new Error("The image result did not return its pinned Zenith spatial provenance.");
  if (JSON.stringify(parsed.data) !== JSON.stringify(expected)) {
    throw new Error("The image result provenance does not match the confirmed Plate Sketch.");
  }
  return parsed.data;
}
