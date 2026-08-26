import { describe, expect, test } from "vitest";
import {
  carrierRasterForAspect,
  defaultProjectionSurface,
  projectionSurfaceHorizonCalibrationOffset,
  withProjectionSurfaceHorizonCalibration,
} from "../lib/shared/contracts/projection-authoring.js";
import { createInitialZenithDocument, defaultImageSpatialSpec, selectedComposition } from "../domain/project.js";
import type { ImageGenerationProvenance } from "../domain/schema.js";
import {
  embedZenithPlatePngMetadata,
  embedZenithPngProvenance,
  readZenithPlatePngMetadata,
  readZenithPngProvenance,
  readZenithProvenanceFromPngDataUrl,
  type ZenithPlatePngMetadata,
} from "./png-zenith-provenance.js";

const ONE_PIXEL_PNG =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";

describe("Zenith PNG spatial provenance", () => {
  test("losslessly inserts and reads the versioned spatial contract", () => {
    const bytes = dataUrlBytes(ONE_PIXEL_PNG);
    const embedded = embedZenithPngProvenance(bytes, provenance("cylinder-nadir"));

    expect(embedded.length).toBeGreaterThan(bytes.length);
    expect(readZenithPngProvenance(embedded)).toEqual(provenance("cylinder-nadir"));
    expect(Array.from(embedded.subarray(0, 8))).toEqual(Array.from(bytes.subarray(0, 8)));
  });

  test("replaces its own metadata chunk instead of accumulating stale projection state", () => {
    const first = embedZenithPngProvenance(dataUrlBytes(ONE_PIXEL_PNG), provenance("cylinder-nadir"));
    const second = embedZenithPngProvenance(first, provenance("cave-270"));

    expect(readZenithPngProvenance(second)).toEqual(provenance("cave-270"));
    expect(second.length).toBeLessThan(first.length + 200);
  });

  test("round-trips a data URL without re-encoding its pixels", () => {
    const embedded = embedZenithPngProvenance(dataUrlBytes(ONE_PIXEL_PNG), provenance("cave-270"));
    const dataUrl = `data:image/png;base64,${Buffer.from(embedded).toString("base64")}`;

    expect(readZenithProvenanceFromPngDataUrl(dataUrl)).toEqual(provenance("cave-270"));
  });

  test("embeds a portable Plate Draft contract alongside generated-image provenance", () => {
    const original = dataUrlBytes(ONE_PIXEL_PNG);
    const plate = plateMetadata("cave-270");
    const withPlate = embedZenithPlatePngMetadata(original, plate);
    const withBoth = embedZenithPngProvenance(withPlate, provenance("cave-270"));

    expect(readZenithPlatePngMetadata(withBoth)).toEqual(plate);
    expect(readZenithPngProvenance(withBoth)).toEqual(provenance("cave-270"));
  });

  test("replaces stale Plate metadata without accumulating chunks", () => {
    const first = embedZenithPlatePngMetadata(dataUrlBytes(ONE_PIXEL_PNG), plateMetadata("cave-270"));
    const nextMetadata = plateMetadata("cylinder-nadir");
    const second = embedZenithPlatePngMetadata(first, nextMetadata);

    expect(readZenithPlatePngMetadata(second)).toEqual(nextMetadata);
    expect(second.length).toBeLessThan(first.length + JSON.stringify(nextMetadata).length + 200);
  });

  test("keeps legacy resolved horizon anchors as portable calibration metadata", () => {
    const metadata = plateMetadata("cave-270");
    const calibratedSurface = withProjectionSurfaceHorizonCalibration(metadata.draft.surface, 0.27);
    metadata.draft.surface = calibratedSurface;
    metadata.spatialSpec.surface = structuredClone(calibratedSurface);

    const embedded = embedZenithPlatePngMetadata(dataUrlBytes(ONE_PIXEL_PNG), metadata);
    const restored = readZenithPlatePngMetadata(embedded)!;

    expect(restored).toEqual(metadata);
    expect(projectionSurfaceHorizonCalibrationOffset(restored.draft.surface)).toBeCloseTo(0.27);
  });

  test("rejects bytes that only claim to be PNG", () => {
    expect(() => embedZenithPngProvenance(new Uint8Array([1, 2, 3]), provenance("cave-270"))).toThrow(/PNG signature/);
  });
});

function provenance(projectionMode: "cylinder-nadir" | "cave-270"): ImageGenerationProvenance {
  const document = createInitialZenithDocument();
  const draft = structuredClone(selectedComposition(document).plateDraft);
  draft.projectionMode = projectionMode;
  draft.surface = defaultProjectionSurface(projectionMode);
  const carrierRaster = carrierRasterForAspect("16:9");
  draft.raster = carrierRaster;
  return {
    version: 2,
    projectId: "project-1",
    compositionId: "composition-1",
    plateCommitId: "plate-commit-1",
    inputDigest: "a".repeat(64),
    model: "gpt_image_2",
    carrierRaster,
    spatialSpec: defaultImageSpatialSpec(draft),
  };
}

function plateMetadata(projectionMode: "cylinder-nadir" | "cave-270"): ZenithPlatePngMetadata {
  const document = createInitialZenithDocument();
  const composition = selectedComposition(document);
  const draft = structuredClone(composition.plateDraft);
  draft.projectionMode = projectionMode;
  draft.surface = defaultProjectionSurface(projectionMode);
  draft.raster = carrierRasterForAspect("16:9");
  return {
    version: 1,
    kind: "plate-draft",
    projectId: document.project.id,
    compositionId: composition.id,
    plateCommitId: null,
    createdAt: "2026-08-26T12:00:00.000Z",
    draft,
    spatialSpec: {
      ...defaultImageSpatialSpec(draft),
      sourceWidth: draft.raster.width,
      sourceHeight: draft.raster.height,
    },
    provenance: null,
  };
}

function dataUrlBytes(dataUrl: string): Uint8Array {
  const binary = atob(dataUrl.split(",")[1]);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}
