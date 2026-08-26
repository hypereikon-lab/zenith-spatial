import { describe, expect, test } from "vitest";
import { sourceMapPointToDirection } from "../geometry/source-projection.js";

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
  updateProjectionGeometry,
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
    expect(document.workspace.audience).toMatchObject({
      xMeters: 0,
      zMeters: 0,
      eyeHeightMeters: 1.65,
      domeRadiusMeters: 7.5,
    });
    for (const asset of Object.values(document.project.assets)) {
      expect(asset.storageRef.startsWith("blob:")).toBe(false);
    }
    expect(validateZenithDocument(document)).toEqual(document);
  });

  test("defaults meter-aware audience workspace state when loading an earlier current document", () => {
    const document = createInitialZenithDocument({ now: NOW });
    const withoutAudience = structuredClone(document) as unknown as Record<string, unknown>;
    delete (withoutAudience.workspace as Record<string, unknown>).audience;

    expect(validateZenithDocument(withoutAudience).workspace.audience).toMatchObject({
      xMeters: 0,
      zMeters: 0,
      eyeHeightMeters: 1.65,
      domeRadiusMeters: 7.5,
    });
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

  test("compensates plate placements when guide geometry changes", () => {
    const document = createInitialZenithDocument({ now: NOW });
    const before = selectedComposition(document).plateDraft;
    const beforePlacement = structuredClone(before.frame.plateLayers[0]!.placement);

    const changed = updateProjectionGeometry(document, { guideSplit: before.guideSplit + 0.12 }, NOW);
    const after = selectedComposition(changed).plateDraft;
    const afterPlacement = after.frame.plateLayers[0]!.placement;

    expect(after.guideSplit).toBeCloseTo(before.guideSplit + 0.12, 8);
    expect(afterPlacement.radius).not.toBeCloseTo(beforePlacement.radius, 8);
  });

  test("compensates plate placements across projection carriers", () => {
    const document = createInitialZenithDocument({ now: NOW });
    const beforePlacement = structuredClone(selectedComposition(document).plateDraft.frame.plateLayers[0]!.placement);

    const changed = updateProjectionGeometry(
      document,
      {
        projectionMode: "nadir-180",
        raster: { aspectPreset: "1:1", width: 1920, height: 1920, domainFit: "full-frame" },
      },
      NOW,
    );
    const after = selectedComposition(changed).plateDraft;
    const afterPlacement = after.frame.plateLayers[0]!.placement;

    expect(after.projectionMode).toBe("nadir-180");
    expect(after.surface).toEqual({
      kind: "angular",
      anchors: { semanticElevationDegrees: -45, horizonElevationDegrees: 0 },
    });
    expect(afterPlacement.flipY).toBe(!beforePlacement.flipY);
    expect(afterPlacement.radius).not.toBeCloseTo(beforePlacement.radius, 8);
  });

  test("moves authored spatial anchors without rewriting plate coordinates", () => {
    const document = createInitialZenithDocument({ now: NOW });
    const before = selectedComposition(document).plateDraft;
    const placement = structuredClone(before.frame.plateLayers[0]!.placement);
    expect(before.surface.kind).toBe("angular");

    const changed = updateProjectionGeometry(
      document,
      {
        surface: {
          kind: "angular",
          anchors: { semanticElevationDegrees: 52, horizonElevationDegrees: 7 },
        },
      },
      NOW,
      { compensatePlacements: false },
    );
    const after = selectedComposition(changed).plateDraft;

    expect(after.surface).toEqual({
      kind: "angular",
      anchors: { semanticElevationDegrees: 52, horizonElevationDegrees: 7 },
    });
    expect(after.frame.plateLayers[0]!.placement).toEqual(placement);
  });

  test("derives a measured physical horizon from observer height and preserves explicit calibration", () => {
    const initial = createInitialZenithDocument({ now: NOW });
    const cave = updateProjectionGeometry(initial, { projectionMode: "cave-270" }, NOW);
    const caveDraft = selectedComposition(cave).plateDraft;
    expect(caveDraft.surface.kind).toBe("box-room");
    if (caveDraft.surface.kind !== "box-room") throw new Error("expected box-room surface");

    const calibrated = updateProjectionGeometry(
      cave,
      {
        surface: {
          ...caveDraft.surface,
          anchors: { horizonHeight: caveDraft.surface.eyeHeight + 0.3 },
        },
      },
      NOW,
      { compensatePlacements: false },
    );
    const before = selectedComposition(calibrated).plateDraft;
    const beforePlacement = structuredClone(before.frame.plateLayers[0]!.placement);
    const beforeDirection = sourceMapPointToDirection(
      beforePlacement,
      before.projectionMode,
      before.raster.width,
      before.raster.height,
      1,
      before.guideSplit,
      before.horizonSplit,
      before.surface,
    );
    expect(before.surface.kind).toBe("box-room");
    if (before.surface.kind !== "box-room") throw new Error("expected box-room surface");

    const changed = updateProjectionGeometry(calibrated, { surface: { ...before.surface, eyeHeight: 2.4 } }, NOW);
    const after = selectedComposition(changed).plateDraft;
    expect(after.surface.kind).toBe("box-room");
    if (after.surface.kind !== "box-room") throw new Error("expected box-room surface");
    expect(after.surface.anchors?.horizonHeight).toBeCloseTo(2.7);
    expect(after.surface.anchors!.horizonHeight - after.surface.eyeHeight).toBeCloseTo(0.3);

    const afterPlacement = after.frame.plateLayers[0]!.placement;
    const afterDirection = sourceMapPointToDirection(
      afterPlacement,
      after.projectionMode,
      after.raster.width,
      after.raster.height,
      1,
      after.guideSplit,
      after.horizonSplit,
      after.surface,
    );
    expect(beforeDirection).not.toBeNull();
    expect(afterDirection).not.toBeNull();
    for (let index = 0; index < 3; index += 1) {
      expect(afterDirection![index]).toBeCloseTo(beforeDirection![index], 6);
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
