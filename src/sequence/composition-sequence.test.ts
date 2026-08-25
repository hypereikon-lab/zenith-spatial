import { describe, expect, test } from "vitest";
import { parseCompositionSequence } from "../lib/shared/contracts/composition-sequence.js";
import { createDefaultDomeScene } from "../scene/dome-scene.js";
import {
  committedPlateSketchMatchesDraft,
  createInitialCompositionSequence,
  plateCompositionsRenderEqual,
  plateCompositionSnapshot,
  plateSketchRevisionForComposition,
  presentationRevisionForComposition,
} from "./composition-sequence.js";

describe("composition image library", () => {
  test("starts with one valid Plate Sketch composition and no speculative timeline state", () => {
    const scene = createDefaultDomeScene();
    const library = createInitialCompositionSequence({
      scene,
      plateSketch: { kind: "image", url: "data:image/png;base64,AA==", name: "plate.png" },
      createdAt: "2026-07-19T00:00:00.000Z",
    });

    expect(() => parseCompositionSequence(library)).not.toThrow();
    expect(library.compositions).toHaveLength(1);
    expect(Object.keys(library)).toEqual([
      "version",
      "revisionOrder",
      "revisions",
      "sourceAssetOrder",
      "sourceAssets",
      "compositions",
    ]);
    expect(library).not.toHaveProperty("tracks");
    expect(library).not.toHaveProperty("motionSegments");

    const composition = library.compositions[0];
    expect(plateSketchRevisionForComposition(library, composition)?.kind).toBe("plate-sketch");
    expect(presentationRevisionForComposition(library, composition)?.id).toBe(composition.plateSketchRevisionId);
  });

  test("snapshots reactive scene proxies without structuredClone failures", () => {
    const scene = createDefaultDomeScene();
    const reactiveLikeScene = {
      ...scene,
      surface: new Proxy(scene.surface, {}),
      raster: new Proxy(scene.raster, {}),
      frame0: new Proxy(scene.frame0, {}),
    };

    expect(() => structuredClone(reactiveLikeScene.surface)).toThrow();
    expect(plateCompositionSnapshot(reactiveLikeScene)).toEqual({
      projectionMode: scene.projectionMode,
      surface: scene.surface,
      raster: scene.raster,
      guideSplit: scene.guideSplit,
      horizonSplit: scene.horizonSplit,
      frame: scene.frame0,
    });
  });

  test("keeps a recommitted Plate Sketch current while its previous finished image is stale", () => {
    const library = createInitialCompositionSequence({
      scene: createDefaultDomeScene(),
      plateSketch: { kind: "image", url: "data:image/png;base64,AA==" },
    });
    const composition = library.compositions[0];
    composition.imageRevisionId = "revision-previous-image";
    composition.status = "stale";

    expect(committedPlateSketchMatchesDraft(library, composition)).toBe(true);
  });

  test("detects a draft change after the committed Plate Sketch", () => {
    const library = createInitialCompositionSequence({
      scene: createDefaultDomeScene(),
      plateSketch: { kind: "image", url: "data:image/png;base64,AA==" },
    });
    const composition = library.compositions[0];
    composition.plateDraft.guideSplit += 0.05;

    expect(committedPlateSketchMatchesDraft(library, composition)).toBe(false);
  });

  test("ignores portable source transport and editor selection when comparing rendered Plate Sketches", () => {
    const scene = createDefaultDomeScene();
    scene.frame0 = {
      plateFit: "contain",
      plateFeather: 0.02,
      activeLayerId: "plate-a",
      plateLayers: [
        {
          id: "plate-a",
          name: "Imported plate.jpg",
          index: 0,
          source: {
            assetId: "asset-a",
            name: "Imported plate.jpg",
            width: 1080,
            height: 720,
            aspect: 1.5,
            mime: "image/jpeg",
          },
          placement: {
            azimuth: 45,
            radius: 0.5,
            scale: 1,
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
        },
      ],
    };
    const draft = plateCompositionSnapshot(scene);
    const portable = structuredClone(draft);
    portable.frame.activeLayerId = null;
    portable.frame.plateLayers[0].locked = true;
    portable.frame.plateLayers[0].source.mime = "image/png";
    portable.frame.plateLayers[0].source.url = "data:image/png;base64,portable-copy";

    expect(plateCompositionsRenderEqual(portable, draft)).toBe(true);

    portable.frame.plateLayers[0].placement.radius = 0.6;
    expect(plateCompositionsRenderEqual(portable, draft)).toBe(false);
  });
});
