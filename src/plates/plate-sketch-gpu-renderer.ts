import { PlateGpuCompositor } from "./plate-gpu-compositor.js";
import {
  buildCaveRoomGeometry,
  buildCylinderRoomGeometry,
  buildDomeGeometry,
  buildDoubleGableRoomGeometry,
} from "../graphics/geometry.js";
import { buildProjectionPreviewRenderUniformValue } from "../graphics/projection-preview-render-uniforms.js";
import {
  previewCopyBindings,
  cylinderProjectionPreviewBindings,
  projectionPreviewBindings,
  projectionPreviewUniformSchema,
} from "../graphics/typegpu/contracts.js";
import type { RenderFlag, TgpuSampler, TgpuTexture, TgpuUniform } from "typegpu";
import { createGpuRuntime, type GpuRuntime } from "../graphics/gpu-runtime.js";
import { createCanvasPresentation, type CanvasPresentation } from "../graphics/typegpu/canvas-presentation.js";
import type { GpuResourceScope } from "../graphics/typegpu/resource-scope.js";
import {
  createPackedVertexBuffer,
  createUint32IndexBuffer,
  type PackedVertexBuffer,
  type Uint32IndexBuffer,
} from "../graphics/typegpu/geometry-buffers.js";
import { readRgba8Texture } from "../graphics/typegpu/texture-readback.js";
import { createPreviewCopyPipeline } from "../graphics/typegpu/preview-copy-pipeline.js";
import type { TgpuBindGroup } from "typegpu";
import {
  createProjectionPreviewPipelines,
  domeVertexLayout,
  surfaceVertexLayout,
  type ProjectionPreviewPipelines,
} from "../graphics/typegpu/projection-preview-pipeline.js";
import { type PlateEditorCamera, type PlateEditorViewMode } from "./plate-editor-view.js";
import {
  sourceProjectionGeometryRange,
  sourceProjectionIsCylinderCarrier,
  sourceProjectionIsRadialCylinderCarrier,
  sourceProjectionIsSurfaceCarrier,
} from "../geometry/source-projection.js";
import type { PlateRenderOptions } from "./plate-gpu-compositor.js";
import type { PlateTexture } from "./plate-gpu-compositor-types.js";
import type { SourceProjectionMode } from "../geometry/source-projection.js";
import { normalizeProjectionSurfaceForMode } from "../lib/shared/contracts/projection-authoring.js";
import type { ProjectionGuideOverlay } from "../graphics/projection-preview-uniforms.js";

export type PlateSketchRenderOptions = PlateRenderOptions & {
  projectionViewMode?: PlateEditorViewMode;
  projectionCamera?: Partial<PlateEditorCamera>;
  showProjectionGuides?: boolean;
  guideOverlay?: ProjectionGuideOverlay;
  showCaveMask?: boolean;
  invertCaveMask?: boolean;
};

export type PlateSketchGpuRenderer = {
  renderPreview: (options: PlateSketchRenderOptions) => Promise<void>;
  renderToCanvas: (options: PlateRenderOptions) => Promise<HTMLCanvasElement>;
  destroy: () => void;
};

