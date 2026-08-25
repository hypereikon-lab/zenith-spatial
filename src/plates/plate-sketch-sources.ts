import type { PlateRenderOptions } from "./plate-gpu-compositor.js";

export type PlateSketchImage = PlateRenderOptions["plates"][number] & {
  assetId?: string;
  layerId?: string;
  name: string;
  aspect: number;
  canvas: HTMLCanvasElement;
  sourceUrl?: string;
  mime?: string;
};

export type PlateSketchReference = {
  name: string;
  url: string;
};

export async function loadPlateSketchFiles(files: File[]): Promise<PlateSketchImage[]> {
  const imageFiles = files.filter((file) => file.type.startsWith("image/"));
  return Promise.all(imageFiles.map((file) => loadPlateSketchSource(file.name, file)));
}

export async function loadDefaultPlateSketchSources(
  references: PlateSketchReference[],
  fetchSource: typeof fetch = defaultFetchSource,
): Promise<PlateSketchImage[]> {
  const loaded: PlateSketchImage[] = [];
  for (const reference of references) {
    const response = await fetchSource(reference.url);
    if (!response.ok) continue;
    loaded.push({
      ...(await loadPlateSketchSource(reference.name, await response.blob())),
      sourceUrl: reference.url,
    });
  }
  return loaded;
}

export async function loadPlateSketchSource(name: string, blob: Blob): Promise<PlateSketchImage> {
  const bitmap = await createImageBitmap(blob, { imageOrientation: "from-image" });
  const maxSide = 1600;
  const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  canvas.getContext("2d")?.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();
  return { name, width, height, aspect: width / height, canvas };
}

const defaultFetchSource: typeof fetch = (...args) => {
  if (typeof globalThis.fetch !== "function") {
    return Promise.reject(new Error("Fetch is not available for Plate Sketch references."));
  }
  return globalThis.fetch(...args);
};
