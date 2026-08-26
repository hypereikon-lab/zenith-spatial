import { Clock, Data, Effect, Stream } from "effect";

import { addImageTake, compositionReadiness, selectedComposition, selectedPlateCommit } from "../domain/project.js";
import { browserGenerationInputDigest } from "../domain/generation.js";
import type { GenerationInput, GenerationJob, ImageTake, MediaAsset } from "../domain/schema.js";
import { compileRepairPromptForProjectionSnapshot } from "../inpaint/inpaint-prompts.js";
import { gptImage2RatioForRaster } from "../lib/shared/contracts/projection-authoring.js";
import { assertExactImagePixelDimensions } from "../media/image-pixel-dimensions.js";
import { IdGenerator } from "./id-service.js";
import { GenerationClient } from "./generation-client.js";
import { MediaRepository } from "./media-repository.js";
import { WorkbenchService } from "./workbench-service.js";

export class GenerationCommandError extends Data.TaggedError("GenerationCommandError")<{
  readonly operation: "prepare" | "confirm" | "run" | "output" | "cancel";
  readonly message: string;
  readonly cause?: unknown;
}> {}

export const refreshGenerationStatus = Effect.gen(function* () {
  const client = yield* GenerationClient;
  const workbench = yield* WorkbenchService;
  const status = yield* client.status.pipe(
    Effect.mapError(
      (cause) =>
        new GenerationCommandError({
          operation: "prepare",
          message: "Generation service status is unavailable.",
          cause,
        }),
    ),
  );
  const checkedAt = new Date(yield* Clock.currentTimeMillis).toISOString();
  yield* workbench.setEnvironment({ generationConfigured: status.configured, checkedAt });
  return status;
});

export const prepareGenerationInput = Effect.gen(function* () {
  const workbench = yield* WorkbenchService;
  const repository = yield* MediaRepository;
  const document = workbench.getSnapshot().document;
  const composition = selectedComposition(document);
  const readiness = compositionReadiness(composition);
  const commit = selectedPlateCommit(composition);
  if (!commit || !readiness.canGenerate) {
    return yield* Effect.fail(
      new GenerationCommandError({
        operation: "prepare",
        message: readiness.plateDirty
          ? "The Plate Draft changed. Commit it again before generation."
          : "Commit a Plate Sketch before generation.",
      }),
    );
  }
  const plateAsset = document.project.assets[commit.mediaAssetId];
  if (!plateAsset) {
    return yield* Effect.fail(
      new GenerationCommandError({ operation: "prepare", message: "The selected Plate Commit media is missing." }),
    );
  }
  const plateBlob = yield* repository.readBlob(plateAsset).pipe(
    Effect.mapError(
      (cause) =>
        new GenerationCommandError({
          operation: "prepare",
          message: "The committed Plate Sketch is unreadable.",
          cause,
        }),
    ),
  );
  const imageDataUrl = yield* blobToDataUrl(plateBlob);
  yield* Effect.tryPromise({
    try: () =>
      assertExactImagePixelDimensions(
        imageDataUrl,
        { width: commit.draft.raster.width, height: commit.draft.raster.height },
        "Committed Plate Sketch",
      ),
    catch: (cause) =>
      new GenerationCommandError({
        operation: "prepare",
        message: cause instanceof Error ? cause.message : "The committed Plate Sketch raster is invalid.",
        cause,
      }),
  });
  const sourceReferences =
    composition.generationStrategy === "integrated"
      ? yield* Effect.forEach(
          composition.sourceAssetIds.slice(0, 15),
          (assetId, index) =>
            Effect.gen(function* () {
              const asset = document.project.assets[assetId];
              if (!asset) return null;
              const blob = yield* repository.readBlob(asset);
              return {
                tag: `source_${String(index + 1).padStart(2, "0")}`,
                imageDataUrl: yield* blobToDataUrl(blob),
                filename: asset.filename,
              };
            }).pipe(Effect.catchAll(() => Effect.succeed(null))),
          { concurrency: 3 },
        ).pipe(Effect.map((references) => references.filter((item): item is NonNullable<typeof item> => item !== null)))
      : [];
  const prompt = compileRepairPromptForProjectionSnapshot(
    "",
    {
      projectionMode: commit.draft.projectionMode,
      guideSplit: commit.draft.guideSplit,
      horizonSplit: commit.draft.horizonSplit,
      raster: commit.draft.raster,
      surface: commit.draft.surface,
      frame: commit.draft.frame,
    },
    composition.generationDirection,
    composition.generationStrategy,
  );
  let input: GenerationInput = {
    imageDataUrl,
    prompt,
    direction: composition.generationDirection,
    strategy: composition.generationStrategy,
    model: "gpt_image_2",
    ratio: gptImage2RatioForRaster(commit.draft.raster),
    quality: "high",
    outputCount: 1,
    referenceImageTag: "plate_sketch",
    sourceReferences,
    provenance: {
      version: 2,
      projectId: document.project.id,
      compositionId: composition.id,
      plateCommitId: commit.id,
      inputDigest: "pending",
      model: "gpt_image_2",
      carrierRaster: structuredClone(commit.draft.raster),
      spatialSpec: structuredClone(commit.spatialSpec),
    },
  };
  const inputDigest = yield* Effect.tryPromise({
    try: () => browserGenerationInputDigest(input),
    catch: (cause) =>
      new GenerationCommandError({ operation: "prepare", message: "Could not digest the paid request.", cause }),
  });
  input = { ...input, provenance: { ...input.provenance, inputDigest } };
  return { composition, commit, input, inputDigest };
});

