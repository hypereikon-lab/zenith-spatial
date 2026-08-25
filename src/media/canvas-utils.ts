import { clamp } from "../projection.js";

type CanvasSource = HTMLCanvasElement | OffscreenCanvas;
type Rgb = [number, number, number];

export function createBlankCanvas(width: number, height: number, fill: string): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = fill;
  ctx.fillRect(0, 0, width, height);
  return canvas;
}

export function canvasBlobOrNull(canvas: HTMLCanvasElement | null | undefined): Promise<Blob> | null {
  return canvas ? canvasToBlob(canvas) : null;
}

export function canvasToBlob(canvas: HTMLCanvasElement, type = "image/png", quality?: number): Promise<Blob> {
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob) resolve(blob);
        else reject(new Error("Could not serialize canvas."));
      },
      type,
      quality,
    );
  });
}

export async function downloadCanvasPng(canvas: HTMLCanvasElement, filename: string): Promise<void> {
  const blob = await canvasToBlob(canvas, "image/png");
  downloadBlob(blob, filename);
}

export async function canvasFromBlobOrNull(blob: Blob | string | null | undefined): Promise<HTMLCanvasElement | null> {
  if (!blob) return null;
  if (typeof blob === "string") return loadCanvasFromImageSource(blob);
  const bitmap = await createImageBitmap(blob);
  return imageBitmapToCanvas(bitmap);
}

export function makeCanvasThumbnail(sourceCanvas: CanvasImageSource, size: number): string {
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d", { alpha: false });
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, size, size);
  ctx.drawImage(sourceCanvas, 0, 0, size, size);
  return canvas.toDataURL("image/jpeg", 0.72);
}

export function imageBitmapToCanvas(bitmap: ImageBitmap): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  const ctx = canvas.getContext("2d");
  ctx.drawImage(bitmap, 0, 0);
  return canvas;
}

export function cloneCanvas(source: CanvasSource): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = source.width;
  canvas.height = source.height;
  const ctx = canvas.getContext("2d");
  ctx.drawImage(source, 0, 0);
  return canvas;
}

export async function loadCanvasFromImageSource(source: string): Promise<HTMLCanvasElement> {
  if (source.startsWith("data:")) return loadCanvasFromDataUrl(source);
  const response = await fetch(source);
  if (!response.ok) throw new Error("Could not load generated image.");
  const blob = await response.blob();
  const bitmap = await createImageBitmap(blob);
  return imageBitmapToCanvas(bitmap);
}

function loadCanvasFromDataUrl(source: string): Promise<HTMLCanvasElement> {
  return new Promise<HTMLCanvasElement>((resolve, reject) => {
    const image = new Image();
    image.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = image.naturalWidth || image.width;
      canvas.height = image.naturalHeight || image.height;
      canvas.getContext("2d").drawImage(image, 0, 0);
      resolve(canvas);
    };
    image.onerror = () => reject(new Error("Could not load embedded image."));
    image.src = source;
  });
}

export function keyChromaCanvas(sourceCanvas: CanvasImageSource & { width: number; height: number }, keyColor: Rgb, tolerance: number): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = sourceCanvas.width;
  canvas.height = sourceCanvas.height;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  ctx.drawImage(sourceCanvas, 0, 0);
  const image = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const data = image.data;
  for (let index = 0; index < data.length; index += 4) {
    const distance = Math.hypot(
      data[index] - keyColor[0],
      data[index + 1] - keyColor[1],
      data[index + 2] - keyColor[2],
    );
    const alpha = clamp((distance - tolerance * 0.42) / (tolerance * 0.58), 0, 1);
    data[index + 3] = Math.round(data[index + 3] * alpha);
  }
  ctx.putImageData(image, 0, 0);
  return canvas;
}

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}
