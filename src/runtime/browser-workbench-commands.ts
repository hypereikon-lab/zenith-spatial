import { Clock, Data, Effect } from "effect";

import {
  addDefaultReviewMedia,
  addImageTake,
  addPlateCommit,
  addSourceAssets,
  defaultImageSpatialSpec,
  plateDraftFingerprint,
  removeSourceAsset,
  replaceSelectedCompositionDraft,
  setProjection,
  selectedComposition,
  selectedImageTake,
  updateProjectionGeometry,
  type ProjectionGeometryPatch,
  type ProjectionGeometryUpdateOptions,
} from "../domain/project.js";
import type { ImageTake, MediaAsset, PlateCommit, PlateDraft } from "../domain/schema.js";
import { canvasToBlob } from "../media/canvas-utils.js";
import { isMp4File } from "../media/browser-image-files.js";
import {
  embedZenithPlateMetadataInPngBlob,
  readZenithPlateMetadataFromPngBlob,
  readZenithProvenanceFromPngBlob,
} from "../media/png-zenith-provenance.js";
import { readSpatialUpscalePngMetadata } from "../media/spatial-upscale-metadata.js";
import { readVideoDimensions } from "../media/video-source.js";
import { defaultPlateSketchPlacement } from "../plates/plate-sketch-arrangement.js";
import { DEFAULT_PLATE_REFERENCES } from "../plates/default-plate-profile.js";
import type { PlateSketchPreviewInput, PlateSketchPreviewSession } from "../plates/plate-sketch-preview-session.js";
import { loadPlateSketchSource, type PlateSketchImage } from "../plates/plate-sketch-sources.js";
import { normalizePlatePlacement } from "../plates/plate-placement.js";
import type { DomeScenePlateLayer } from "../lib/shared/contracts/dome-scene.js";
import { carrierRasterForProjection } from "../lib/shared/contracts/projection-authoring.js";
import type { SourceProjectionMode } from "../geometry/source-projection.js";
import { IdGenerator } from "./id-service.js";
import { MediaRepository } from "./media-repository.js";
import { WorkbenchService } from "./workbench-service.js";

export class BrowserWorkbenchError extends Data.TaggedError("BrowserWorkbenchError")<{
  readonly operation: "load" | "import" | "commit" | "take" | "state";
  readonly message: string;
  readonly cause?: unknown;
}> {}

export type LoadedCompositionPlate = PlateSketchImage & {
  readonly assetId: string;
  readonly layerId: string;
};

export const loadSelectedCompositionPlates = Effect.gen(function* () {
  const workbench = yield* WorkbenchService;
  const document = workbench.getSnapshot().document;
  const composition = selectedComposition(document);
  const repository = yield* MediaRepository;

  return yield* Effect.forEach(
    composition.plateDraft.frame.plateLayers.filter((layer) => layer.visible),
    (layer) =>
      Effect.gen(function* () {
        const assetId = layer.source.assetId;
        const asset = assetId ? document.project.assets[assetId] : undefined;
        if (!assetId || !asset) {
          return yield* Effect.fail(
            new BrowserWorkbenchError({
              operation: "load",
              message: `${layer.name} references media that is not in this project.`,
            }),
          );
        }
        const existing = yield* repository.get(asset.id);
        let plate: PlateSketchImage;
        if (existing?.canvas && existing.canvas.width > 0 && existing.canvas.height > 0) {
          plate = {
            name: layer.source.name,
            width: existing.canvas.width,
            height: existing.canvas.height,
            aspect: existing.canvas.width / existing.canvas.height,
            canvas: existing.canvas,
          };
        } else {
          const blob = yield* repository.readBlob(asset);
          plate = yield* Effect.tryPromise({
            try: () => loadPlateSketchSource(layer.source.name, blob),
            catch: (cause) =>
              new BrowserWorkbenchError({
                operation: "load",
                message: `Could not decode ${asset.filename}.`,
                cause,
              }),
          });
          yield* repository.put(asset.id, { blob, canvas: plate.canvas });
        }
        return {
          ...plate,
          assetId,
          layerId: layer.id,
          sourceUrl: asset.storageRef,
          mime: asset.mime,
        } satisfies LoadedCompositionPlate;
      }),
    { concurrency: 4 },
  );
});

