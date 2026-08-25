import { describe, expect, test } from "vitest";
import { carrierRasterForAspect, defaultProjectionSurface } from "../lib/shared/contracts/projection-authoring.js";
import {
  defaultImageSpatialSpec,
  type ImageGenerationProvenanceV1,
} from "../lib/shared/contracts/composition-sequence.js";
import {
  embedZenithPngProvenance,
  embedZenithProvenanceInRevisionMedia,
  readZenithPngProvenance,
  readZenithProvenanceFromPngDataUrl,
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

  test("round-trips revision media without re-encoding its pixels", () => {
    const media = embedZenithProvenanceInRevisionMedia(
      { kind: "image", url: ONE_PIXEL_PNG, mime: "image/png", name: "generated.png" },
      provenance("cave-270"),
    );

    expect(readZenithProvenanceFromPngDataUrl(media.url)).toEqual(provenance("cave-270"));
  });

  test("rejects bytes that only claim to be PNG", () => {
    expect(() => embedZenithPngProvenance(new Uint8Array([1, 2, 3]), provenance("cave-270"))).toThrow(/PNG signature/);
  });
});

function provenance(projectionMode: "cylinder-nadir" | "cave-270"): ImageGenerationProvenanceV1 {
  const carrierRaster = carrierRasterForAspect("16:9");
  return {
    version: 1,
    compositionId: "composition-1",
    sourceRevisionId: "revision-plate-1",
    operatorId: "inpaint-plate-sketch",
    model: "gpt_image_2",
    carrierRaster,
    spatialSpec: defaultImageSpatialSpec({
      projectionMode,
      surface: defaultProjectionSurface(projectionMode),
      targetWidth: carrierRaster.width,
      targetHeight: carrierRaster.height,
    }),
  };
}

function dataUrlBytes(dataUrl: string): Uint8Array {
  const binary = atob(dataUrl.split(",")[1]);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}
