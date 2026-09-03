import { describe, expect, test } from "vitest";

import { createInitialZenithDocument, defaultImageSpatialSpec, selectedComposition } from "../domain/project.js";
import { DEFAULT_AUDIENCE_IN_SPACE, type SpatialUpscaleProvenance } from "../domain/schema.js";
import { spatialTilePlan } from "../geometry/spatial-upscale.js";
import {
  embedSpatialTileAtlasManifest,
  embedSpatialTilePngMetadata,
  embedSpatialUpscalePngMetadata,
  readSpatialTileAtlasManifest,
  readSpatialTilePngMetadata,
  readSpatialUpscalePngMetadata,
  type SpatialTileAtlasManifest,
} from "./spatial-upscale-metadata.js";

const ONE_PIXEL_PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";

describe("spatial upscale PNG metadata", () => {
  test("round-trips the capture atlas contract without touching image pixels", async () => {
    const png = new Blob([Buffer.from(ONE_PIXEL_PNG, "base64")], { type: "image/png" });
    const manifest = tileManifest();
    const embedded = await embedSpatialTileAtlasManifest(png, manifest);

    expect(embedded.size).toBeGreaterThan(png.size);
    expect(await readSpatialTileAtlasManifest(embedded)).toEqual(manifest);
  });

  test("round-trips reconstructed master provenance and exact scaled spec", async () => {
    const png = new Blob([Buffer.from(ONE_PIXEL_PNG, "base64")], { type: "image/png" });
    const manifest = tileManifest();
    const spatialSpec = {
      ...manifest.spatialSpec,
      sourceWidth: 3840,
      sourceHeight: 3840,
      targetWidth: 3840,
      targetHeight: 3840,
    };
    const provenance: SpatialUpscaleProvenance = {
      version: 1,
      projectId: manifest.projectId,
      compositionId: manifest.compositionId,
      sourceTargetKind: manifest.sourceTargetKind,
      sourceTargetId: manifest.sourceTargetId,
      sourceMediaAssetId: manifest.sourceMediaAssetId,
      capturedAt: manifest.capturedAt,
      reconstructedAt: "2026-09-03T13:00:00.000Z",
      audience: { ...DEFAULT_AUDIENCE_IN_SPACE },
      layout: "oriented-overlapping-cubemap",
      tileCount: 6,
      tileFovDegrees: 110,
      tileSize: 512,
      atlasPadding: 20,
      scale: 2,
      blend: "laplacian-pyramid",
      pyramidLevels: 5,
      exposureCompensation: true,
    };
    const embedded = await embedSpatialUpscalePngMetadata(png, {
      format: "zenith-spatial-upscale",
      version: 1,
      spatialSpec,
      provenance,
    });

    expect(await readSpatialUpscalePngMetadata(embedded)).toEqual({
      format: "zenith-spatial-upscale",
      version: 1,
      spatialSpec,
      provenance,
    });
  });

  test("pins one independently processable tile to the complete reversible manifest", async () => {
    const png = new Blob([Buffer.from(ONE_PIXEL_PNG, "base64")], { type: "image/png" });
    const manifest = tileManifest();
    const embedded = await embedSpatialTilePngMetadata(png, {
      format: "zenith-spatial-tile",
      version: 1,
      tileId: "front",
      manifest,
    });

    expect(await readSpatialTilePngMetadata(embedded)).toEqual({
      format: "zenith-spatial-tile",
      version: 1,
      tileId: "front",
      manifest,
    });
  });
});

function tileManifest(): SpatialTileAtlasManifest {
  const document = createInitialZenithDocument({ now: "2026-09-03T12:00:00.000Z", projectId: "project-tiles" });
  const composition = selectedComposition(document);
  const spatialSpec = defaultImageSpatialSpec(composition.plateDraft);
  return {
    format: "zenith-spatial-tile-atlas",
    version: 1,
    projectId: document.project.id,
    compositionId: composition.id,
    sourceTargetKind: "take",
    sourceTargetId: "take-source",
    sourceMediaAssetId: "media-source",
    sourceLabel: "Fulldome master",
    capturedAt: "2026-09-03T12:00:00.000Z",
    spatialSpec,
    audience: { ...DEFAULT_AUDIENCE_IN_SPACE },
    cameraPosition: [0, 0.22, 0],
    tileFovDegrees: 110,
    tileSize: 512,
    padding: 20,
    columns: 3,
    rows: 2,
    tiles: spatialTilePlan(DEFAULT_AUDIENCE_IN_SPACE, { spatialSpec, tileFovDegrees: 110 }),
  };
}