export function importPlateSources(files: ReadonlyArray<File>) {
  return Effect.gen(function* () {
    const imageFiles = files.filter((file) => file.type.startsWith("image/"));
    if (imageFiles.length === 0) {
      return yield* Effect.fail(
        new BrowserWorkbenchError({ operation: "import", message: "Choose one or more image files." }),
      );
    }
    const workbench = yield* WorkbenchService;
    const repository = yield* MediaRepository;
    const ids = yield* IdGenerator;
    const now = new Date(yield* Clock.currentTimeMillis).toISOString();
    const current = selectedComposition(workbench.getSnapshot().document);
    const startIndex = current.plateDraft.frame.plateLayers.length;
    const total = startIndex + imageFiles.length;
    const imported = yield* Effect.forEach(
      imageFiles,
      (file, offset) =>
        Effect.gen(function* () {
          const assetId = yield* ids.next("media");
          const layerId = yield* ids.next("layer");
          const plate = yield* Effect.tryPromise({
            try: () => loadPlateSketchSource(file.name, file),
            catch: (cause) =>
              new BrowserWorkbenchError({
                operation: "import",
                message: `Could not decode ${file.name}.`,
                cause,
              }),
          });
          const asset: MediaAsset = {
            id: assetId,
            kind: "image",
            filename: file.name,
            mime: file.type || "image/png",
            width: plate.width,
            height: plate.height,
            storageRef: `media:${assetId}`,
            alt: file.name,
            createdAt: now,
          };
          const placement = normalizePlatePlacement(
            defaultPlateSketchPlacement(startIndex + offset, total, plate),
            plate,
          );
          const layer: DomeScenePlateLayer = {
            id: layerId,
            name: file.name,
            index: startIndex + offset,
            source: {
              assetId,
              name: file.name,
              width: plate.width,
              height: plate.height,
              aspect: plate.aspect,
              mime: asset.mime,
            },
            placement,
            visible: true,
            locked: false,
          };
          yield* repository.put(assetId, { blob: file, file, canvas: plate.canvas });
          return { asset, layer };
        }),
      { concurrency: 2 },
    );

    yield* workbench.updateDocument((document) =>
      addSourceAssets(
        document,
        imported.map(({ asset }) => asset),
        imported.map(({ layer }) => layer),
        now,
      ),
    );
    return imported.map(({ asset }) => asset);
  });
}

export const loadDefaultPlateSources = Effect.gen(function* () {
  const workbench = yield* WorkbenchService;
  const ids = yield* IdGenerator;
  const snapshot = workbench.getSnapshot().document;
  const current = selectedComposition(snapshot);
  if (current.plateDraft.frame.plateLayers.length > 0) return [];
  const now = new Date(yield* Clock.currentTimeMillis).toISOString();
  const loaded = yield* Effect.forEach(DEFAULT_PLATE_REFERENCES, (reference, index) =>
    Effect.gen(function* () {
      const existing = Object.values(snapshot.project.assets).find((asset) => asset.storageRef === reference.url);
      const assetId = existing?.id ?? (yield* ids.next("media"));
      const layerId = yield* ids.next("layer");
      const asset: MediaAsset =
        existing ??
        ({
          id: assetId,
          kind: "image",
          filename: reference.name,
          mime: "image/png",
          width: reference.width,
          height: reference.height,
          storageRef: reference.url,
          alt: reference.name,
          createdAt: now,
        } satisfies MediaAsset);
      const plate = {
        name: reference.name,
        width: reference.width,
        height: reference.height,
        aspect: reference.width / reference.height,
      };
      const layer: DomeScenePlateLayer = {
        id: layerId,
        name: reference.name,
        index,
        source: {
          assetId,
          name: reference.name,
          width: reference.width,
          height: reference.height,
          aspect: plate.aspect,
          mime: asset.mime,
        },
        placement: normalizePlatePlacement(
          defaultPlateSketchPlacement(index, DEFAULT_PLATE_REFERENCES.length, plate),
          plate,
        ),
        visible: true,
        locked: false,
      };
      return { asset, layer };
    }),
  );
  yield* workbench.updateDocument((document) =>
    addSourceAssets(
      document,
      loaded.map(({ asset }) => asset),
      loaded.map(({ layer }) => layer),
      now,
      { replace: true },
    ),
  );
  return loaded.map(({ asset }) => asset);
});

