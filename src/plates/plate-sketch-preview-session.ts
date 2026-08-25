import { plateEditorViewLabel, type PlateEditorCamera, type PlateEditorViewMode } from "./plate-editor-view.js";
import { createPlateSketchGpuRenderer } from "./plate-sketch-gpu-renderer.js";
import type { PlateSketchGpuRenderer, PlateSketchRenderOptions } from "./plate-sketch-gpu-renderer.js";
import { projectionCarrierProfile } from "../geometry/projection-carrier-profile.js";
import type { SourceProjectionMode } from "../geometry/source-projection.js";
import type { ProjectionSurface } from "../lib/shared/contracts/projection-authoring.js";
import type { NormalizedPlatePlacement } from "./plate-placement.js";
import type { PlateSketchImage } from "./plate-sketch-sources.js";
import type { GpuRuntime } from "../graphics/gpu-runtime.js";
import { sourceReviewGuideOverlay, type SourceReviewViewMode } from "../scene/projection-view-contract.js";

export type PlateSketchPreviewInput = {
  plates: PlateSketchImage[];
  placements: NormalizedPlatePlacement[];
  canvasWidth: number;
  canvasHeight?: number;
  plateFit: string;
  plateFeather: number;
  domeGuideSemanticSplit: number;
  domeGuideHorizonSplit: number;
  sourceProjectionMode: SourceProjectionMode;
  projectionSurface?: ProjectionSurface;
  viewerMode: SourceReviewViewMode;
  projectionViewMode: PlateEditorViewMode;
  projectionCamera: Partial<PlateEditorCamera>;
  showCaveMask: boolean;
  invertCaveMask: boolean;
};

type PlateSketchPreviewSessionOptions = {
  createRenderer?: (canvas: HTMLCanvasElement) => Promise<PlateSketchGpuRenderer>;
  runtime?: GpuRuntime | null;
  requestAnimationFrame?: typeof requestAnimationFrame;
  cancelAnimationFrame?: typeof cancelAnimationFrame;
};

export type PlateSketchPreviewSession = {
  renderPreview: (input: PlateSketchPreviewInput, options?: { shouldRender?: () => boolean }) => Promise<string | null>;
  scheduleRenderPreview: (render: () => void) => void;
  renderHandoffCanvas: (
    input: PlateSketchPreviewInput,
    dimensions: { width: number; height: number },
  ) => Promise<HTMLCanvasElement>;
  destroy: () => void;
};

export function createPlateSketchPreviewSession(
  canvas: HTMLCanvasElement,
  {
    createRenderer,
    runtime = null,
    requestAnimationFrame: scheduleFrame = defaultRequestAnimationFrame,
    cancelAnimationFrame: cancelFrame = defaultCancelAnimationFrame,
  }: PlateSketchPreviewSessionOptions = {},
): PlateSketchPreviewSession {
  const rendererFactory =
    createRenderer || ((target: HTMLCanvasElement) => createPlateSketchGpuRenderer(target, { runtime }));
  let renderer: PlateSketchGpuRenderer | null = null;
  let rendererPromise: Promise<PlateSketchGpuRenderer> | null = null;
  let previewFrame: number | null = null;
  let destroyed = false;

  async function ensureRenderer(): Promise<PlateSketchGpuRenderer> {
    if (renderer) return renderer;
    if (!rendererPromise) {
      rendererPromise = rendererFactory(canvas).then((created) => {
        if (destroyed) {
          created.destroy();
          return created;
        }
        renderer = created;
        return created;
      });
    }
    return rendererPromise;
  }

  async function renderPreview(
    input: PlateSketchPreviewInput,
    { shouldRender }: { shouldRender?: () => boolean } = {},
  ): Promise<string | null> {
    if (destroyed || input.plates.length === 0 || input.placements.length === 0) return null;
    cancelScheduledPreview();
    const gpu = await ensureRenderer();
    if (destroyed || (shouldRender && !shouldRender())) return null;
    const viewMode = input.projectionViewMode;
    await gpu.renderPreview(buildPlateSketchRenderOptions(input, input.canvasWidth, input.canvasHeight));
    return `${input.plates.length} plate${input.plates.length === 1 ? "" : "s"} previewed through WebGPU ${
      projectionCarrierProfile(input.sourceProjectionMode).label
    } ${plateEditorViewLabel(viewMode)}.`;
  }

  function scheduleRenderPreview(render: () => void): void {
    if (destroyed || previewFrame !== null) return;
    previewFrame = scheduleFrame(() => {
      previewFrame = null;
      render();
    });
  }

  async function renderHandoffCanvas(
    input: PlateSketchPreviewInput,
    dimensions: { width: number; height: number },
  ): Promise<HTMLCanvasElement> {
    const gpu = await ensureRenderer();
    if (destroyed) {
      throw new Error("Plate Sketch preview session has been destroyed.");
    }
    return gpu.renderToCanvas(buildPlateSketchHandoffOptions(input, dimensions.width, dimensions.height));
  }

  function destroy(): void {
    destroyed = true;
    cancelScheduledPreview();
    renderer?.destroy();
    renderer = null;
    rendererPromise = null;
  }

  function cancelScheduledPreview(): void {
    if (previewFrame !== null) {
      cancelFrame(previewFrame);
      previewFrame = null;
    }
  }

  return {
    renderPreview,
    scheduleRenderPreview,
    renderHandoffCanvas,
    destroy,
  };
}

export function buildPlateSketchRenderOptions(
  input: PlateSketchPreviewInput,
  width: number,
  height = width,
): PlateSketchRenderOptions {
  return {
    ...buildPlateSketchHandoffOptions(input, width, height),
    projectionViewMode: input.projectionViewMode,
    projectionCamera: input.projectionCamera,
    showProjectionGuides: input.viewerMode !== "domemaster",
    guideOverlay: sourceReviewGuideOverlay(input.viewerMode),
    showCaveMask: input.showCaveMask,
    invertCaveMask: input.invertCaveMask,
  };
}

export function buildPlateSketchHandoffOptions(
  input: PlateSketchPreviewInput,
  width: number,
  height = width,
): PlateSketchRenderOptions {
  return {
    plates: input.plates,
    platePlacements: input.placements,
    plateCount: input.plates.length,
    width,
    height,
    plateFit: input.plateFit,
    plateFeather: input.plateFeather,
    domeGuideSemanticSplit: input.domeGuideSemanticSplit,
    domeGuideHorizonSplit: input.domeGuideHorizonSplit,
    sourceProjectionMode: input.sourceProjectionMode,
    projectionSurface: input.projectionSurface,
    guideMode: "inpaint-handoff",
  };
}

const defaultRequestAnimationFrame: typeof requestAnimationFrame = (callback) => {
  if (typeof globalThis.requestAnimationFrame !== "function") {
    throw new Error("requestAnimationFrame is not available for Plate Sketch preview.");
  }
  return globalThis.requestAnimationFrame(callback);
};

const defaultCancelAnimationFrame: typeof cancelAnimationFrame = (handle) => {
  if (typeof globalThis.cancelAnimationFrame === "function") {
    globalThis.cancelAnimationFrame(handle);
  }
};
