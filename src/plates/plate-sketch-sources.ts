import type { PlateRenderOptions } from "./plate-gpu-compositor.js";

export type PlateSketchImage = PlateRenderOptions["plates"][number] & {
  assetId?: string;
  layerId?: string;
  name: string;
  aspect: number;
  canvas: HTMLCanvasElement;
  sourceWidth?: number;
  sourceHeight?: number;
  sourceCrop?: PlateSketchSourceCrop;
  sourceUrl?: string;
  mime?: string;
};

export const PLATE_SKETCH_SOURCE_CROP_MODES = ["none", "center-square"] as const;
export type PlateSketchSourceCropMode = (typeof PLATE_SKETCH_SOURCE_CROP_MODES)[number];

export type PlateSketchSourceCrop = {
  readonly mode: PlateSketchSourceCropMode;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
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

export async function loadPlateSketchSource(
  name: string,
  blob: Blob,
  { crop = "none" }: { crop?: PlateSketchSourceCropMode } = {},
): Promise<PlateSketchImage> {
  const bitmap = await createImageBitmap(blob, { imageOrientation: "from-image" });
  const sourceWidth = bitmap.width;
  const sourceHeight = bitmap.height;
  const sourceCrop = resolveSourceCrop(sourceWidth, sourceHeight, crop);
  const maxSide = 1600;
  const scale = Math.min(1, maxSide / Math.max(sourceCrop.width, sourceCrop.height));
  const width = Math.max(1, Math.round(sourceCrop.width * scale));
  const height = Math.max(1, Math.round(sourceCrop.height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  canvas
    .getContext("2d")
    ?.drawImage(bitmap, sourceCrop.x, sourceCrop.y, sourceCrop.width, sourceCrop.height, 0, 0, width, height);
  bitmap.close();
  return { name, width, height, aspect: width / height, canvas, sourceWidth, sourceHeight, sourceCrop };
}

function resolveSourceCrop(
  sourceWidth: number,
  sourceHeight: number,
  mode: PlateSketchSourceCropMode,
): PlateSketchSourceCrop {
  if (mode === "none") {
    return { mode, x: 0, y: 0, width: sourceWidth, height: sourceHeight };
  }
  const size = Math.min(sourceWidth, sourceHeight);
  return {
    mode,
    x: Math.floor((sourceWidth - size) / 2),
    y: Math.floor((sourceHeight - size) / 2),
    width: size,
    height: size,
  };
}

const defaultFetchSource: typeof fetch = (...args) => {
  if (typeof globalThis.fetch !== "function") {
    return Promise.reject(new Error("Fetch is not available for Plate Sketch references."));
  }
  return globalThis.fetch(...args);
};