export function removePlateSource(assetId: string) {
  return Effect.gen(function* () {
    const workbench = yield* WorkbenchService;
    const repository = yield* MediaRepository;
    const now = new Date(yield* Clock.currentTimeMillis).toISOString();
    const document = yield* workbench.updateDocument((current) => removeSourceAsset(current, assetId, now));
    if (!document.project.assets[assetId]) yield* repository.remove(assetId);
  });
}

export function replacePlateDraft(draft: PlateDraft) {
  return Effect.gen(function* () {
    const workbench = yield* WorkbenchService;
    const now = new Date(yield* Clock.currentTimeMillis).toISOString();
    return yield* workbench.updateDocument((document) => replaceSelectedCompositionDraft(document, draft, now));
  });
}

export function changeProjection(projectionMode: SourceProjectionMode) {
  return Effect.gen(function* () {
    const workbench = yield* WorkbenchService;
    const now = new Date(yield* Clock.currentTimeMillis).toISOString();
    return yield* workbench.updateDocument((document) =>
      setProjection(
        document,
        projectionMode,
        carrierRasterForProjection(projectionMode, selectedComposition(document).plateDraft.raster),
        now,
      ),
    );
  });
}

export function changeProjectionGeometry(patch: ProjectionGeometryPatch, options?: ProjectionGeometryUpdateOptions) {
  return Effect.gen(function* () {
    const workbench = yield* WorkbenchService;
    const now = new Date(yield* Clock.currentTimeMillis).toISOString();
    return yield* workbench.updateDocument((document) => updateProjectionGeometry(document, patch, now, options));
  });
}

