import { domeScenePlateImageFromLayer, type DomeScene, type DomeScenePlateLayer } from "./dome-scene.js";
import { activeWorkbenchRuntime } from "../artifacts/workbench-runtime.svelte.js";
import { loadPlateSketchSource, type PlateSketchImage } from "../plates/plate-sketch-sources.js";
import type { PlateSketchPreviewInput } from "../plates/plate-sketch-preview-session.js";
import type { PlateEditorCamera, PlateEditorViewMode } from "../plates/plate-editor-view.js";

export function syncDomeScenePlateRuntimeFromPreviewInput(scene: DomeScene, input: PlateSketchPreviewInput): void {
  activeWorkbenchRuntime.editor.plateRuntime.syncFromPreviewInput(scene, input);
}

export function setDomeScenePlateRuntimeImage(layerId: string, image: PlateSketchImage): void {
  activeWorkbenchRuntime.editor.plateRuntime.set(layerId, image);
}

export function clearDomeScenePlateRuntimeImages(): void {
  activeWorkbenchRuntime.editor.plateRuntime.clear();
}

export function domeScenePlateRuntimeImage(layerId: string): PlateSketchImage | null {
  return activeWorkbenchRuntime.editor.plateRuntime.get(layerId);
}

export async function resolveDomeScenePlateImage(layer: DomeScenePlateLayer): Promise<PlateSketchImage | null> {
  const runtime = domeScenePlateRuntimeImage(layer.id);
  if (runtime) return runtime;
  const assetHandle = layer.source.assetId
    ? activeWorkbenchRuntime.compositionSourceMedia.get(layer.source.assetId)
    : undefined;
  const sourceBlob = assetHandle?.blob || assetHandle?.file || null;
  let blob = sourceBlob;
  if (!blob) {
    if (!layer.source.url) return null;
    const response = await fetch(layer.source.url);
    if (!response.ok) return null;
    blob = await response.blob();
  }
  const image = {
    ...(await loadPlateSketchSource(layer.source.name, blob)),
    layerId: layer.id,
    ...(layer.source.assetId ? { assetId: layer.source.assetId } : {}),
    ...(layer.source.url ? { sourceUrl: layer.source.url } : {}),
    ...(layer.source.mime ? { mime: layer.source.mime } : {}),
  };
  setDomeScenePlateRuntimeImage(layer.id, image);
  return image;
}

export async function domeScenePlateImages(scene: DomeScene): Promise<PlateSketchImage[] | null> {
  const images = await Promise.all(scene.frame0.plateLayers.map(resolveDomeScenePlateImage));
  if (images.some((image) => !image)) return null;
  return images as PlateSketchImage[];
}

export async function domeScenePlateSketchPreviewInput(
  scene: DomeScene,
  {
    canvasWidth,
    canvasHeight = canvasWidth,
    viewerMode,
    projectionViewMode,
    projectionCamera,
    showCaveMask = false,
    invertCaveMask = false,
  }: {
    canvasWidth: number;
    canvasHeight?: number;
    viewerMode: PlateSketchPreviewInput["viewerMode"];
    projectionViewMode: PlateEditorViewMode;
    projectionCamera: Partial<PlateEditorCamera>;
    showCaveMask?: boolean;
    invertCaveMask?: boolean;
  },
): Promise<PlateSketchPreviewInput | null> {
  const plates = await domeScenePlateImages(scene);
  if (!plates || plates.length === 0) return null;
  return {
    plates,
    placements: scene.frame0.plateLayers.map((layer) => layer.placement),
    canvasWidth,
    canvasHeight,
    plateFit: scene.frame0.plateFit,
    plateFeather: scene.frame0.plateFeather,
    domeGuideSemanticSplit: scene.guideSplit,
    domeGuideHorizonSplit: scene.horizonSplit,
    sourceProjectionMode: scene.projectionMode,
    projectionSurface: scene.surface,
    viewerMode,
    projectionViewMode,
    projectionCamera,
    showCaveMask,
    invertCaveMask,
  };
}

export function domeScenePlateImageFromRuntimeCanvas(
  layer: DomeScenePlateLayer,
  canvas: HTMLCanvasElement,
): PlateSketchImage {
  return domeScenePlateImageFromLayer(layer, canvas);
}
