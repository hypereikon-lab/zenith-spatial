import { blobToDataUrl } from "../artifacts/artifact-runtime-media.js";
import type { CompositionSequence, PlateCompositionSnapshot } from "../lib/shared/contracts/composition-sequence.js";
import {
  inpaintSourceReferenceDescriptors,
  type InpaintSourceReferenceDescriptor,
} from "../inpaint/inpaint-source-references.js";
import type { CompositionSourceMediaRegistry } from "../sequence/composition-source-media-handles.js";

export type InpaintSourceReferenceInput = {
  tag: string;
  imageDataUrl: string;
  filename: string;
};

/**
 * Resolves the original, unwarped image behind every committed Plate layer.
 * These are appearance references only; @plate_sketch remains the spatial input.
 */
export async function inpaintSourceReferenceInputs({
  snapshot,
  sequence,
  mediaRegistry,
}: {
  snapshot: PlateCompositionSnapshot;
  sequence: CompositionSequence;
  mediaRegistry: CompositionSourceMediaRegistry;
}): Promise<InpaintSourceReferenceInput[]> {
  const descriptors = inpaintSourceReferenceDescriptors(snapshot.frame);
  return Promise.all(
    descriptors.map(async (descriptor) => ({
      tag: descriptor.tag,
      imageDataUrl: await sourceReferenceDataUrl(descriptor, snapshot, sequence, mediaRegistry),
      filename: sourceReferenceFilename(descriptor, sequence),
    })),
  );
}

async function sourceReferenceDataUrl(
  descriptor: InpaintSourceReferenceDescriptor,
  snapshot: PlateCompositionSnapshot,
  sequence: CompositionSequence,
  mediaRegistry: CompositionSourceMediaRegistry,
): Promise<string> {
  const layer = snapshot.frame.plateLayers.find((candidate) => candidate.id === descriptor.layerId);
  if (!layer) throw new Error(`Committed Plate layer ${descriptor.layerOrdinal} is no longer available.`);

  const asset = descriptor.assetId ? sequence.sourceAssets[descriptor.assetId] : undefined;
  if (descriptor.assetId && !asset) {
    throw new Error(`Original source for Plate layer ${descriptor.layerOrdinal} is missing from this project.`);
  }
  const handle = descriptor.assetId ? mediaRegistry.get(descriptor.assetId) : undefined;
  const blob = handle?.blob || handle?.file;
  if (blob) return blobToDataUrl(blob);

  const url = asset?.media.url || layer.source.url;
  if (!url) throw new Error(`Original source for Plate layer ${descriptor.layerOrdinal} is not readable.`);
  if (url.startsWith("data:")) return url;
  if (url.startsWith("blob:")) {
    throw new Error(`Original source for Plate layer ${descriptor.layerOrdinal} is no longer readable.`);
  }

  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Could not read original source for Plate layer ${descriptor.layerOrdinal}.`);
  }
  return blobToDataUrl(await response.blob());
}

function sourceReferenceFilename(descriptor: InpaintSourceReferenceDescriptor, sequence: CompositionSequence): string {
  return (descriptor.assetId && sequence.sourceAssets[descriptor.assetId]?.media.name) || descriptor.sourceName;
}