export function commitPlate(
  session: Pick<PlateSketchPreviewSession, "renderHandoffCanvas">,
  previewInput: PlateSketchPreviewInput,
) {
  return Effect.gen(function* () {
    const workbench = yield* WorkbenchService;
    const repository = yield* MediaRepository;
    const ids = yield* IdGenerator;
    const snapshot = workbench.getSnapshot();
    const composition = selectedComposition(snapshot.document);
    if (composition.sourceAssetIds.length === 0 || previewInput.plates.length === 0) {
      return yield* Effect.fail(
        new BrowserWorkbenchError({ operation: "commit", message: "Load at least one source before committing." }),
      );
    }
    const { width, height } = composition.plateDraft.raster;
    const handoff = yield* Effect.tryPromise({
      try: () => session.renderHandoffCanvas(previewInput, { width, height }),
      catch: (cause) =>
        new BrowserWorkbenchError({
          operation: "commit",
          message: "The exact Plate Sketch raster could not be rendered.",
          cause,
        }),
    });
    if (handoff.width !== width || handoff.height !== height) {
      return yield* Effect.fail(
        new BrowserWorkbenchError({
          operation: "commit",
          message: `Renderer returned ${handoff.width}×${handoff.height}; expected ${width}×${height}.`,
        }),
      );
    }
    const encodedBlob = yield* Effect.tryPromise({
      try: () => canvasToBlob(handoff, "image/png"),
      catch: (cause) =>
        new BrowserWorkbenchError({ operation: "commit", message: "Plate Sketch PNG encoding failed.", cause }),
    });
    const now = new Date(yield* Clock.currentTimeMillis).toISOString();
    const mediaId = yield* ids.next("media");
    const commitId = yield* ids.next("plate-commit");
    const draft = structuredClone(composition.plateDraft);
    const media: MediaAsset = {
      id: mediaId,
      kind: "image",
      filename: `plate-sketch-${width}x${height}.png`,
      mime: "image/png",
      width,
      height,
      storageRef: `media:${mediaId}`,
      alt: "Exact committed Plate Sketch raster",
      createdAt: now,
    };
    const commit: PlateCommit = {
      id: commitId,
      label: `Plate Commit ${composition.plateCommits.length + 1}`,
      createdAt: now,
      mediaAssetId: mediaId,
      draft,
      spatialSpec: {
        ...defaultImageSpatialSpec(draft),
        sourceWidth: width,
        sourceHeight: height,
        sourceAspectRatio: width / height,
      },
      provenance: {
        version: 1,
        projectId: snapshot.document.project.id,
        compositionId: composition.id,
        sourceAssetIds: [...composition.sourceAssetIds],
        draftFingerprint: plateDraftFingerprint(draft),
      },
    };
    const blob = yield* Effect.tryPromise({
      try: () =>
        embedZenithPlateMetadataInPngBlob(encodedBlob, {
          version: 1,
          kind: "plate-commit",
          projectId: snapshot.document.project.id,
          compositionId: composition.id,
          plateCommitId: commit.id,
          createdAt: now,
          draft: commit.draft,
          spatialSpec: commit.spatialSpec,
          provenance: commit.provenance,
        }),
      catch: (cause) =>
        new BrowserWorkbenchError({
          operation: "commit",
          message: "Plate Sketch spatial metadata could not be embedded.",
          cause,
        }),
    });
    yield* repository.put(mediaId, { blob, canvas: handoff });
    yield* workbench
      .updateDocument((document) => addPlateCommit(document, media, commit, now))
      .pipe(Effect.onError(() => repository.remove(mediaId)));
    return commit;
  });
}

export function importPlateCommit(file: File) {
  return Effect.gen(function* () {
    if (!file.type.startsWith("image/")) {
      return yield* Effect.fail(
        new BrowserWorkbenchError({ operation: "commit", message: "The Plate Sketch must be an image." }),
      );
    }
    const workbench = yield* WorkbenchService;
    const repository = yield* MediaRepository;
    const ids = yield* IdGenerator;
    const dimensions = yield* decodeImageDimensions(file, "commit");
    const embeddedMetadata = yield* Effect.tryPromise({
      try: () => readZenithPlateMetadataFromPngBlob(file),
      catch: () => null,
    });
    const now = new Date(yield* Clock.currentTimeMillis).toISOString();
    const snapshot = workbench.getSnapshot();
    const composition = selectedComposition(snapshot.document);
    const embeddedDraft = embeddedMetadata?.draft;
    const draft = structuredClone(embeddedDraft ?? composition.plateDraft);
    const expectedWidth = embeddedMetadata?.spatialSpec.targetWidth ?? draft.raster.width;
    const expectedHeight = embeddedMetadata?.spatialSpec.targetHeight ?? draft.raster.height;
    if (dimensions.width !== expectedWidth || dimensions.height !== expectedHeight) {
      return yield* Effect.fail(
        new BrowserWorkbenchError({
          operation: "commit",
          message: `Imported Plate Sketch is ${dimensions.width}×${dimensions.height}; its carrier requires exactly ${expectedWidth}×${expectedHeight} pixels.`,
        }),
      );
    }
    const mediaId = yield* ids.next("media");
    const commitId = yield* ids.next("plate-commit");
    const media: MediaAsset = {
      id: mediaId,
      kind: "image",
      filename: file.name,
      mime: file.type || "image/png",
      width: dimensions.width,
      height: dimensions.height,
      storageRef: `media:${mediaId}`,
      alt: "Imported Plate Sketch",
      createdAt: now,
    };
    const commit: PlateCommit = {
      id: commitId,
      label: `Imported Plate Commit ${composition.plateCommits.length + 1}`,
      createdAt: now,
      mediaAssetId: mediaId,
      draft,
      spatialSpec: {
        ...(embeddedMetadata?.spatialSpec ?? defaultImageSpatialSpec(draft)),
        sourceWidth: dimensions.width,
        sourceHeight: dimensions.height,
        sourceAspectRatio: dimensions.width / dimensions.height,
      },
      provenance: {
        version: 1,
        projectId: snapshot.document.project.id,
        compositionId: composition.id,
        sourceAssetIds:
          embeddedMetadata?.provenance?.sourceAssetIds ??
          draft.frame.plateLayers.flatMap((layer) => (layer.source.assetId ? [layer.source.assetId] : [])),
        draftFingerprint: embeddedMetadata?.provenance?.draftFingerprint ?? plateDraftFingerprint(draft),
      },
    };
    yield* repository.put(mediaId, { blob: file, file });
    yield* workbench
      .updateDocument((document) => addPlateCommit(document, media, commit, now))
      .pipe(Effect.onError(() => repository.remove(mediaId)));
    return commit;
  });
}

