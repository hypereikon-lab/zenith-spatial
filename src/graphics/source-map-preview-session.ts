import { sourceProjectionLabel } from "../geometry/source-projection.js";
import { plateEditorViewLabel, type PlateEditorCamera, type PlateEditorViewMode } from "../plates/plate-editor-view.js";
import { createSourceMapPreviewRenderer, type SourceMapPreviewRenderer } from "./source-map-preview-renderer.js";
import type { ArtifactMedia } from "../artifacts/artifact-types.js";
import type { SourceProjectionMode } from "../geometry/source-projection.js";
import type { ProjectionSurface } from "../lib/shared/contracts/projection-authoring.js";
import { sourceReviewGuideOverlay, type SourceReviewViewMode } from "../scene/projection-view-contract.js";

export type SourceMapPreviewSessionUpdate = {
  status?: string;
  imageSize?: { width: number; height: number };
};

export type SourceMapPreviewSessionRenderInput = {
  mediaUrl: string;
  mediaKind: ArtifactMedia["kind"];
  projectionProfile: SourceProjectionMode;
  viewerMode: SourceReviewViewMode;
  selectedViewMode: PlateEditorViewMode;
  camera: Partial<PlateEditorCamera>;
  domeGuideSemanticSplit: number;
  domeGuideHorizonSplit: number;
  showCaveMask: boolean;
  invertCaveMask: boolean;
  width: number;
  height: number;
  label: string;
  projectionSurface?: ProjectionSurface;
};

export type SourceMapPreviewSession = {
  renderMedia: (
    input: SourceMapPreviewSessionRenderInput,
    emit?: (update: SourceMapPreviewSessionUpdate) => void,
  ) => Promise<SourceMapPreviewSessionUpdate | null>;
  destroy: () => void;
};

export function createSourceMapPreviewSession(
  canvas: HTMLCanvasElement,
  options: {
    createRenderer?: (canvas: HTMLCanvasElement) => Promise<SourceMapPreviewRenderer>;
    fetchSource?: typeof fetch;
    createBitmap?: typeof createImageBitmap;
  } = {},
): SourceMapPreviewSession {
  const createRenderer = options.createRenderer || createSourceMapPreviewRenderer;
  const fetchSource = options.fetchSource || fetch;
  const createBitmap = options.createBitmap || createImageBitmap;
  let renderer: SourceMapPreviewRenderer | null = null;
  let rendererPromise: Promise<SourceMapPreviewRenderer> | null = null;
  let bitmap: ImageBitmap | null = null;
  let sourceKey = "";
  let serial = 0;
  let destroyed = false;

  async function ensureRenderer() {
    if (renderer) return renderer;
    rendererPromise ||= createRenderer(canvas);
    renderer = await rendererPromise;
    return renderer;
  }

  async function renderMedia(
    input: SourceMapPreviewSessionRenderInput,
    emit: (update: SourceMapPreviewSessionUpdate) => void = () => {},
  ): Promise<SourceMapPreviewSessionUpdate | null> {
    const request = ++serial;
    if (input.mediaKind !== "image" || !input.mediaUrl) {
      closeBitmap();
      sourceKey = "";
      const update = { status: "No image loaded." };
      emit(update);
      return update;
    }
    try {
      const gpu = await ensureRenderer();
      if (destroyed || request !== serial) return null;
      if (sourceKey !== input.mediaUrl) {
        emit({ status: "Loading image into projection preview…" });
        const response = await fetchSource(input.mediaUrl);
        if (!response.ok) throw new Error("Could not load projection image.");
        const next = await createBitmap(await response.blob(), { imageOrientation: "from-image" });
        if (destroyed || request !== serial) {
          next.close();
          return null;
        }
        closeBitmap();
        bitmap = next;
        sourceKey = input.mediaUrl;
        gpu.setSourceImage(bitmap);
      }
      await gpu.render({
        width: input.width,
        height: input.height,
        sourceProjectionMode: input.projectionProfile,
        projectionViewMode: input.selectedViewMode,
        projectionCamera: input.camera,
        showProjectionGuides: input.viewerMode !== "domemaster",
        guideOverlay: sourceReviewGuideOverlay(input.viewerMode),
        domeGuideSemanticSplit: input.domeGuideSemanticSplit,
        domeGuideHorizonSplit: input.domeGuideHorizonSplit,
        showCaveMask: input.showCaveMask,
        invertCaveMask: input.invertCaveMask,
        projectionSurface: input.projectionSurface,
      });
      const imageSize = bitmap ? { width: bitmap.width, height: bitmap.height } : undefined;
      const update = {
        status: input.label + " mapped as " + sourceProjectionLabel(input.projectionProfile) +
          " / " + plateEditorViewLabel(input.selectedViewMode) + ".",
        imageSize,
      };
      emit(update);
      return update;
    } catch (error) {
      const update = { status: error instanceof Error ? error.message : "Could not render projection preview." };
      emit(update);
      return update;
    }
  }

  function closeBitmap() {
    bitmap?.close();
    bitmap = null;
  }

  function destroy() {
    destroyed = true;
    serial += 1;
    closeBitmap();
    renderer?.destroy();
    renderer = null;
    rendererPromise = null;
  }

  return { renderMedia, destroy };
}
