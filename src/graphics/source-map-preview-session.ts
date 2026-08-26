import { sourceProjectionLabel, type SourceProjectionMode } from "../geometry/source-projection.js";
import type { ProjectionSurface } from "../lib/shared/contracts/projection-authoring.js";
import { disposeVideoSource, loadVideoSource } from "../media/video-source.js";
import { plateEditorViewLabel, type PlateEditorCamera, type PlateEditorViewMode } from "../plates/plate-editor-view.js";
import { sourceReviewGuideOverlay, type SourceReviewViewMode } from "../scene/projection-view-contract.js";
import { createSourceMapPreviewRenderer, type SourceMapPreviewRenderer } from "./source-map-preview-renderer.js";

export type SourceMapPreviewSessionUpdate = {
  status?: string;
  imageSize?: { width: number; height: number };
};

export type SourceMapPreviewSessionRenderInput = {
  mediaUrl: string;
  mediaKind: "image" | "video";
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
  clearMedia: () => void;
  destroy: () => void;
};

type VideoFrameSource = HTMLVideoElement & {
  requestVideoFrameCallback?: (callback: () => void) => number;
  cancelVideoFrameCallback?: (id: number) => void;
};

export function createSourceMapPreviewSession(
  canvas: HTMLCanvasElement,
  options: {
    createRenderer?: (canvas: HTMLCanvasElement) => Promise<SourceMapPreviewRenderer>;
    fetchSource?: typeof fetch;
    createBitmap?: (image: Blob, options?: ImageBitmapOptions) => Promise<ImageBitmap>;
    loadVideo?: (url: string) => Promise<HTMLVideoElement>;
    disposeVideo?: (video: HTMLVideoElement) => void;
    requestFrame?: (callback: FrameRequestCallback) => number;
    cancelFrame?: (id: number) => void;
  } = {},
): SourceMapPreviewSession {
  const createRenderer = options.createRenderer || createSourceMapPreviewRenderer;
  const fetchSource = options.fetchSource || fetch;
  const createBitmap =
    options.createBitmap ||
    ((image: Blob, bitmapOptions?: ImageBitmapOptions) => createImageBitmap(image, bitmapOptions));
  const loadVideo =
    options.loadVideo ||
    ((url: string) => loadVideoSource(url, { autoplay: true, loop: true, muted: true, waitFor: "frame" }));
  const disposeVideo = options.disposeVideo || disposeVideoSource;
  const requestFrame = options.requestFrame || ((callback: FrameRequestCallback) => requestAnimationFrame(callback));
  const cancelFrame = options.cancelFrame || ((id: number) => cancelAnimationFrame(id));
  let renderer: SourceMapPreviewRenderer | null = null;
  let rendererPromise: Promise<SourceMapPreviewRenderer> | null = null;
  let bitmap: ImageBitmap | null = null;
  let video: VideoFrameSource | null = null;
  let sourceKey = "";
  let serial = 0;
  let destroyed = false;
  let latestInput: SourceMapPreviewSessionRenderInput | null = null;
  let videoFrameId: number | null = null;
  let videoFrameKind: "video" | "animation" | null = null;
  let videoFrameBusy = false;

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
    latestInput = input;
    if (!input.mediaUrl) {
      closeSource();
      const update = { status: "No media loaded." };
      emit(update);
      return update;
    }
    const nextSourceKey = `${input.mediaKind}:${input.mediaUrl}`;
    try {
      const gpu = await ensureRenderer();
      if (destroyed || request !== serial) return null;
      if (sourceKey !== nextSourceKey) {
        closeSource();
        emit({ status: `Loading ${input.mediaKind} into projection preview…` });
        if (input.mediaKind === "video") {
          const next = (await loadVideo(input.mediaUrl)) as VideoFrameSource;
          if (destroyed || request !== serial) {
            disposeVideo(next);
            return null;
          }
          video = next;
          sourceKey = nextSourceKey;
          gpu.setSourceImage(video);
          scheduleVideoFrame();
        } else {
          const response = await fetchSource(input.mediaUrl);
          if (!response.ok) throw new Error("Could not load projection image.");
          const next = await createBitmap(await response.blob(), { imageOrientation: "from-image" });
          if (destroyed || request !== serial) {
            next.close();
            return null;
          }
          bitmap = next;
          sourceKey = nextSourceKey;
          gpu.setSourceImage(bitmap);
        }
      } else if (video) {
        gpu.setSourceImage(video);
        scheduleVideoFrame();
      }
      await renderProjection(gpu, input);
      const dimensions = video
        ? { width: video.videoWidth, height: video.videoHeight }
        : bitmap
          ? { width: bitmap.width, height: bitmap.height }
          : undefined;
      const update = {
        status:
          input.label +
          " mapped as " +
          sourceProjectionLabel(input.projectionProfile) +
          " / " +
          plateEditorViewLabel(input.selectedViewMode) +
          ".",
        imageSize: dimensions,
      };
      emit(update);
      return update;
    } catch (error) {
      const update = { status: error instanceof Error ? error.message : "Could not render projection preview." };
      emit(update);
      return update;
    }
  }

  function scheduleVideoFrame() {
    if (!video || videoFrameId !== null || destroyed) return;
    const current = video;
    const callback = () => {
      videoFrameId = null;
      videoFrameKind = null;
      if (destroyed || video !== current) return;
      void renderCurrentVideoFrame().finally(scheduleVideoFrame);
    };
    if (current.requestVideoFrameCallback) {
      videoFrameKind = "video";
      videoFrameId = current.requestVideoFrameCallback(callback);
    } else {
      videoFrameKind = "animation";
      videoFrameId = requestFrame(callback);
    }
  }

  async function renderCurrentVideoFrame() {
    if (videoFrameBusy || !renderer || !video || !latestInput || destroyed) return;
    videoFrameBusy = true;
    try {
      renderer.setSourceImage(video);
      await renderProjection(renderer, latestInput);
    } catch {
      // A later explicit render reports actionable errors; animation keeps trying future decoded frames.
    } finally {
      videoFrameBusy = false;
    }
  }

  function cancelVideoFrame() {
    if (videoFrameId === null) return;
    if (videoFrameKind === "video") video?.cancelVideoFrameCallback?.(videoFrameId);
    else cancelFrame(videoFrameId);
    videoFrameId = null;
    videoFrameKind = null;
  }

  function closeSource() {
    cancelVideoFrame();
    bitmap?.close();
    bitmap = null;
    if (video) disposeVideo(video);
    video = null;
    sourceKey = "";
  }

  function clearMedia() {
    serial += 1;
    latestInput = null;
    closeSource();
  }

  function destroy() {
    destroyed = true;
    clearMedia();
    renderer?.destroy();
    renderer = null;
    rendererPromise = null;
  }

  return { renderMedia, clearMedia, destroy };
}

function renderProjection(renderer: SourceMapPreviewRenderer, input: SourceMapPreviewSessionRenderInput) {
  return renderer.render({
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
}
