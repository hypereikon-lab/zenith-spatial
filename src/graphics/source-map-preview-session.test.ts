import { describe, expect, test, vi } from "vitest";

import type { SourceMapPreviewRenderer } from "./source-map-preview-renderer.js";
import {
  createSourceMapPreviewSession,
  type SourceMapPreviewSessionRenderInput,
} from "./source-map-preview-session.js";

describe("source map preview video session", () => {
  test("uploads every decoded MP4 frame and disposes playback with the session", async () => {
    const setSourceImage = vi.fn();
    const render = vi.fn(async () => undefined);
    const destroyRenderer = vi.fn();
    const renderer = { setSourceImage, setOverlayImage: vi.fn(), render, destroy: destroyRenderer };
    let decodedFrame: (() => void) | null = null;
    const cancelVideoFrameCallback = vi.fn();
    const video = Object.assign(new EventTarget(), {
      videoWidth: 2048,
      videoHeight: 2048,
      requestVideoFrameCallback: vi.fn((callback: () => void) => {
        decodedFrame = callback;
        return 41;
      }),
      cancelVideoFrameCallback,
    }) as unknown as HTMLVideoElement;
    const disposeVideo = vi.fn();
    const session = createSourceMapPreviewSession({} as HTMLCanvasElement, {
      createRenderer: async () => renderer as unknown as SourceMapPreviewRenderer,
      loadVideo: async () => video,
      disposeVideo,
      requestFrame: vi.fn(() => 1),
      cancelFrame: vi.fn(),
    });

    const update = await session.renderMedia(renderInput());
    expect(update).toMatchObject({ imageSize: { width: 2048, height: 2048 } });
    expect(setSourceImage).toHaveBeenCalledWith(video);
    expect(render).toHaveBeenCalledOnce();
    expect(decodedFrame).not.toBeNull();

    decodedFrame!();
    await vi.waitFor(() => expect(render).toHaveBeenCalledTimes(2));
    expect(setSourceImage).toHaveBeenCalledTimes(2);
    await vi.waitFor(() => expect(video.requestVideoFrameCallback).toHaveBeenCalledTimes(2));

    session.destroy();
    expect(cancelVideoFrameCallback).toHaveBeenCalledWith(41);
    expect(disposeVideo).toHaveBeenCalledWith(video);
    expect(destroyRenderer).toHaveBeenCalledOnce();
  });
});

function renderInput(): SourceMapPreviewSessionRenderInput {
  return {
    mediaUrl: "blob:video",
    mediaKind: "video",
    projectionProfile: "zenith-180",
    viewerMode: "domemaster",
    selectedViewMode: "dome-orbit",
    camera: {},
    domeGuideSemanticSplit: 0.5,
    domeGuideHorizonSplit: 0.5,
    showCaveMask: false,
    invertCaveMask: false,
    width: 960,
    height: 720,
    label: "Fulldome MP4",
  };
}
