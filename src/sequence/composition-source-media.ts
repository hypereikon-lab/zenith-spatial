import { blobToDataUrl, type PortableMediaStore } from "../artifacts/artifact-runtime-media.js";
import {
  CompositionSequenceSchema,
  type CompositionSequence,
  type CompositionSourceAsset,
} from "../lib/shared/contracts/composition-sequence.js";
import type {
  CompositionSourceMediaHandle,
  CompositionSourceMediaRegistry,
} from "./composition-source-media-handles.js";

export function compositionSourceMediaFromFile(file: File): {
  media: CompositionSourceAsset["media"];
  handle: CompositionSourceMediaHandle;
} {
  if (!file.type.startsWith("image/")) throw new Error(`${file.name} is not an image source.`);
  const objectUrl = URL.createObjectURL(file);
  return {
    media: {
      kind: "image",
      url: objectUrl,
      name: file.name,
      mime: file.type || undefined,
      alt: file.name,
    },
    handle: { blob: file, file, objectUrl },
  };
}

export async function serializableCompositionSequence(
  sequence: CompositionSequence,
  mediaRegistry: CompositionSourceMediaRegistry,
  { storeBlob }: { storeBlob?: PortableMediaStore } = {},
): Promise<CompositionSequence> {
  const next = jsonClone(sequence);
  const portableUrlByAssetId = new Map<string, string>();
  for (const asset of Object.values(next.sourceAssets)) {
    const media = asset.media;
    if (media.url.startsWith("blob:")) {
      const handle = mediaRegistry.get(asset.id);
      const blob = handle?.blob || handle?.file;
      if (!blob) throw new Error(`${asset.label} uses runtime source media that is no longer readable.`);
      media.url = storeBlob ? storeBlob(blob, blob.type) : await blobToDataUrl(blob);
      media.mime = blob.type || media.mime;
    }
    portableUrlByAssetId.set(asset.id, media.url);
  }

  for (const composition of next.compositions) {
    await portablePlateLayerSources(
      composition.plateDraft.frame.plateLayers,
      portableUrlByAssetId,
      next.sourceAssets,
      storeBlob,
      composition.label,
    );
  }
  for (const revision of Object.values(next.revisions)) {
    if (!revision.plateComposition) continue;
    await portablePlateLayerSources(
      revision.plateComposition.frame.plateLayers,
      portableUrlByAssetId,
      next.sourceAssets,
      storeBlob,
      revision.label,
    );
  }

  return CompositionSequenceSchema.parse(next);
}

async function portablePlateLayerSources(
  layers: CompositionSequence["compositions"][number]["plateDraft"]["frame"]["plateLayers"],
  portableUrlByAssetId: ReadonlyMap<string, string>,
  sourceAssets: CompositionSequence["sourceAssets"],
  storeBlob: PortableMediaStore | undefined,
  ownerLabel: string,
): Promise<void> {
  for (const layer of layers) {
    const assetId = layer.source.assetId;
    if (assetId) {
      const portableUrl = portableUrlByAssetId.get(assetId);
      if (!portableUrl) throw new Error(`${ownerLabel} references missing source asset ${assetId}.`);
      layer.source.url = portableUrl;
      layer.source.mime = sourceAssets[assetId]?.media.mime;
      continue;
    }
    if (!layer.source.url?.startsWith("blob:")) continue;
    const response = await fetch(layer.source.url);
    if (!response.ok) throw new Error(`${ownerLabel} contains Plate source media that is no longer readable.`);
    const blob = await response.blob();
    layer.source.url = storeBlob ? storeBlob(blob, blob.type) : await blobToDataUrl(blob);
    layer.source.mime = blob.type || layer.source.mime;
  }
}

function jsonClone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}
