import {
  buildCaveRoomGeometry,
  buildCylinderRoomGeometry,
  buildDomeGeometry,
  buildDoubleGableRoomGeometry,
} from "./geometry.js";
import { buildProjectionPreviewRenderUniformValue } from "./projection-preview-render-uniforms.js";
import {
  cylinderProjectionPreviewBindings,
  projectionPreviewBindings,
  projectionPreviewUniformSchema,
} from "./typegpu/contracts.js";
import {
  type RenderFlag,
  type SampledFlag,
  type TgpuSampler,
  type TgpuTexture,
  type TgpuBindGroup,
  type TgpuUniform,
} from "typegpu";
import { createGpuRuntime, type GpuRuntime } from "./gpu-runtime.js";
import { createCanvasPresentation, type CanvasPresentation } from "./typegpu/canvas-presentation.js";
import type { GpuResourceScope } from "./typegpu/resource-scope.js";
import {
  createPackedVertexBuffer,
  createUint32IndexBuffer,
  type PackedVertexBuffer,
  type Uint32IndexBuffer,
} from "./typegpu/geometry-buffers.js";
import {
  createProjectionPreviewPipelines,
  domeVertexLayout,
  surfaceVertexLayout,
  type ProjectionPreviewPipelines,
} from "./typegpu/projection-preview-pipeline.js";
import {
  sourceProjectionGeometryRange,
  sourceProjectionIsCylinderCarrier,
  sourceProjectionIsUnwrappedCylinderCarrier,
} from "../geometry/source-projection.js";
import {
  plateEditorViewUsesSurfaceGeometry,
  type PlateEditorCamera,
  type PlateEditorViewMode,
} from "../plates/plate-editor-view.js";
import type { SourceProjectionMode } from "../geometry/source-projection.js";
import {
  normalizeProjectionSurfaceForMode,
  type ProjectionSurface,
} from "../lib/shared/contracts/projection-authoring.js";
import type { ProjectionGuideOverlay } from "./projection-preview-uniforms.js";

const TEXTURE_FORMAT: GPUTextureFormat = "rgba8unorm";

export type SourceMapPreviewRenderOptions = {
  width: number;
  height: number;
  sourceProjectionMode: SourceProjectionMode;
  projectionViewMode: PlateEditorViewMode;
  projectionCamera?: Partial<PlateEditorCamera>;
  showProjectionGuides?: boolean;
  guideOverlay?: ProjectionGuideOverlay;
  domeGuideSemanticSplit?: number | string | null;
  domeGuideHorizonSplit?: number | string | null;
  showCaveMask?: boolean;
  invertCaveMask?: boolean;
  waitForCompletion?: boolean;
  projectionSurface?: ProjectionSurface;
};

export type SourceMapPreviewSource = ImageBitmap | HTMLCanvasElement | HTMLVideoElement;

export type SourceMapPreviewRenderer = {
  setSourceImage: (source: SourceMapPreviewSource) => void;
  setOverlayImage: (source: SourceMapPreviewSource | null) => void;
  render: (options: SourceMapPreviewRenderOptions) => Promise<void>;
  destroy: () => void;
};