export const requestPaidGenerationConfirmation = Effect.gen(function* () {
  const prepared = yield* prepareGenerationInput;
  const client = yield* GenerationClient;
  const workbench = yield* WorkbenchService;
  const grant = yield* client
    .confirm(prepared.input.provenance.projectId, {
      version: 1,
      action: "generate-image",
      inputDigest: prepared.inputDigest,
    })
    .pipe(
      Effect.mapError(
        (cause) =>
          new GenerationCommandError({
            operation: "confirm",
            message: "Paid confirmation could not be issued.",
            cause,
          }),
      ),
    );
  yield* workbench.setPendingGeneration({
    compositionId: prepared.composition.id,
    plateCommitId: prepared.commit.id,
    input: prepared.input,
  });
  return grant;
});

export function runConfirmedGeneration(grant: string) {
  return Effect.gen(function* () {
    const client = yield* GenerationClient;
    const workbench = yield* WorkbenchService;
    const pending = workbench.getSnapshot().pendingGeneration;
    if (!pending) {
      return yield* Effect.fail(
        new GenerationCommandError({ operation: "run", message: "A fresh paid confirmation is required." }),
      );
    }
    const job = yield* client
      .create(pending.input.provenance.projectId, {
        version: 1,
        action: "generate-image",
        confirmationGrant: grant,
        input: pending.input,
      })
      .pipe(
        Effect.mapError(
          (cause) =>
            new GenerationCommandError({ operation: "run", message: "Generation job could not start.", cause }),
        ),
      );
    yield* workbench.setPendingGeneration(null);
    yield* workbench.upsertJob(job);
    const terminal = yield* client.events(job.id).pipe(
      Stream.runForEach((event) => workbench.upsertJob(event.job)),
      Effect.as(workbench.getSnapshot().jobs.find((candidate) => candidate.id === job.id) ?? job),
      Effect.mapError(
        (cause) => new GenerationCommandError({ operation: "run", message: "Job progress stream failed.", cause }),
      ),
    );
    const latest = workbench.getSnapshot().jobs.find((candidate) => candidate.id === job.id) ?? terminal;
    if (latest.status === "succeeded") yield* attachGenerationOutputs(latest);
    return latest;
  });
}