export async function createPlateSketchGpuRenderer(
  canvas: HTMLCanvasElement,
  { runtime: providedRuntime = null }: { runtime?: GpuRuntime | null } = {},
): Promise<PlateSketchGpuRenderer> {
  if (!navigator.gpu) {
    throw new Error("WebGPU is not available in this browser.");
  }

  let ready = false;
  let context: GPUCanvasContext | null = null;
  let presentation: CanvasPresentation | null = null;
  let scope: GpuResourceScope | null = null;
  let presentationFormat: GPUTextureFormat = navigator.gpu.getPreferredCanvasFormat();
  let sampler: TgpuSampler | null = null;
  let horizontalWrapSampler: TgpuSampler | null = null;
  let compositor: PlateGpuCompositor | null = null;
  let cylinderCapCompositor: PlateGpuCompositor | null = null;
  let copyPipeline: ReturnType<typeof createPreviewCopyPipeline> | null = null;
  let projectionPipelines: ProjectionPreviewPipelines | null = null;
  let runtime: GpuRuntime | null = null;
  let ownsRuntime = false;
  let projectionUniform: TgpuUniform<typeof projectionPreviewUniformSchema> | null = null;
  let caveGeometry = buildCaveRoomGeometry();
  let cylinderNadirGeometry = buildCylinderRoomGeometry("cylinder-nadir");
  let cylinderZenithGeometry = buildCylinderRoomGeometry("cylinder-zenith");
  let surfaceGeometryFingerprint = "default";
  let caveVertexBuffer: PackedVertexBuffer | null = null;
  let caveIndexBuffer: Uint32IndexBuffer | null = null;
  let cylinderNadirVertexBuffer: PackedVertexBuffer | null = null;
  let cylinderNadirIndexBuffer: Uint32IndexBuffer | null = null;
  let cylinderZenithVertexBuffer: PackedVertexBuffer | null = null;
  let cylinderZenithIndexBuffer: Uint32IndexBuffer | null = null;
  let domeVertexBuffer: PackedVertexBuffer | null = null;
  let domeIndexBuffer: Uint32IndexBuffer | null = null;
  let domeIndexCount = 0;
  let domeGeometryMode: SourceProjectionMode | null = null;
  let depthTexture: (TgpuTexture & RenderFlag) | null = null;
  let depthTextureWidth = 0;
  let depthTextureHeight = 0;
  let copyBindingCache: { texture: PlateTexture; group: TgpuBindGroup } | null = null;
  let projectionBindingCache: {
    texture: PlateTexture;
    capDetailTexture: PlateTexture | null;
    wrapHorizontally: boolean;
    includeCapDetail: boolean;
    group: TgpuBindGroup;
  } | null = null;
  let destroyed = false;

  async function init(): Promise<void> {
    const nextRuntime = providedRuntime || (await createGpuRuntime());
    if (destroyed) {
      if (!providedRuntime) nextRuntime.destroy();
      return;
    }
    runtime = nextRuntime;
    ownsRuntime = !providedRuntime;
    scope = nextRuntime.createScope("Plate Sketch renderer");
    if (ownsRuntime)
      nextRuntime.lifecycle.lost.then((info) => {
        if (destroyed || info.reason === "destroyed") return;
        console.warn("Plate Sketch WebGPU device lost. Re-initializing...", info.message);
        cleanup();
        void init().catch((error) => {
          console.error("Failed to re-initialize Plate Sketch WebGPU renderer after device loss:", error);
        });
      });

    presentation = scope.own(
      createCanvasPresentation(nextRuntime.root, canvas, {
        format: nextRuntime.format,
        alphaMode: "opaque",
        usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC,
      }),
    );
    context = presentation.context;
    presentationFormat = nextRuntime.format;

    sampler = nextRuntime.root.createSampler({
      magFilter: "linear",
      minFilter: "linear",
      mipmapFilter: "linear",
      addressModeU: "clamp-to-edge",
      addressModeV: "clamp-to-edge",
    });
    horizontalWrapSampler = nextRuntime.root.createSampler({
      magFilter: "linear",
      minFilter: "linear",
      mipmapFilter: "linear",
      addressModeU: "repeat",
      addressModeV: "clamp-to-edge",
    });
    compositor = new PlateGpuCompositor({
      runtime: nextRuntime,
      sampler,
    });
    cylinderCapCompositor = new PlateGpuCompositor({
      runtime: nextRuntime,
      sampler,
    });
    copyPipeline = createPreviewCopyPipeline(nextRuntime.root, presentationFormat);
    projectionPipelines = createProjectionPreviewPipelines(nextRuntime.root, presentationFormat);
    projectionUniform = nextRuntime.root.createUniform(projectionPreviewUniformSchema);
    scope.own(projectionUniform.buffer);
    caveVertexBuffer = createVertexBuffer(caveGeometry.vertices);
    caveIndexBuffer = createIndexBuffer(caveGeometry.indices);
    cylinderNadirVertexBuffer = createVertexBuffer(cylinderNadirGeometry.vertices);
    cylinderNadirIndexBuffer = createIndexBuffer(cylinderNadirGeometry.indices);
    cylinderZenithVertexBuffer = createVertexBuffer(cylinderZenithGeometry.vertices);
    cylinderZenithIndexBuffer = createIndexBuffer(cylinderZenithGeometry.indices);
    ready = true;
  }

  await init();

  async function renderPreview(options: PlateSketchRenderOptions): Promise<void> {
    if (!ready || !context || !sampler || !compositor || !copyPipeline) return;
    runtime!.assertActive();
    const width = Math.max(1, Math.round(options.width || 768));
    const height = Math.max(1, Math.round(options.height || width));
    context = presentation!.configure({ width, height });
    const compositorDimensions = previewCompositorDimensions(width, height, options.projectionViewMode);
    const texture = compositor.render({ ...options, ...compositorDimensions });
    if (options.projectionViewMode && options.projectionViewMode !== "source-map") {
      const sourceProjectionMode = options.sourceProjectionMode || "zenith-180";
      const capDetailTexture =
        options.projectionViewMode === "cave-room" &&
        sourceProjectionIsRadialCylinderCarrier(sourceProjectionMode) &&
        cylinderCapCompositor
          ? cylinderCapCompositor.render({
              ...options,
              ...cylinderCapDetailDimensions(width, height),
              guideMode: "transparent",
              rasterInnerSplit: 1,
            })
          : null;
      renderProjectionPreview(texture, capDetailTexture, width, height, options);
      return;
    }
    if (projectionPipelines && projectionUniform) {
      await renderFlatProjectionPreview(texture, width, height, options);
      return;
    }
    copyPipeline
      .with(copyBindGroup(texture))
      .withColorAttachment({
        view: context,
        clearValue: { r: 0, g: 0, b: 0, a: 1 },
        loadOp: "clear",
        storeOp: "store",
      })
      .draw(3);
  }

  async function renderFlatProjectionPreview(
    texture: PlateTexture,
    width: number,
    height: number,
    options: PlateSketchRenderOptions,
  ): Promise<void> {
    if (!context || !projectionUniform || !projectionPipelines) return;
    const sourceProjectionMode = options.sourceProjectionMode || "zenith-180";
    writeProjectionUniforms(width, height, options, false);
    runtime!.lifecycle.beginValidationScope();
    projectionPipelines.flat
      .with(projectionBindGroup(texture, null, sourceProjectionMode === "cylinder-wall", false))
      .withColorAttachment({
        view: context,
        clearValue: { r: 0, g: 0, b: 0, a: 1 },
        loadOp: "clear",
        storeOp: "store",
      })
      .draw(3);
    const renderError = await runtime!.lifecycle.endValidationScope();
    if (renderError) throw new Error(`Plate Sketch flat preview validation failed: ${renderError.message}`);
  }

  function renderProjectionPreview(
    texture: PlateTexture,
    capDetailTexture: PlateTexture | null,
    width: number,
    height: number,
    options: PlateSketchRenderOptions,
  ): void {
    if (!context || !projectionUniform || !projectionPipelines) return;
    const sourceProjectionMode = options.sourceProjectionMode || "zenith-180";
    ensureSurfaceGeometry(sourceProjectionMode, options.projectionSurface);
    if (options.projectionViewMode !== "cave-room") ensureDomeGeometry(sourceProjectionMode);
    ensureDepthTexture(width, height);
    if (!depthTexture) return;
    writeProjectionUniforms(width, height, options, Boolean(capDetailTexture));

    const renderCave = options.projectionViewMode === "cave-room";
    const renderCylinder = renderCave && sourceProjectionIsCylinderCarrier(sourceProjectionMode);
    if (renderCave && !renderCylinder && (!caveVertexBuffer || !caveIndexBuffer)) return;
    if (
      renderCylinder &&
      (!cylinderNadirVertexBuffer ||
        !cylinderNadirIndexBuffer ||
        !cylinderZenithVertexBuffer ||
        !cylinderZenithIndexBuffer)
    ) {
      return;
    }
    if (!renderCave && (!domeVertexBuffer || !domeIndexBuffer)) return;

    const group = projectionBindGroup(
      texture,
      capDetailTexture,
      sourceProjectionMode === "cylinder-wall",
      renderCylinder,
    );
    const colorAttachment = {
      view: context,
      clearValue: { r: 0.012, g: 0.015, b: 0.018, a: 1 },
      loadOp: "clear" as const,
      storeOp: "store" as const,
    };
    const depthAttachment = {
      view: depthTexture,
      depthClearValue: 1,
      depthLoadOp: "clear" as const,
      depthStoreOp: "discard" as const,
    };

    if (renderCave) {
      if (renderCylinder) {
        const zenith = sourceProjectionMode === "cylinder-zenith";
        const geometry = zenith ? cylinderZenithGeometry : cylinderNadirGeometry;
        const vertices = zenith ? cylinderZenithVertexBuffer! : cylinderNadirVertexBuffer!;
        const indices = zenith ? cylinderZenithIndexBuffer! : cylinderNadirIndexBuffer!;
        projectionPipelines.cylinder
          .with(group)
          .with(surfaceVertexLayout, vertices.buffer)
          .withColorAttachment(colorAttachment)
          .withDepthStencilAttachment(depthAttachment)
          .withIndexBuffer(indices)
          .drawIndexed(geometry.indices.length);
      } else {
        projectionPipelines.cave
          .with(group)
          .with(surfaceVertexLayout, caveVertexBuffer!.buffer)
          .withColorAttachment(colorAttachment)
          .withDepthStencilAttachment(depthAttachment)
          .withIndexBuffer(caveIndexBuffer!)
          .drawIndexed(caveGeometry.indices.length);
      }
    } else {
      projectionPipelines.dome
        .with(group)
        .with(domeVertexLayout, domeVertexBuffer!.buffer)
        .withColorAttachment(colorAttachment)
        .withDepthStencilAttachment(depthAttachment)
        .withIndexBuffer(domeIndexBuffer!)
        .drawIndexed(domeIndexCount);
    }
  }

  async function renderToCanvas(options: PlateRenderOptions): Promise<HTMLCanvasElement> {
    if (!ready || !compositor) {
      throw new Error("Plate Sketch WebGPU renderer is not ready.");
    }
    runtime!.assertActive();
    const width = Math.max(1, Math.round(options.width || 2048));
    const height = Math.max(1, Math.round(options.height || width));
    const texture = compositor.render({ ...options, width, height });
    return readTextureToCanvas(runtime!, texture, width, height);
  }

  function copyBindGroup(texture: PlateTexture): TgpuBindGroup {
    if (!runtime || !sampler) {
      throw new Error("Plate Sketch WebGPU renderer is not ready.");
    }
    if (copyBindingCache?.texture === texture) return copyBindingCache.group;
    const group = runtime.root.createBindGroup(previewCopyBindings, { sampler, texture });
    copyBindingCache = { texture, group };
    return group;
  }

  function projectionBindGroup(
    texture: PlateTexture,
    capDetailTexture: PlateTexture | null,
    wrapHorizontally: boolean,
    includeCapDetail: boolean,
  ): TgpuBindGroup {
    if (!runtime || !projectionUniform || !sampler || !horizontalWrapSampler) {
      throw new Error("Plate Sketch WebGPU renderer is not ready.");
    }
    if (
      projectionBindingCache?.texture === texture &&
      projectionBindingCache.capDetailTexture === capDetailTexture &&
      projectionBindingCache.wrapHorizontally === wrapHorizontally &&
      projectionBindingCache.includeCapDetail === includeCapDetail
    ) {
      return projectionBindingCache.group;
    }
    const bindings = {
      uniforms: projectionUniform.buffer,
      sampler: wrapHorizontally ? horizontalWrapSampler : sampler,
      sourceTexture: texture.createView(),
      overlayTexture: texture.createView(),
    };
    let group: TgpuBindGroup;
    if (!includeCapDetail) {
      group = runtime.root.createBindGroup(projectionPreviewBindings, bindings);
    } else {
      group = runtime.root.createBindGroup(cylinderProjectionPreviewBindings, {
        ...bindings,
        capDetailTexture: (capDetailTexture || texture).createView(),
      });
    }
    projectionBindingCache = { texture, capDetailTexture, wrapHorizontally, includeCapDetail, group };
    return group;
  }

  function ensureDomeGeometry(sourceProjectionMode: SourceProjectionMode): void {
    if (!ready) return;
    if (domeGeometryMode === sourceProjectionMode && domeVertexBuffer && domeIndexBuffer) return;
    destroyOwned(domeVertexBuffer);
    destroyOwned(domeIndexBuffer);
    const range = sourceProjectionGeometryRange(sourceProjectionMode);
    const geometry = buildDomeGeometry(1, range.thetaStart, range.thetaEnd);
    domeVertexBuffer = createVertexBuffer(geometry.vertices);
    domeIndexBuffer = createIndexBuffer(geometry.indices);
    domeIndexCount = geometry.indices.length;
    domeGeometryMode = sourceProjectionMode;
  }

  function ensureSurfaceGeometry(
    sourceProjectionMode: SourceProjectionMode,
    surface: PlateSketchRenderOptions["projectionSurface"],
  ): void {
    if (!ready || !sourceProjectionIsSurfaceCarrier(sourceProjectionMode)) {
      return;
    }
    const normalizedSurface = normalizeProjectionSurfaceForMode(surface, sourceProjectionMode);
    const fingerprint = `${sourceProjectionMode}:${JSON.stringify(normalizedSurface)}`;
    if (fingerprint === surfaceGeometryFingerprint) return;

    if (sourceProjectionMode === "cave-270" && normalizedSurface.kind === "box-room") {
      caveGeometry = buildCaveRoomGeometry(normalizedSurface);
      destroyOwned(caveVertexBuffer);
      destroyOwned(caveIndexBuffer);
      caveVertexBuffer = createVertexBuffer(caveGeometry.vertices);
      caveIndexBuffer = createIndexBuffer(caveGeometry.indices);
    } else if (sourceProjectionMode === "hall-double-gable" && normalizedSurface.kind === "double-gable-room") {
      caveGeometry = buildDoubleGableRoomGeometry(normalizedSurface);
      destroyOwned(caveVertexBuffer);
      destroyOwned(caveIndexBuffer);
      caveVertexBuffer = createVertexBuffer(caveGeometry.vertices);
      caveIndexBuffer = createIndexBuffer(caveGeometry.indices);
    } else if (sourceProjectionMode.startsWith("cylinder-") && normalizedSurface.kind === "cylinder") {
      const room = {
        radius: normalizedSurface.radius,
        height: normalizedSurface.height,
        eyeHeight: normalizedSurface.eyeHeight,
      };
      cylinderNadirGeometry = buildCylinderRoomGeometry("cylinder-nadir", room);
      cylinderZenithGeometry = buildCylinderRoomGeometry("cylinder-zenith", room);
      destroyOwned(cylinderNadirVertexBuffer);
      destroyOwned(cylinderNadirIndexBuffer);
      destroyOwned(cylinderZenithVertexBuffer);
      destroyOwned(cylinderZenithIndexBuffer);
      cylinderNadirVertexBuffer = createVertexBuffer(cylinderNadirGeometry.vertices);
      cylinderNadirIndexBuffer = createIndexBuffer(cylinderNadirGeometry.indices);
      cylinderZenithVertexBuffer = createVertexBuffer(cylinderZenithGeometry.vertices);
      cylinderZenithIndexBuffer = createIndexBuffer(cylinderZenithGeometry.indices);
    }
    surfaceGeometryFingerprint = fingerprint;
  }

  function ensureDepthTexture(width: number, height: number): void {
    if (!ready) return;
    if (depthTexture && depthTextureWidth === width && depthTextureHeight === height) return;
    destroyOwned(depthTexture);
    depthTexture = scope!.own(
      runtime!.root.createTexture({ size: [width, height], format: "depth24plus" }).$usage("render"),
    );
    depthTextureWidth = width;
    depthTextureHeight = height;
  }

  function writeProjectionUniforms(
    width: number,
    height: number,
    options: PlateSketchRenderOptions,
    sourceCapDetailAvailable: boolean,
  ): void {
    if (!projectionUniform) return;
    const sourceProjectionMode = options.sourceProjectionMode || "zenith-180";
    const projectionViewMode =
      options.projectionViewMode === "cave-room" ? "cave-room" : options.projectionViewMode || "dome-orbit";
    projectionUniform.write(
      buildProjectionPreviewRenderUniformValue({
        targetWidth: width,
        targetHeight: height,
        sourceWidth: width,
        sourceHeight: height,
        sourceProjectionMode,
        projectionViewMode,
        projectionCamera: options.projectionCamera,
        showProjectionGuides: options.showProjectionGuides,
        guideOverlay: options.guideOverlay,
        domeGuideSemanticSplit: options.domeGuideSemanticSplit,
        domeGuideHorizonSplit: options.domeGuideHorizonSplit,
        showCaveMask: options.showCaveMask,
        invertCaveMask: options.invertCaveMask,
        sourceCapDetailAvailable,
        projectionSurface: options.projectionSurface,
      }),
    );
  }

  function createVertexBuffer(data: Float32Array): PackedVertexBuffer {
    if (!runtime) throw new Error("Plate Sketch WebGPU renderer is not ready.");
    return scope!.own(createPackedVertexBuffer(runtime.root, data));
  }

  function createIndexBuffer(data: Uint32Array): Uint32IndexBuffer {
    if (!runtime) throw new Error("Plate Sketch WebGPU renderer is not ready.");
    return scope!.own(createUint32IndexBuffer(runtime.root, data));
  }

  function destroyOwned<T extends { destroy(): void }>(resource: T | null | undefined): void {
    if (!resource) return;
    if (scope) scope.release(resource).destroy();
    else resource.destroy();
  }

  function cleanup(): void {
    ready = false;
    compositor?.destroy();
    compositor = null;
    cylinderCapCompositor?.destroy();
    cylinderCapCompositor = null;
    domeVertexBuffer = null;
    domeIndexBuffer = null;
    caveVertexBuffer = null;
    caveIndexBuffer = null;
    cylinderNadirVertexBuffer = null;
    cylinderNadirIndexBuffer = null;
    cylinderZenithVertexBuffer = null;
    cylinderZenithIndexBuffer = null;
    depthTexture = null;
    depthTextureWidth = 0;
    depthTextureHeight = 0;
    domeIndexCount = 0;
    domeGeometryMode = null;
    surfaceGeometryFingerprint = "default";
    projectionUniform = null;
    copyBindingCache = null;
    projectionBindingCache = null;
    presentation = null;
    scope?.destroy();
    scope = null;
    if (ownsRuntime) runtime?.destroy();
    runtime = null;
    ownsRuntime = false;
    sampler = null;
    horizontalWrapSampler = null;
    copyPipeline = null;
    projectionPipelines = null;
    context = null;
  }

  function destroy(): void {
    destroyed = true;
    cleanup();
  }

  return {
    renderPreview,
    renderToCanvas,
    destroy,
  };
}

