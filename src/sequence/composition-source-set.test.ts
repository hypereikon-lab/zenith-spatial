import { describe, expect, test } from "vitest";
import type { CompositionSourceAsset } from "../lib/shared/contracts/composition-sequence.js";
import { createInitialWorkbenchState } from "../artifacts/workbench-defaults.js";
import {
  addCompositionSourceAsset,
  assignCompositionSourceAsset,
  moveCompositionSourceAsset,
  removeCompositionSourceAsset,
  replaceCompositionSourceAssets,
} from "./composition-source-set.js";

describe("Composition source sets", () => {
  test("assigns reusable assets as ordered editable Plate layers", () => {
    const sequence = createInitialWorkbenchState().project.sequence;
    const composition = sequence.compositions[0];
    const first = sourceAsset("source-a", "A.png");
    const second = sourceAsset("source-b", "B.png");
    addCompositionSourceAsset(sequence, first);
    addCompositionSourceAsset(sequence, second);

    replaceCompositionSourceAssets(sequence, composition, [first.id, second.id]);

    expect(composition.sourceAssetIds).toEqual([first.id, second.id]);
    expect(composition.plateDraft.frame.plateLayers.map((layer) => layer.source.assetId)).toEqual([
      first.id,
      second.id,
    ]);
    expect(composition.plateDraft.frame.plateLayers.every((layer) => layer.source.url?.startsWith("data:"))).toBe(true);

    expect(moveCompositionSourceAsset(composition, second.id, -1)).toBe(true);
    expect(composition.sourceAssetIds).toEqual([second.id, first.id]);
    expect(composition.plateDraft.frame.plateLayers.map((layer) => layer.source.assetId)).toEqual([
      second.id,
      first.id,
    ]);

    expect(removeCompositionSourceAsset(composition, second.id)).toBe(true);
    expect(composition.sourceAssetIds).toEqual([first.id]);
    expect(composition.plateDraft.frame.plateLayers).toHaveLength(1);
  });

  test("does not duplicate one source assignment within a Composition", () => {
    const sequence = createInitialWorkbenchState().project.sequence;
    const composition = sequence.compositions[0];
    const asset = sourceAsset("source-a", "A.png");
    addCompositionSourceAsset(sequence, asset);
    replaceCompositionSourceAssets(sequence, composition, []);

    expect(assignCompositionSourceAsset(sequence, composition, asset.id)).toBe(true);
    expect(assignCompositionSourceAsset(sequence, composition, asset.id)).toBe(false);
    expect(composition.sourceAssetIds).toEqual([asset.id]);
  });
});

function sourceAsset(id: string, label: string): CompositionSourceAsset {
  return {
    id,
    label,
    media: {
      kind: "image",
      url: `data:image/png;base64,${id}`,
      name: label,
      mime: "image/png",
      alt: label,
    },
    width: 640,
    height: 480,
    aspect: 4 / 3,
    createdAt: "2026-07-13T00:00:00.000Z",
  };
}
