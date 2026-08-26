import { Effect, Layer } from "effect";
import { describe, expect, test, vi } from "vitest";

import {
  addPlateCommit,
  createInitialZenithDocument,
  defaultImageSpatialSpec,
  plateDraftFingerprint,
  selectedComposition,
} from "../domain/project.js";
import type { MediaAsset, PlateCommit } from "../domain/schema.js";
import { importReviewMedia, openDefaultReviewMedia } from "./browser-workbench-commands.js";
import { IdGenerator } from "./id-service.js";
import { MediaRepository } from "./media-repository.js";
import { WorkbenchService } from "./workbench-service.js";

const NOW = "2026-08-26T12:00:00.000Z";

describe("browser workbench media commands", () => {
  test("opens the bundled demo without requiring a file or duplicating it", async () => {
    const document = createInitialZenithDocument({ now: NOW, projectId: "project-demo-command" });
    const layer = WorkbenchService.fromDocument(document);

    await Effect.runPromise(
      Effect.gen(function* () {
        const first = yield* openDefaultReviewMedia;
        const second = yield* openDefaultReviewMedia;
        const workbench = yield* WorkbenchService;
        const changed = selectedComposition(workbench.getSnapshot().document);

        expect(first.id).toBe(second.id);
        expect(changed.imageTakes).toHaveLength(1);
        expect(changed.selectedImageTakeId).toBe(first.id);
        expect(workbench.getSnapshot().document.workspace.room).toBe("review");
      }).pipe(Effect.provide(layer)),
    );
  });

  test("adds review media without attaching it to the selected Plate Commit", async () => {
    vi.stubGlobal(
      "createImageBitmap",
      vi.fn(async () => ({ width: 1600, height: 900, close: vi.fn() }) as unknown as ImageBitmap),
    );

    let document = createInitialZenithDocument({ now: NOW, projectId: "project-media" });
    const composition = selectedComposition(document);
    const commitAsset = imageAsset("media-commit", "plate.png", 1920, 1920);
    const commit = plateCommit(composition, commitAsset);
    document = addPlateCommit(document, commitAsset, commit, NOW);
    const file = new Blob(["DIRECT-MEDIA"], { type: "image/png" }) as File;
    Object.defineProperty(file, "name", { value: "panorama.png" });

    const layer = Layer.mergeAll(
      WorkbenchService.fromDocument(document),
      MediaRepository.test({
        createObjectUrl: () => "blob:standalone-media",
        revokeObjectUrl: () => undefined,
      }),
      IdGenerator.deterministic(["media-direct", "take-direct"]),
    );

    try {
      await Effect.runPromise(
        Effect.scoped(
          Effect.gen(function* () {
            const imported = yield* importReviewMedia(file);
            const workbench = yield* WorkbenchService;
            const media = yield* MediaRepository;
            const changed = workbench.getSnapshot().document;

            expect(imported).toMatchObject({
              id: "take-direct",
              label: "Media 1",
              kind: "imported",
              mediaAssetId: "media-direct",
              plateCommitId: null,
              direction: "",
            });
            expect(imported.spatialSpec).toMatchObject({ sourceWidth: 1600, sourceHeight: 900 });
            expect(selectedComposition(changed).selectedPlateCommitId).toBe(commit.id);
            expect(selectedComposition(changed).plateCommits).toHaveLength(1);
            expect(selectedComposition(changed).plateDraft).toEqual(composition.plateDraft);
            expect(changed.workspace.room).toBe("review");
            expect(yield* media.ids).toContain("media-direct");
          }).pipe(Effect.provide(layer)),
        ),
      );
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

function imageAsset(id: string, filename: string, width: number, height: number): MediaAsset {
  return {
    id,
    kind: "image",
    filename,
    mime: "image/png",
    width,
    height,
    storageRef: `media:${id}`,
    createdAt: NOW,
  };
}

function plateCommit(composition: ReturnType<typeof selectedComposition>, media: MediaAsset): PlateCommit {
  const draft = structuredClone(composition.plateDraft);
  return {
    id: "commit-1",
    label: "Plate Commit 1",
    createdAt: NOW,
    mediaAssetId: media.id,
    draft,
    spatialSpec: {
      ...defaultImageSpatialSpec(draft),
      sourceWidth: media.width,
      sourceHeight: media.height,
    },
    provenance: {
      version: 1,
      projectId: "project-media",
      compositionId: composition.id,
      sourceAssetIds: [...composition.sourceAssetIds],
      draftFingerprint: plateDraftFingerprint(draft),
    },
  };
}
