import { Effect, Layer } from "effect";
import { describe, expect, test } from "vitest";

import {
  addImageTake,
  addPlateCommit,
  createInitialZenithDocument,
  defaultImageSpatialSpec,
  plateDraftFingerprint,
  selectedComposition,
} from "../domain/project.js";
import type { ImageTake, MediaAsset, PlateCommit } from "../domain/schema.js";
import { readProjectArchiveBlob } from "../media/project-archive.js";
import { MediaRepository } from "./media-repository.js";
import { loadProjectArchive, saveProjectArchive } from "./project-persistence.js";
import { WorkbenchService } from "./workbench-service.js";

const NOW = "2026-08-25T12:00:00.000Z";

describe("project persistence", () => {
  test("roundtrips the current domain and restores exact runtime media bytes", async () => {
    const plateAsset = imageAsset("media-plate", "plate-commit.png");
    const takeAsset = imageAsset("media-take", "image-take.png");
    const standaloneAsset = imageAsset("media-standalone", "standalone.png");
    let document = createInitialZenithDocument({ now: NOW, projectId: "project-roundtrip" });
    const composition = selectedComposition(document);
    const draft = structuredClone(composition.plateDraft);
    const spatialSpec = defaultImageSpatialSpec(draft);
    const commit: PlateCommit = {
      id: "commit-1",
      label: "Plate Commit 01",
      createdAt: NOW,
      mediaAssetId: plateAsset.id,
      draft,
      spatialSpec: {
        ...spatialSpec,
        sourceWidth: draft.raster.width,
        sourceHeight: draft.raster.height,
      },
      provenance: {
        version: 1,
        projectId: document.project.id,
        compositionId: composition.id,
        sourceAssetIds: [...composition.sourceAssetIds],
        draftFingerprint: plateDraftFingerprint(draft),
      },
    };
    document = addPlateCommit(document, plateAsset, commit, NOW);
    const take: ImageTake = {
      id: "take-1",
      label: "Image Take 01",
      kind: "imported",
      createdAt: NOW,
      mediaAssetId: takeAsset.id,
      plateCommitId: commit.id,
      direction: "Preserve the spatial silhouette.",
      strategy: "strict",
      spatialSpec: commit.spatialSpec,
    };
    document = addImageTake(document, takeAsset, take, NOW);
    document = addImageTake(
      document,
      standaloneAsset,
      {
        id: "take-standalone",
        label: "Media 2",
        kind: "imported",
        createdAt: NOW,
        mediaAssetId: standaloneAsset.id,
        plateCommitId: null,
        direction: "",
        strategy: "integrated",
        spatialSpec,
      },
      NOW,
    );

    const layer = Layer.mergeAll(
      WorkbenchService.fromDocument(document),
      MediaRepository.test({
        createObjectUrl: (_blob) => "blob:zenith-test",
        revokeObjectUrl: () => undefined,
      }),
    );

    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const media = yield* MediaRepository;
          const workbench = yield* WorkbenchService;
          yield* media.put(plateAsset.id, { blob: new Blob(["PLATE-BYTES"], { type: "image/png" }) });
          yield* media.put(takeAsset.id, { blob: new Blob(["TAKE-BYTES"], { type: "image/png" }) });
          yield* media.put(standaloneAsset.id, { blob: new Blob(["STANDALONE-BYTES"], { type: "image/png" }) });

          const archive = yield* saveProjectArchive;
          const contents = yield* Effect.promise(() => readProjectArchiveBlob(archive));
          expect(contents?.media.size).toBe(3);

          yield* workbench.replaceDocument(createInitialZenithDocument({ now: NOW, projectId: "temporary" }));
          const loaded = yield* loadProjectArchive(archive);

          expect(loaded.migrated).toBe(false);
          expect(workbench.getSnapshot().document).toEqual(document);
          expect(yield* media.ids).toEqual(expect.arrayContaining([plateAsset.id, takeAsset.id, standaloneAsset.id]));
          const restoredPlate = yield* media.readBlob(plateAsset);
          const restoredTake = yield* media.readBlob(takeAsset);
          const restoredStandalone = yield* media.readBlob(standaloneAsset);
          expect(yield* Effect.promise(() => restoredPlate.text())).toBe("PLATE-BYTES");
          expect(yield* Effect.promise(() => restoredTake.text())).toBe("TAKE-BYTES");
          expect(yield* Effect.promise(() => restoredStandalone.text())).toBe("STANDALONE-BYTES");
        }).pipe(Effect.provide(layer)),
      ),
    );
  });
});

function imageAsset(id: string, filename: string): MediaAsset {
  return {
    id,
    kind: "image",
    filename,
    mime: "image/png",
    width: 1920,
    height: 1920,
    storageRef: `media:${id}`,
    createdAt: NOW,
  };
}