export async function createSourceMapPreviewRenderer(
  canvas: HTMLCanvasElement,
  { runtime: providedRuntime = null }: { runtime?: GpuRuntime | null } = {},
): Promise<SourceMapPreviewRenderer> {
  if (!navigator.gpu) {
    throw new Error("WebGPU is not available in this browser.");
  }

  let ready = false;
  let context!: GPUCanvasContext;
  let presentation: CanvasPresentation | null = null;
  let scope: GpuResourceScope | null = null;
  let presentationFormat!: GPUTextureFormat;
  let sampler!: TgpuSampler;
  let horizontalWrapSampler!: TgpuSampler;
  let pipelines: ProjectionPreviewPipelines | null = null;
  let runtime: GpuRuntime | null = null;
  let ownsRuntime = false;
  let projectionUniform: TgpuUniform<typeof projectionPreviewUniformSchema> | null = null;
  let caveVertexBuffer!: PackedVertexBuffer;
  let caveIndexBuffer!: Uint32IndexBuffer;
  let cylinderNadirVertexBuffer!: PackedVertexBuffer;
  let cylinderNadirIndexBuffer!: Uint32IndexBuffer;
  let cylinderZenithVertexBuffer!: PackedVertexBuffer;
  let cylinderZenithIndexBuffer!: Uint32IndexBuffer;

  let sourceTexture: (TgpuTexture & SampledFlag) | null = null;
  let sourceWidth = 1;
  let sourceHeight = 1;
  let sourceTextureWidth = 0;
  let sourceTextureHeight = 0;
  let overlayTexture: (TgpuTexture & SampledFlag) | null = null;
  let overlayWidth = 1;
  let overlayHeight = 1;
  let overlayTextureWidth = 0;
  let overlayTextureHeight = 0;
  let overlayActive = false;
  let domeVertexBuffer: PackedVertexBuffer | null = null;
  let domeIndexBuffer: Uint32IndexBuffer | null = null;
  let domeIndexCount = 0;
  let domeGeometryMode: SourceProjectionMode | null = null;
  let depthTexture: (TgpuTexture & RenderFlag) | null = null;
  let depthWidth = 0;
  let depthHeight = 0;
  const bindGroupCache = new Map<string, TgpuBindGroup>();

  let destroyed = false;
  let lastSourceImage: SourceMapPreviewSource | null = null;
  let lastOverlayImage: SourceMapPreviewSource | null = null;
  let caveGeometry = buildCaveRoomGeometry();
  let cylinderNadirGeometry = buildCylinderRoomGeometry("cylinder-nadir");
  let cylinderZenithGeometry = buildCylinderRoomGeometry("cylinder-zenith");
  let surfaceGeometryFingerprint = "default";

  async function init(): Promise<void> {
    runtime = providedRuntime || (await createGpuRuntime());
    ownsRuntime = !providedRuntime;
    scope = runtime.createScope("Source Map Preview renderer");
    if (ownsRuntime)
      runtime.lifecycle.lost.then((info) => {
        if (destroyed || info.reason === "destroyed") return;
        console.warn("Source Map Preview WebGPU device lost. Re-initializing...", info.message);
        cleanup();
        void init()
          .then(() => {
            if (lastSourceImage) {
              setSourceImage(lastSourceImage);
            }
            if (lastOverlayImage) {
              setOverlayImage(lastOverlayImage);
            }
          })
          .catch((error) => {
            console.error("Failed to re-initialize WebGPU renderer after device loss:", error);
          });
      });

    presentation = scope.own(
      createCanvasPresentation(runtime.root, canvas, {
        format: runtime.format,
        alphaMode: "opaque",
        usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC,
      }),
    );
    context = presentation.context;
    presentationFormat = runtime.format;

    sampler = runtime.root.createSampler({
      magFilter: "linear",
      minFilter: "linear",
      mipmapFilter: "linear",
      addressModeU: "clamp-to-edge",
      addressModeV: "clamp-to-edge",
    });
    horizontalWrapSampler = runtime.root.createSampler({
      magFilter: "linear",
      minFilter: "linear",
      mipmapFilter: "linear",
      addressModeU: "repeat",
      addressModeV: "clamp-to-edge",
    });

    pipelines = createProjectionPreviewPipelines(runtime.root, presentationFormat);

    projectionUniform = runtime.root.createUniform(projectionPreviewUniformSchema);
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

  function setSourceImage(source: SourceMapPreviewSource): void {
    if (!ready) return;
    lastSourceImage = source;
    const dimensions = sourceDimensions(source);
    if (!dimensions) return;
    sourceWidth = dimensions.width;
    sourceHeight = dimensions.height;
    if (!sourceTexture || sourceTextureWidth !== sourceWidth || sourceTextureHeight !== sourceHeight) {
      destroyOwned(sourceTexture);
      sourceTexture = scope!.own(
        runtime!.root
          .createTexture({
            size: [sourceWidth, sourceHeight],
            format: TEXTURE_FORMAT,
          })
          .$usage("sampled", "render"),
      );
      bindGroupCache.clear();
      sourceTextureWidth = sourceWidth;
      sourceTextureHeight = sourceHeight;
    }
    sourceTexture.write(source);
  }

  function setOverlayImage(source: SourceMapPreviewSource | null): void {
    if (!ready) return;
    lastOverlayImage = source;
    overlayActive = Boolean(source);
    if (!source) return;
    const dimensions = sourceDimensions(source);
    if (!dimensions) return;
    overlayWidth = dimensions.width;
    overlayHeight = dimensions.height;
    if (!overlayTexture || overlayTextureWidth !== overlayWidth || overlayTextureHeight !== overlayHeight) {
      destroyOwned(overlayTexture);
      overlayTexture = scope!.own(
        runtime!.root
          .createTexture({
            size: [overlayWidth, overlayHeight],
            format: TEXTURE_FORMAT,
          })
          .$usage("sampled", "render"),
      );
      bindGroupCache.clear();
      overlayTextureWidth = overlayWidth;
      overlayTextureHeight = overlayHeight;
    }
    overlayTexture.write(source);
  }

  async function render(options: SourceMapPreviewRenderOptions): Promise<void> {
    if (!ready || !sourceTexture) return;
    runtime!.assertActive();
    const width = Math.max(1, Math.round(options.width));
    const height = Math.max(1, Math.round(options.height));
    context = presentation!.configure({ width, height });
    writeUniforms(width, height, options);

    if (options.projectionViewMode === "source-map") {
      await renderFlat();
      if (options.waitForCompletion) await runtime!.lifecycle.waitForSubmittedWork();
      return;
    }
    await renderProjection(width, height, options);
    if (options.waitForCompletion) await runtime!.lifecycle.waitForSubmittedWork();
  }

  async function renderFlat(): Promise<void> {
    runtime!.lifecycle.beginValidationScope();
    pipelines!.flat
      .with(bindGroup())
      .withColorAttachment({
        view: context,
        clearValue: { r: 0.012, g: 0.015, b: 0.018, a: 1 },
        loadOp: "clear",
        storeOp: "store",
      })
      .draw(3);
    const renderError = await runtime!.lifecycle.endValidationScope();
    if (renderError) throw new Error(`Source Map Preview WebGPU render validation failed: ${renderError.message}`);
  }

  async function renderProjection(
    width: number,
    height: number,
    options: SourceMapPreviewRenderOptions,
  ): Promise<void> {
    ensureDepthTexture(width, height);
    ensureSurfaceGeometry(options.sourceProjectionMode, options.projectionSurface);
    const renderSurface = plateEditorViewUsesSurfaceGeometry(options.projectionViewMode, options.sourceProjectionMode);
    if (!renderSurface) ensureDomeGeometry(options.sourceProjectionMode);
    if (!pipelines || !depthTexture) return;

    const renderCylinder = renderSurface && sourceProjectionIsCylinderCarrier(options.sourceProjectionMode);
    const group = bindGroup(sourceProjectionIsUnwrappedCylinderCarrier(options.sourceProjectionMode), renderCylinder);
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

    runtime!.lifecycle.beginValidationScope();
    if (renderSurface) {
      if (renderCylinder) {
        const zenith = options.sourceProjectionMode === "cylinder-zenith";
        const geometry = zenith ? cylinderZenithGeometry : cylinderNadirGeometry;
        const vertices = zenith ? cylinderZenithVertexBuffer : cylinderNadirVertexBuffer;
        const indices = zenith ? cylinderZenithIndexBuffer : cylinderNadirIndexBuffer;
        pipelines.cylinder
          .with(group)
          .with(surfaceVertexLayout, vertices.buffer)
          .withColorAttachment(colorAttachment)
          .withDepthStencilAttachment(depthAttachment)
          .withIndexBuffer(indices)
          .drawIndexed(geometry.indices.length);
      } else {
        pipelines.cave
          .with(group)
          .with(surfaceVertexLayout, caveVertexBuffer.buffer)
          .withColorAttachment(colorAttachment)
          .withDepthStencilAttachment(depthAttachment)
          .withIndexBuffer(caveIndexBuffer)
          .drawIndexed(caveGeometry.indices.length);
      }
    } else {
      pipelines.dome
        .with(group)
        .with(domeVertexLayout, domeVertexBuffer!.buffer)
        .withColorAttachment(colorAttachment)
        .withDepthStencilAttachment(depthAttachment)
        .withIndexBuffer(domeIndexBuffer!)
        .drawIndexed(domeIndexCount);
    }
    const renderError = await runtime!.lifecycle.endValidationScope();
    if (renderError) throw new Error(`Source Map Preview WebGPU render validation failed: ${renderError.message}`);
  }

  function bindGroup(wrapHorizontally = false, includeCapDetail = false): TgpuBindGroup {
    if (!runtime || !projectionUniform) {
      throw new Error("Source Map Preview TypeGPU bindings are not ready.");
    }
    if (!sourceTexture) {
      throw new Error("Source Map Preview texture is not ready.");
    }
    const cacheKey = `${wrapHorizontally ? "wrap" : "clamp"}:${includeCapDetail ? "cap" : "base"}`;
    const cached = bindGroupCache.get(cacheKey);
    if (cached) return cached;
    const bindings = {
      uniforms: projectionUniform.buffer,
      sampler: wrapHorizontally ? horizontalWrapSampler : sampler,
      sourceTexture: sourceTexture.createView(),
      overlayTexture: (overlayTexture || sourceTexture).createView(),
    };
    if (!includeCapDetail) {
      const group = runtime.root.createBindGroup(projectionPreviewBindings, bindings);
      bindGroupCache.set(cacheKey, group);
      return group;
    }
    const group = runtime.root.createBindGroup(cylinderProjectionPreviewBindings, {
      ...bindings,
      capDetailTexture: sourceTexture.createView(),
    });
    bindGroupCache.set(cacheKey, group);
    return group;
  }

  function ensureDomeGeometry(sourceProjectionMode: SourceProjectionMode): void {
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

  function ensureSurfaceGeometry(sourceProjectionMode: SourceProjectionMode, surface?: ProjectionSurface): void {
    if (
      sourceProjectionMode === "zenith-180" ||
      sourceProjectionMode === "zenith-230" ||
      sourceProjectionMode === "nadir-180"
    ) {
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
    if (depthTexture && depthWidth === width && depthHeight === height) return;
    destroyOwned(depthTexture);
    depthTexture = scope!.own(
      runtime!.root.createTexture({ size: [width, height], format: "depth24plus" }).$usage("render"),
    );
    depthWidth = width;
    depthHeight = height;
  }

  function writeUniforms(width: number, height: number, options: SourceMapPreviewRenderOptions): void {
    projectionUniform?.write(
      buildProjectionPreviewRenderUniformValue({
        targetWidth: width,
        targetHeight: height,
        sourceWidth,
        sourceHeight,
        sourceOverlayOpacity: overlayActive && overlayTexture ? 1 : 0,
        ...options,
      }),
    );
  }

  function createVertexBuffer(data: Float32Array): PackedVertexBuffer {
    return scope!.own(createPackedVertexBuffer(runtime!.root, data));
  }

  function createIndexBuffer(data: Uint32Array): Uint32IndexBuffer {
    return scope!.own(createUint32IndexBuffer(runtime!.root, data));
  }

  function destroyOwned<T extends { destroy(): void }>(resource: T | null | undefined): void {
    if (!resource) return;
    if (scope) scope.release(resource).destroy();
    else resource.destroy();
  }

  function cleanup(): void {
    ready = false;
    sourceTexture = null;
    overlayTexture = null;
    bindGroupCache.clear();
    overlayActive = false;
    domeVertexBuffer = null;
    domeIndexBuffer = null;
    depthTexture = null;
    projectionUniform = null;
    presentation = null;
    pipelines = null;
    scope?.destroy();
    scope = null;
    if (ownsRuntime) runtime?.destroy();
    runtime = null;
    ownsRuntime = false;
    surfaceGeometryFingerprint = "default";
  }

  function destroy(): void {
    destroyed = true;
    cleanup();
  }

  return {
    setSourceImage,
    setOverlayImage,
    render,
    destroy,
  };
}

function sourceDimensions(source: SourceMapPreviewSource): { width: number; height: number } | null {
  const width = Math.round("videoWidth" in source ? source.videoWidth : source.width || 0);
  const height = Math.round("videoHeight" in source ? source.videoHeight : source.height || 0);
  return width > 0 && height > 0 ? { width, height } : null;
}
