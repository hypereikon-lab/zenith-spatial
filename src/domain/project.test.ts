import { describe, expect, test } from "vitest";

import {
  addImageTake,
  addPlateCommit,
  compositionReadiness,
  createComposition,
  createInitialZenithDocument,
  deleteComposition,
  defaultImageSpatialSpec,
  plateDraftFingerprint,
  replaceSelectedCompositionDraft,
  selectedComposition,
  validateZenithDocument,
} from "./project.js";
import type { ImageTake, MediaAsset, PlateCommit } from "./schema.js";

const NOW = "2026-08-25T12:00:00.000Z";

describe("Zenith portable domain", () => {
  test("starts with one composition and three portable default sources", () => {
    const document = createInitialZenithDocument({ now: NOW });
    const composition = selectedComposition(document);

    expect(composition.sourceAssetIds).toHaveLength(3);
    expect(composition.plateDraft.frame.plateLayers).toHaveLength(3);
    expect(compositionReadiness(composition)).toMatchObject({
      canCommit: true,
      canGenerate: false,
      missingPlateCommit: true,
    });
    for (const asset of Object.values(document.project.assets)) {
      expect(asset.storageRef.startsWith("blob:")).toBe(false);
    }
    expect(validateZenithDocument(document)).toEqual(document);
  });

  test("derives dirty and stale state from real commit/take relationships", () => {
    let document = createInitialZenithDocument({ now: NOW });
    const composition = selectedComposition(document);
    const commitAsset = imageAsset("asset-commit", "plate.png", 1920, 1920);
    const commit = plateCommit(composition, commitAsset.id);
    document = addPlateCommit(document, commitAsset, commit, NOW);

    expect(compositionReadiness(selectedComposition(document))).toMatchObject({
      plateDirty: false,
      canGenerate: true,
      missingImageTake: true,
    });

    const changedDraft = structuredClone(selectedComposition(document).plateDraft);
    changedDraft.frame.plateLayers[0]!.placement.azimuth += 1;
    document = replaceSelectedCompositionDraft(document, changedDraft, NOW);
    expect(compositionReadiness(selectedComposition(document))).toMatchObject({
      plateDirty: true,
      canGenerate: false,
    });

    const takeAsset = imageAsset("asset-take", "take.png", 1920, 1920);
    const take: ImageTake = {
      id: "take-1",
      label: "Image Take 01",
      kind: "imported",
      createdAt: NOW,
      mediaAssetId: takeAsset.id,
      plateCommitId: commit.id,
      direction: "",
      strategy: "integrated",
      spatialSpec: commit.spatialSpec,
    };
    document = addImageTake(document, takeAsset, take, NOW);
    expect(compositionReadiness(selectedComposition(document))).toMatchObject({
      missingImageTake: false,
      imageTakeStale: false,
      canReview: true,
    });
  });

  test("duplicates, creates blank compositions and keeps at least one", () => {
    let document = createInitialZenithDocument({ now: NOW });
    const source = selectedComposition(document);
    const commitAsset = imageAsset("asset-copy-commit", "copy-plate.png", 1920, 1920);
    document = addPlateCommit(document, commitAsset, plateCommit(source, commitAsset.id), NOW);
    document = createComposition(document, { id: "composition-copy", now: NOW, duplicateSelected: true });
    expect(document.project.compositions).toHaveLength(2);
    expect(selectedComposition(document).sourceAssetIds).toHaveLength(3);
    expect(selectedComposition(document).plateCommits).toEqual([]);
    expect(selectedComposition(document).selectedPlateCommitId).toBeNull();
    expect(compositionReadiness(selectedComposition(document)).missingPlateCommit).toBe(true);

    document = createComposition(document, { id: "composition-blank", now: NOW, duplicateSelected: false });
    expect(document.project.compositions).toHaveLength(3);
    expect(selectedComposition(document).sourceAssetIds).toHaveLength(0);

    document = deleteComposition(document, "composition-blank");
    document = deleteComposition(document, "composition-copy");
    const unchanged = deleteComposition(document, "composition-1");
    expect(unchanged.project.compositions).toHaveLength(1);
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

function plateCommit(composition: ReturnType<typeof selectedComposition>, mediaAssetId: string): PlateCommit {
  const draft = structuredClone(composition.plateDraft);
  const spatialSpec = defaultImageSpatialSpec(draft);
  return {
    id: "commit-1",
    label: "Plate Commit 01",
    createdAt: NOW,
    mediaAssetId,
    draft,
    spatialSpec: {
      ...spatialSpec,
      sourceWidth: draft.raster.width,
      sourceHeight: draft.raster.height,
    },
    provenance: {
      version: 1,
      projectId: "project-local",
      compositionId: composition.id,
      sourceAssetIds: [...composition.sourceAssetIds],
      draftFingerprint: plateDraftFingerprint(draft),
    },
  };
}
