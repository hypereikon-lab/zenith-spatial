import { describe, expect, test, vi } from "vitest";
import {
  buildPlateSketchHandoffOptions,
  buildPlateSketchRenderOptions,
  createPlateSketchPreviewSession,
  type PlateSketchPreviewInput,
} from "./plate-sketch-preview-session.js";
import { normalizePlatePlacement } from "./plate-placement.js";
import type { PlateSketchGpuRenderer } from "./plate-sketch-gpu-renderer.js";
import {
  cylinderCapDetailSize,
  previewCompositorDimensions,
  previewCompositorSize,
} from "./plate-sketch-gpu-renderer.js";
import type { PlateSketchImage } from "./plate-sketch-sources.js";

const canvas = {} as HTMLCanvasElement;

describe("plate sketch preview session", () => {
  test("scales interactive compositor quality with the visible viewport", () => {
    expect(previewCompositorSize(320, "source-map")).toBe(512);
    expect(previewCompositorSize(768, "source-map")).toBe(960);
    expect(previewCompositorSize(768, "dome-orbit")).toBe(1152);
    expect(previewCompositorSize(2048, "dome-orbit")).toBe(2048);
    expect(previewCompositorDimensions(768, 432, "source-map")).toEqual({ width: 960, height: 540 });
    expect(previewCompositorDimensions(768, 329, "source-map")).toEqual({ width: 1195, height: 512 });
    expect(cylinderCapDetailSize(320)).toBe(1024);
    expect(cylinderCapDetailSize(768)).toBe(1536);
    expect(cylinderCapDetailSize(2048)).toBe(2048);
  });
  test("builds preview and handoff options from explicit editor state", () => {
    const input = previewInput();

    expect(buildPlateSketchHandoffOptions(input, 2048)).toMatchObject({
      plates: input.plates,
      platePlacements: input.placements,
      plateCount: 1,
      width: 2048,
      height: 2048,
      plateFit: "contain",
      plateFeather: 0.02,
      domeGuideSemanticSplit: 0.5,
      domeGuideHorizonSplit: 0.68,
      sourceProjectionMode: "zenith-180",
      guideMode: "inpaint-handoff",
    });
    expect(buildPlateSketchRenderOptions(input, 768)).toMatchObject({
      width: 768,
      height: 768,
      guideMode: "inpaint-handoff",
      projectionViewMode: "dome-orbit",
      projectionCamera: input.projectionCamera,
      showProjectionGuides: true,
      guideOverlay: "guides",
      showCaveMask: false,
      invertCaveMask: false,
    });
    expect(buildPlateSketchRenderOptions(input, 768).guideMode).toBe(
      buildPlateSketchHandoffOptions(input, 2048).guideMode,
    );
  });

  test("keeps clean, guide, and physical-edge review layers mutually exclusive", () => {
    expect(buildPlateSketchRenderOptions({ ...previewInput(), viewerMode: "domemaster" }, 768).guideOverlay).toBe(
      "clean",
    );
    expect(buildPlateSketchRenderOptions({ ...previewInput(), viewerMode: "dome-check" }, 768).guideOverlay).toBe(
      "guides",
    );
    expect(buildPlateSketchRenderOptions({ ...previewInput(), viewerMode: "rim-check" }, 768).guideOverlay).toBe(
      "edge",
    );
  });

  test("schedules at most one preview frame and can cancel it by rendering immediately", async () => {
    const renderer = fakeRenderer();
    const callbacks: FrameRequestCallback[] = [];
    const cancelAnimationFrame = vi.fn();
    const session = createPlateSketchPreviewSession(canvas, {
      createRenderer: async () => renderer,
      requestAnimationFrame: vi.fn((callback: FrameRequestCallback) => {
        callbacks.push(callback);
        return callbacks.length;
      }) as typeof requestAnimationFrame,
      cancelAnimationFrame: cancelAnimationFrame as typeof cancelAnimationFrame,
    });
    const render = vi.fn();

    session.scheduleRenderPreview(render);
    session.scheduleRenderPreview(render);

    expect(callbacks).toHaveLength(1);
    await session.renderPreview(previewInput());

    expect(cancelAnimationFrame).toHaveBeenCalledWith(1);
    expect(renderer.renderPreview).toHaveBeenCalledTimes(1);
  });

  test("renders previews and handoff canvases through one lazy renderer", async () => {
    const outputCanvas = {} as HTMLCanvasElement;
    const renderer = fakeRenderer(outputCanvas);
    const createRenderer = vi.fn(async () => renderer);
    const session = createPlateSketchPreviewSession(canvas, { createRenderer });

    const status = await session.renderPreview(previewInput());
    const handoff = await session.renderHandoffCanvas(previewInput(), { width: 2560, height: 1440 });

    expect(status).toBe("1 plate previewed through WebGPU Zenith 180 Dome Stage.");
    expect(handoff).toBe(outputCanvas);
    expect(createRenderer).toHaveBeenCalledTimes(1);
    expect(renderer.renderPreview).toHaveBeenCalledWith(
      expect.objectContaining({ width: 768, height: 768, projectionViewMode: "dome-orbit" }),
    );
    expect(renderer.renderToCanvas).toHaveBeenCalledWith(
      expect.objectContaining({ width: 2560, height: 1440, guideMode: "inpaint-handoff" }),
    );
  });

  test("destroys a renderer that resolves after session teardown", async () => {
    const renderer = fakeRenderer();
    const rendererCreate = deferred<PlateSketchGpuRenderer>();
    const session = createPlateSketchPreviewSession(canvas, {
      createRenderer: () => rendererCreate.promise,
    });
    const render = session.renderPreview(previewInput());

    session.destroy();
    rendererCreate.resolve(renderer);
    await render;

    expect(renderer.destroy).toHaveBeenCalledTimes(1);
    expect(renderer.renderPreview).not.toHaveBeenCalled();
  });

  test("does not paint a preview after a newer render supersedes it", async () => {
    const renderer = fakeRenderer();
    const rendererCreate = deferred<PlateSketchGpuRenderer>();
    let current = true;
    const session = createPlateSketchPreviewSession(canvas, {
      createRenderer: () => rendererCreate.promise,
    });
    const render = session.renderPreview(previewInput(), {
      shouldRender: () => current,
    });

    current = false;
    rendererCreate.resolve(renderer);
    const status = await render;

    expect(status).toBeNull();
    expect(renderer.renderPreview).not.toHaveBeenCalled();
  });

  test("does not render a handoff canvas through a renderer that resolves after teardown", async () => {
    const renderer = fakeRenderer();
    const rendererCreate = deferred<PlateSketchGpuRenderer>();
    const session = createPlateSketchPreviewSession(canvas, {
      createRenderer: () => rendererCreate.promise,
    });
    const handoff = session.renderHandoffCanvas(previewInput(), { width: 2048, height: 2048 });

    session.destroy();
    rendererCreate.resolve(renderer);

    await expect(handoff).rejects.toThrow("Plate Sketch preview session has been destroyed.");
    expect(renderer.destroy).toHaveBeenCalledTimes(1);
    expect(renderer.renderToCanvas).not.toHaveBeenCalled();
  });
});

function previewInput(): PlateSketchPreviewInput {
  return {
    plates: [fakePlate()],
    placements: [normalizePlatePlacement({ scale: 0.7 }, { aspect: 1 })],
    canvasWidth: 768,
    plateFit: "contain",
    plateFeather: 0.02,
    domeGuideSemanticSplit: 0.5,
    domeGuideHorizonSplit: 0.68,
    sourceProjectionMode: "zenith-180",
    viewerMode: "dome-check",
    projectionViewMode: "dome-orbit",
    projectionCamera: {},
    showCaveMask: false,
    invertCaveMask: false,
  };
}

function fakePlate(): PlateSketchImage {
  return {
    name: "plate.png",
    width: 100,
    height: 100,
    aspect: 1,
    canvas: {} as HTMLCanvasElement,
  };
}

function fakeRenderer(outputCanvas = {} as HTMLCanvasElement): PlateSketchGpuRenderer {
  return {
    renderPreview: vi.fn(() => Promise.resolve()),
    renderToCanvas: vi.fn(() => Promise.resolve(outputCanvas)),
    destroy: vi.fn(),
  };
}

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((innerResolve) => {
    resolve = innerResolve;
  });
  return { promise, resolve };
}
