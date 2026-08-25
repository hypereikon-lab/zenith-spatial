import type { DomeSceneFrame0, DomeScenePlateLayer } from "../lib/shared/contracts/dome-scene.js";

export const MAX_INPAINT_SOURCE_REFERENCES = 15;

export type InpaintSourceReferenceDescriptor = {
  tag: string;
  referenceOrdinal: number;
  layerOrdinal: number;
  layerId: string;
  assetId?: string;
  sourceName: string;
  width: number;
  height: number;
};

/**
 * Gives every visible authored layer a stable image-model reference tag.
 * Image 1 is reserved for @plate_sketch, so source references begin at Image 2.
 */
export function inpaintSourceReferenceDescriptors(
  frame: DomeSceneFrame0 | undefined,
  limit = MAX_INPAINT_SOURCE_REFERENCES,
): InpaintSourceReferenceDescriptor[] {
  const layers = visibleAuthoredLayers(frame);
  return layers.slice(0, Math.max(0, limit)).map((layer, referenceIndex) => ({
    tag: `source_${referenceIndex + 1}`,
    referenceOrdinal: referenceIndex + 2,
    layerOrdinal: layers.indexOf(layer) + 1,
    layerId: layer.id,
    ...(layer.source.assetId ? { assetId: layer.source.assetId } : {}),
    sourceName: layer.source.name,
    width: layer.source.width,
    height: layer.source.height,
  }));
}

function visibleAuthoredLayers(frame: DomeSceneFrame0 | undefined): DomeScenePlateLayer[] {
  return (frame?.plateLayers || [])
    .filter(
      (layer) =>
        layer.visible !== false && layer.placement.opacity > 0 && Boolean(layer.source.assetId || layer.source.url),
    )
    .sort((left, right) => left.index - right.index);
}