export function previewCompositorDimensions(
  width: number,
  height: number,
  projectionViewMode?: PlateEditorViewMode,
): { width: number; height: number } {
  const requestedWidth = Math.max(1, Math.round(width));
  const requestedHeight = Math.max(1, Math.round(height));
  const qualityScale = projectionViewMode && projectionViewMode !== "source-map" ? 1.5 : 1.25;
  const minimumDetailScale = 512 / Math.min(requestedWidth, requestedHeight);
  const maximumTextureScale = 2048 / Math.max(requestedWidth, requestedHeight);
  const scale = Math.min(Math.max(qualityScale, minimumDetailScale), maximumTextureScale);
  return {
    width: Math.max(1, Math.round(requestedWidth * scale)),
    height: Math.max(1, Math.round(requestedHeight * scale)),
  };
}

/** Retained for callers that need a scalar square quality estimate. */
export function previewCompositorSize(size: number, projectionViewMode?: PlateEditorViewMode): number {
  return previewCompositorDimensions(size, size, projectionViewMode).width;
}

export function cylinderCapDetailDimensions(width: number, height: number): { width: number; height: number } {
  const safeWidth = Math.max(1, width);
  const safeHeight = Math.max(1, height);
  const targetLongEdge = Math.min(2048, Math.max(1024, Math.round(Math.max(safeWidth, safeHeight) * 2)));
  const scale = targetLongEdge / Math.max(safeWidth, safeHeight);
  return {
    width: Math.max(1, Math.round(safeWidth * scale)),
    height: Math.max(1, Math.round(safeHeight * scale)),
  };
}

export function cylinderCapDetailSize(size: number): number {
  return cylinderCapDetailDimensions(size, size).width;
}

async function readTextureToCanvas(
  runtime: GpuRuntime,
  texture: PlateTexture,
  width: number,
  height: number,
): Promise<HTMLCanvasElement> {
  const pixels = await readRgba8Texture(runtime, texture, width, height);

  const output = document.createElement("canvas");
  output.width = width;
  output.height = height;
  const context = output.getContext("2d");
  if (!context) throw new Error("Could not create a 2D canvas for the Plate Sketch handoff.");
  context.putImageData(new ImageData(pixels, width, height), 0, 0);
  return output;
}
