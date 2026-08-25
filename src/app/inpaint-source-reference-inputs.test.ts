import { describe, expect, test } from "vitest";
import { createCompositionSourceMediaRegistry } from "../sequence/composition-source-media-handles.js";
import { cloneDefaultDomeScene } from "../lib/shared/contracts/dome-scene.js";
import { createInitialCompositionSequence } from "../sequence/composition-sequence.js";
import { inpaintSourceReferenceInputs } from "./inpaint-source-reference-inputs.js";

describe("inpaint source reference inputs", () => {
  test("resolves visible original sources in committed Plate layer order", async () => {
    const scene = cloneDefaultDomeScene();
    scene.frame0.plateLayers = [
      plateLayer("layer-b", "asset-b", "macro-b.webp", 1),
      plateLayer("layer-a", "asset-a", "macro-a.webp", 0),
      { ...plateLayer("layer-hidden", "asset-hidden", "hidden.webp", 2), visible: false },
    ];
    const sequence = createInitialCompositionSequence({
      plateSketch: { kind: "image", url: "data:image/png;base64,AA==", name: "plate-sketch.png" },
      scene,
    });
    sequence.sourceAssetOrder.push("asset-a", "asset-b", "asset-hidden");
    sequence.sourceAssets["asset-a"] = sourceAsset("asset-a", "macro-a.webp", "data:image/webp;base64,YQ==");
    sequence.sourceAssets["asset-b"] = sourceAsset("asset-b", "macro-b.webp", "blob:runtime-b");
    sequence.sourceAssets["asset-hidden"] = sourceAsset("asset-hidden", "hidden.webp", "data:image/webp;base64,Yw==");
    const mediaRegistry = createCompositionSourceMediaRegistry();
    mediaRegistry.set("asset-b", {
      blob: new Blob(["b"], { type: "image/webp" }),
      file: null,
      objectUrl: "blob:runtime-b",
    });

    const inputs = await inpaintSourceReferenceInputs({
      snapshot: sequence.compositions[0].plateDraft,
      sequence,
      mediaRegistry,
    });

    expect(inputs).toEqual([
      {
        tag: "source_1",
        imageDataUrl: "data:image/webp;base64,YQ==",
        filename: "macro-a.webp",
      },
      {
        tag: "source_2",
        imageDataUrl: "data:image/webp;base64,Yg==",
        filename: "macro-b.webp",
      },
    ]);
  });

  test("fails before paid submission when a committed original source is unavailable", async () => {
    const scene = cloneDefaultDomeScene();
    scene.frame0.plateLayers = [plateLayer("layer-a", "asset-a", "macro-a.webp", 0)];
    const sequence = createInitialCompositionSequence({
      plateSketch: { kind: "image", url: "data:image/png;base64,AA==", name: "plate-sketch.png" },
      scene,
    });
    sequence.sourceAssetOrder.push("asset-a");
    sequence.sourceAssets["asset-a"] = sourceAsset("asset-a", "macro-a.webp", "blob:expired");

    await expect(
      inpaintSourceReferenceInputs({
        snapshot: sequence.compositions[0].plateDraft,
        sequence,
        mediaRegistry: createCompositionSourceMediaRegistry(),
      }),
    ).rejects.toThrow("Original source for Plate layer 1 is no longer readable.");
  });
});

function plateLayer(id: string, assetId: string, name: string, index: number) {
  return {
    id,
    name,
    index,
    source: { assetId, name, width: 700, height: 700, aspect: 1, mime: "image/webp" },
    placement: {
      azimuth: index * 90,
      radius: 0.5,
      scale: 0.8,
      spin: 0,
      opacity: 1,
      flipX: false,
      flipY: false,
      cornerOffsets: {
        nw: { x: 0, y: 0 },
        ne: { x: 0, y: 0 },
        se: { x: 0, y: 0 },
        sw: { x: 0, y: 0 },
      },
    },
    visible: true,
    locked: false,
  };
}

function sourceAsset(id: string, name: string, url: string) {
  return {
    id,
    label: name,
    media: { kind: "image" as const, url, name, mime: "image/webp", alt: name },
    width: 700,
    height: 700,
    aspect: 1,
    createdAt: "2026-07-22T00:00:00.000Z",
  };
}