export function cancelGeneration(jobId: string) {
  return Effect.gen(function* () {
    const client = yield* GenerationClient;
    const workbench = yield* WorkbenchService;
    const job = yield* client
      .cancel(jobId)
      .pipe(
        Effect.mapError(
          (cause) =>
            new GenerationCommandError({ operation: "cancel", message: "The job could not be cancelled.", cause }),
        ),
      );
    yield* workbench.upsertJob(job);
    return job;
  });
}

export const recoverGenerationJobs = Effect.gen(function* () {
  const client = yield* GenerationClient;
  const workbench = yield* WorkbenchService;
  const projectId = workbench.getSnapshot().document.project.id;
  const jobs = yield* client
    .list(projectId)
    .pipe(
      Effect.mapError(
        (cause) =>
          new GenerationCommandError({ operation: "run", message: "Saved jobs could not be recovered.", cause }),
      ),
    );
  yield* Effect.forEach(jobs, (job) => workbench.upsertJob(job), { concurrency: 8 });
  yield* Effect.forEach(
    jobs,
    (job) =>
      Effect.gen(function* () {
        let latest = job;
        if (job.status === "queued" || job.status === "running") {
          yield* client.events(job.id).pipe(
            Stream.runForEach((event) => {
              latest = event.job;
              return workbench.upsertJob(event.job);
            }),
          );
        }
        if (latest.status === "succeeded") yield* attachGenerationOutputs(latest);
      }).pipe(
        Effect.catchAll((cause) =>
          workbench
            .notice("info", "A recovered generation job could not be fully synchronized.", `job:${job.id}`)
            .pipe(Effect.zipRight(Effect.logWarning(cause))),
        ),
      ),
    { concurrency: "unbounded" },
  );
  return jobs;
});

function attachGenerationOutputs(job: GenerationJob) {
  return Effect.gen(function* () {
    const client = yield* GenerationClient;
    const workbench = yield* WorkbenchService;
    const repository = yield* MediaRepository;
    const ids = yield* IdGenerator;
    for (const [index, output] of job.outputs.entries()) {
      const currentComposition = selectedComposition(workbench.getSnapshot().document);
      if (currentComposition.imageTakes.some((take) => take.generationOutputId === output.id)) continue;
      const blob = yield* client.output(job.id, output.id).pipe(
        Effect.mapError(
          (cause) =>
            new GenerationCommandError({
              operation: "output",
              message: "Generated output could not be read.",
              cause,
            }),
        ),
      );
      const now = new Date(yield* Clock.currentTimeMillis).toISOString();
      const mediaId = yield* ids.next("media");
      const takeId = yield* ids.next("image-take");
      const media: MediaAsset = {
        id: mediaId,
        kind: "image",
        filename: output.filename,
        mime: output.contentType,
        width: output.width,
        height: output.height,
        storageRef: `media:${mediaId}`,
        alt: `Generated Image Take ${index + 1}`,
        createdAt: now,
      };
      const take: ImageTake = {
        id: takeId,
        label: `Image Take ${currentComposition.imageTakes.length + 1}`,
        kind: "generated",
        createdAt: now,
        mediaAssetId: mediaId,
        plateCommitId: job.plateCommitId,
        direction: job.direction,
        strategy: job.strategy,
        model: job.model,
        prompt: job.prompt,
        generationJobId: job.id,
        generationOutputId: output.id,
        spatialSpec: structuredClone(job.provenance.spatialSpec),
        provenance: structuredClone(job.provenance),
      };
      yield* repository.put(mediaId, { blob });
      yield* workbench.updateDocument((document) => addImageTake(document, media, take, now));
    }
  });
}

function blobToDataUrl(blob: Blob) {
  return Effect.tryPromise({
    try: () =>
      new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () =>
          typeof reader.result === "string" ? resolve(reader.result) : reject(new Error("Expected a data URL."));
        reader.onerror = () => reject(reader.error ?? new Error("Media read failed."));
        reader.readAsDataURL(blob);
      }),
    catch: (cause) =>
      new GenerationCommandError({
        operation: "prepare",
        message: "Media could not be encoded for generation.",
        cause,
      }),
  });
}
