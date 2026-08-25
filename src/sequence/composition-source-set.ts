import type {
  Composition,
  CompositionSequence,
  CompositionSourceAsset,
} from "../lib/shared/contracts/composition-sequence.js";
import type { DomeScenePlateLayer } from "../lib/shared/contracts/dome-scene.js";
import { defaultPlateSketchPlacement } from "../plates/plate-sketch-arrangement.js";
import { normalizePlatePlacement } from "../plates/plate-placement.js";

export function addCompositionSourceAsset(sequence: CompositionSequence, asset: CompositionSourceAsset): void {
  if (sequence.sourceAssets[asset.id]) throw new Error(`Composition source asset ${asset.id} already exists.`);
  sequence.sourceAssets[asset.id] = structuredClone(asset);
  sequence.sourceAssetOrder.push(asset.id);
}

export function assignCompositionSourceAsset(
  sequence: CompositionSequence,
  composition: Composition,
  assetId: string,
): boolean {
  const asset = sequence.sourceAssets[assetId];
  if (!asset) throw new Error(`Composition source asset ${assetId} does not exist.`);
  if (composition.sourceAssetIds.includes(assetId)) return false;
  composition.sourceAssetIds.push(assetId);
  composition.plateDraft.frame.plateLayers.push(
    sourceLayerForComposition(
      composition,
      asset,
      composition.sourceAssetIds.length - 1,
      composition.sourceAssetIds.length,
    ),
  );
  normalizeCompositionSourceLayerOrder(composition);
  return true;
}

export function removeCompositionSourceAsset(composition: Composition, assetId: string): boolean {
  const index = composition.sourceAssetIds.indexOf(assetId);
  if (index < 0) return false;
  composition.sourceAssetIds.splice(index, 1);
  composition.plateDraft.frame.plateLayers = composition.plateDraft.frame.plateLayers.filter(
    (layer) => layer.source.assetId !== assetId,
  );
  normalizeCompositionSourceLayerOrder(composition);
  return true;
}

export function moveCompositionSourceAsset(composition: Composition, assetId: string, direction: -1 | 1): boolean {
  const index = composition.sourceAssetIds.indexOf(assetId);
  const nextIndex = index + direction;
  if (index < 0 || nextIndex < 0 || nextIndex >= composition.sourceAssetIds.length) return false;
  [composition.sourceAssetIds[index], composition.sourceAssetIds[nextIndex]] = [
    composition.sourceAssetIds[nextIndex],
    composition.sourceAssetIds[index],
  ];
  normalizeCompositionSourceLayerOrder(composition);
  return true;
}

export function replaceCompositionSourceAssets(
  sequence: CompositionSequence,
  composition: Composition,
  assetIds: string[],
): void {
  const uniqueIds = [...new Set(assetIds)];
  for (const assetId of uniqueIds) {
    if (!sequence.sourceAssets[assetId]) throw new Error(`Composition source asset ${assetId} does not exist.`);
  }
  composition.sourceAssetIds = [];
  composition.sourceAssetIds = uniqueIds;
  composition.plateDraft.frame.plateLayers = uniqueIds.map((assetId, index) =>
    sourceLayerForComposition(composition, sequence.sourceAssets[assetId], index, uniqueIds.length),
  );
  composition.plateDraft.frame.activeLayerId = composition.plateDraft.frame.plateLayers[0]?.id || null;
}

export function compositionSourceAssets(
  sequence: CompositionSequence,
  composition: Composition | null | undefined,
): CompositionSourceAsset[] {
  if (!composition) return [];
  return composition.sourceAssetIds.flatMap((assetId) => {
    const asset = sequence.sourceAssets[assetId];
    return asset ? [asset] : [];
  });
}

function sourceLayerForComposition(
  composition: Composition,
  asset: CompositionSourceAsset,
  index: number,
  plateCount: number,
): DomeScenePlateLayer {
  const placement = normalizePlatePlacement(defaultPlateSketchPlacement(index, Math.max(1, plateCount), asset), asset);
  return {
    id: `plate-layer:${composition.id}:${asset.id}`,
    name: asset.label,
    index,
    source: {
      assetId: asset.id,
      name: asset.media.name || asset.label,
      width: asset.width,
      height: asset.height,
      aspect: asset.aspect,
      ...(!asset.media.url.startsWith("blob:") ? { url: asset.media.url } : {}),
      ...(asset.media.mime ? { mime: asset.media.mime } : {}),
    },
    placement,
    visible: true,
    locked: false,
  };
}

function normalizeCompositionSourceLayerOrder(composition: Composition): void {
  const order = new Map(composition.sourceAssetIds.map((assetId, index) => [assetId, index]));
  const assigned = composition.plateDraft.frame.plateLayers.filter((layer) => layer.source.assetId);
  const legacy = composition.plateDraft.frame.plateLayers.filter((layer) => !layer.source.assetId);
  assigned.sort(
    (left, right) =>
      (order.get(left.source.assetId || "") ?? Number.MAX_SAFE_INTEGER) -
      (order.get(right.source.assetId || "") ?? Number.MAX_SAFE_INTEGER),
  );
  composition.plateDraft.frame.plateLayers = [...assigned, ...legacy].map((layer, index) => ({ ...layer, index }));
  const activeId = composition.plateDraft.frame.activeLayerId;
  if (!activeId || !composition.plateDraft.frame.plateLayers.some((layer) => layer.id === activeId)) {
    composition.plateDraft.frame.activeLayerId = composition.plateDraft.frame.plateLayers[0]?.id || null;
  }
}