export function importImageTake(file: File) {
  return importReviewImage(file, "image-take");
}

export const openDefaultReviewMedia = Effect.gen(function* () {
  const workbench = yield* WorkbenchService;
  const now = new Date(yield* Clock.currentTimeMillis).toISOString();
  const document = yield* workbench.updateDocument((current) => addDefaultReviewMedia(current, now));
  return selectedImageTake(selectedComposition(document))!;
});

/** Adds image or MP4 media directly to Review without turning it into a Plate or pinning it to a Plate Commit. */
export function importReviewMedia(
  file: File,
  options: {
    readonly decodeVideo?: (file: Blob) => Promise<{ width: number; height: number }>;
  } = {},
) {
  return importReviewSource(file, "standalone-media", options.decodeVideo ?? readVideoDimensions);
}

function importReviewImage(file: File, importMode: "image-take") {
  return importReviewSource(file, importMode, readVideoDimensions);
}

function importReviewSource(
  file: File,
  importMode: "image-take" | "standalone-media",
  decodeVideo: (file: Blob) => Promise<{ width: number; height: number }>,
) {
  return Effect.gen(function* () {
    const mediaKind = file.type.startsWith("image/") ? "image" : isMp4File(file) ? "video" : null;
    if (!mediaKind || (mediaKind === "video" && importMode !== "standalone-media")) {
      return yield* Effect.fail(
        new BrowserWorkbenchError({
          operation: "take",
          message:
            importMode === "standalone-media"
              ? "Review media must be an image or MP4 video."
              : "The Image Take must be an image.",
        }),
      );
    }
    const storedFile =
      mediaKind === "video" && file.type !== "video/mp4"
        ? new File([file], file.name, { type: "video/mp4", lastModified: file.lastModified })
        : file;
    const workbench = yield* WorkbenchService;
    const repository = yield* MediaRepository;
    const ids = yield* IdGenerator;
    const dimensions =
      mediaKind === "image"
        ? yield* decodeImageDimensions(storedFile, "take")
        : yield* Effect.tryPromise({
            try: () => decodeVideo(storedFile),
            catch: (cause) =>
              new BrowserWorkbenchError({
                operation: "take",
                message: "The selected MP4 video could not be decoded.",
                cause,
              }),
          });
    const embeddedSpatialUpscale =
      mediaKind === "image"
        ? yield* Effect.tryPromise({
            try: () => readSpatialUpscalePngMetadata(storedFile),
            catch: (cause) => cause,
          }).pipe(Effect.catchAll(() => Effect.succeed(null)))
        : null;
    const embeddedProvenance =
      mediaKind === "image" && !embeddedSpatialUpscale
        ? yield* Effect.tryPromise({
            try: () => readZenithProvenanceFromPngBlob(storedFile),
            catch: (cause) => cause,
          }).pipe(Effect.catchAll(() => Effect.succeed(null)))
        : null;
    const now = new Date(yield* Clock.currentTimeMillis).toISOString();
    const composition = selectedComposition(workbench.getSnapshot().document);
    const matchingProvenance =
      embeddedProvenance &&
      embeddedProvenance.projectId === workbench.getSnapshot().document.project.id &&
      embeddedProvenance.compositionId === composition.id &&
      composition.plateCommits.some((commit) => commit.id === embeddedProvenance.plateCommitId)
        ? embeddedProvenance
        : undefined;
    const provenance = importMode === "image-take" ? matchingProvenance : undefined;
    const standalone = importMode === "standalone-media";
    const matchingSpatialUpscale =
      standalone &&
      embeddedSpatialUpscale &&
      embeddedSpatialUpscale.provenance.projectId === workbench.getSnapshot().document.project.id &&
      embeddedSpatialUpscale.provenance.compositionId === composition.id
        ? embeddedSpatialUpscale
        : undefined;
    const portableSpatialSpec = standalone ? embeddedSpatialUpscale?.spatialSpec : undefined;
    const mediaId = yield* ids.next("media");
    const takeId = yield* ids.next("image-take");
    const media: MediaAsset = {
      id: mediaId,
      kind: mediaKind,
      filename: storedFile.name,
      mime: storedFile.type || "image/png",
      width: dimensions.width,
      height: dimensions.height,
      storageRef: `media:${mediaId}`,
      alt: matchingSpatialUpscale
        ? "Audience in Space reconstructed master"
        : standalone
          ? mediaKind === "video"
            ? "Standalone review video"
            : "Standalone review media"
          : "Imported Image Take",
      createdAt: now,
    };
    const take: ImageTake = {
      id: takeId,
      label: matchingSpatialUpscale
        ? `Spatial Upscale ${composition.imageTakes.length + 1}`
        : standalone
          ? `Media ${composition.imageTakes.length + 1}`
          : `Imported Image Take ${composition.imageTakes.length + 1}`,
      kind: "imported",
      createdAt: now,
      mediaAssetId: mediaId,
      plateCommitId: standalone ? null : (provenance?.plateCommitId ?? composition.selectedPlateCommitId),
      direction: matchingSpatialUpscale
        ? "Audience in Space tile reconstruction"
        : standalone
          ? ""
          : composition.generationDirection,
      strategy: composition.generationStrategy,
      model: matchingProvenance?.model,
      spatialSpec: {
        ...(portableSpatialSpec ?? matchingProvenance?.spatialSpec ?? defaultImageSpatialSpec(composition.plateDraft)),
        sourceWidth: dimensions.width,
        sourceHeight: dimensions.height,
        sourceAspectRatio: dimensions.width / dimensions.height,
      },
      provenance,
      spatialUpscale: matchingSpatialUpscale?.provenance,
    };
    yield* repository.put(mediaId, { blob: storedFile, file: storedFile });
    yield* workbench
      .updateDocument((document) => addImageTake(document, media, take, now))
      .pipe(Effect.onError(() => repository.remove(mediaId)));
    return take;
  });
}

function decodeImageDimensions(file: Blob, operation: "commit" | "take") {
  return Effect.acquireUseRelease(
    Effect.tryPromise({
      try: () => createImageBitmap(file, { imageOrientation: "from-image" }),
      catch: (cause) =>
        new BrowserWorkbenchError({ operation, message: "The selected image could not be decoded.", cause }),
    }),
    (bitmap) => Effect.succeed({ width: bitmap.width, height: bitmap.height }),
    (bitmap) => Effect.sync(() => bitmap.close()),
  );
}
