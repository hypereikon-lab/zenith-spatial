import { DOME_HANDOFF_GUIDE } from "../geometry/dome-handoff-guide.js";
import {
  PLATE_OUTPUT_FORMAT,
  type PlateGpuCompositorOptions,
  type PlateImage,
  type PlateRenderOptions,
  type PlateTexture,
  type PlateTextureCache,
} from "./plate-gpu-compositor-types.js";
import { guideUniformValue, placementUniformValue } from "./plate-gpu-compositor-uniforms.js";
import {
  plateCompositeBindings,
  plateCompositeUniformSchema,
  plateGuideBindings,
  plateGuideUniformSchema,
} from "../graphics/typegpu/contracts.js";
import type { TgpuBindGroup, TgpuRoot, TgpuSampler, TgpuUniform } from "typegpu";
import type { GpuRuntime } from "../graphics/gpu-runtime.js";
import type { GpuResourceScope } from "../graphics/typegpu/resource-scope.js";
import { createPlateGpuPipelines, type PlateGpuPipelines } from "./plate-gpu-pipelines.js";
import {
  executeTypeGpuFullscreenDrawSequence,
  type TypeGpuFullscreenDraw,
} from "../graphics/typegpu/ordered-render-pass.js";

export { plateCompositeShader } from "./plate-composite-shader.js";
export { plateGuideShader } from "./plate-guide-shader.js";
export type { PlateRenderOptions } from "./plate-gpu-compositor-types.js";

type PlateUniformResource = {
  uniform: TgpuUniform<typeof plateCompositeUniformSchema>;
};

export class PlateGpuCompositor {
  private runtime: GpuRuntime;
  private sampler: TgpuSampler;
  private root: TgpuRoot;
  private scope: GpuResourceScope;
  private outputTexture: PlateTexture | null = null;
  private outputWidth = 0;
  private outputHeight = 0;
  private plateTextures = new WeakMap<PlateImage, PlateTextureCache>();
  private ownedPlateTextures = new Set<PlateTextureCache>();
  private uniformBuffers: PlateUniformResource[] = [];
  private plateBindGroups = new WeakMap<PlateUniformResource, { texture: PlateTexture; group: TgpuBindGroup }>();
  private guideUniform: TgpuUniform<typeof plateGuideUniformSchema>;
  private pipelines: PlateGpuPipelines;
  private cachedGuideBindGroup: TgpuBindGroup | null = null;
  private destroyed = false;

  constructor({ runtime, sampler }: PlateGpuCompositorOptions) {
    this.runtime = runtime;
    this.sampler = sampler;
    this.root = runtime.root;
    this.scope = runtime.createScope("Plate GPU compositor");

    this.guideUniform = this.root.createUniform(plateGuideUniformSchema);
    this.scope.own(this.guideUniform.buffer);
    this.pipelines = createPlateGpuPipelines(this.root);
  }

  render({
    plates,
    plateCount,
    plateFit,
    plateFeather,
    platePlacements,
    width,
    height,
    sourceProjectionMode = "zenith-180",
    projectionSurface,
    guideMode = "transparent",
    domeGuideSemanticSplit = DOME_HANDOFF_GUIDE.defaultSemanticSplit,
    domeGuideHorizonSplit,
    rasterInnerSplit,
  }: PlateRenderOptions): PlateTexture {
    this.assertActive();
    const outputWidth = Math.max(1, Math.round(width || 2048));
    const outputHeight = Math.max(1, Math.round(height || 2048));
    this.ensureOutputTexture(outputWidth, outputHeight);
    if (guideMode === "inpaint-handoff") {
      this.guideUniform.write(
        guideUniformValue(
          outputWidth,
          outputHeight,
          sourceProjectionMode,
          domeGuideSemanticSplit,
          domeGuideHorizonSplit,
          projectionSurface,
        ),
      );
    }

    const draws: TypeGpuFullscreenDraw[] = [];
    if (guideMode === "inpaint-handoff") {
      draws.push({
        pipeline: this.pipelines.guide,
        bindGroup: this.guideBindGroup(),
      });
    }

    const count = Math.min(plateCount, plates.length, platePlacements.length);
    for (let index = 0; index < count; index += 1) {
      const plate = plates[index];
      const placement = platePlacements[index];
      if (!plate || !placement || !plate.canvas) continue;
      const texture = this.textureForPlate(plate);
      const uniform = this.uniformBufferForIndex(index);
      const uniformOptions = {
        placement,
        plate,
        plateFit,
        plateFeather,
        outputWidth,
        outputHeight,
        sourceProjectionMode,
        projectionSurface,
        domeGuideSemanticSplit,
        domeGuideHorizonSplit,
        rasterInnerSplit,
      };
      uniform.uniform.write(placementUniformValue(uniformOptions));
      draws.push({
        pipeline: this.pipelines.composite,
        bindGroup: this.bindGroupFor(texture, uniform),
      });
    }

    executeTypeGpuFullscreenDrawSequence(this.runtime, {
      target: this.outputTexture!,
      width: outputWidth,
      height: outputHeight,
      draws,
    });
    return this.outputTexture!;
  }

  ensureOutputTexture(width: number, height: number): void {
    this.assertActive();
    if (this.outputTexture && this.outputWidth === width && this.outputHeight === height) return;
    if (this.outputTexture) this.scope.release(this.outputTexture).destroy();
    if (Math.max(width, height) > this.runtime.limits.maxTextureDimension2D) {
      throw new Error(
        `Plate sketch is ${width} x ${height}; this GPU accepts up to ${this.runtime.limits.maxTextureDimension2D}.`,
      );
    }
    this.outputTexture = this.scope.own(
      this.root.createTexture({ size: [width, height], format: PLATE_OUTPUT_FORMAT }).$usage("sampled", "render"),
    );
    this.outputWidth = width;
    this.outputHeight = height;
  }

  textureForPlate(plate: PlateImage): PlateTexture {
    this.assertActive();
    const cached = this.plateTextures.get(plate);
    if (cached && cached.width === plate.width && cached.height === plate.height) {
      return cached.texture;
    }
    if (cached) this.destroyPlateTexture(cached);
    const texture = this.scope.own(
      this.root
        .createTexture({ size: [plate.width, plate.height], format: PLATE_OUTPUT_FORMAT })
        .$usage("sampled", "render"),
    );
    texture.write(plate.canvas);
    const cache = {
      texture,
      width: plate.width,
      height: plate.height,
    };
    this.plateTextures.set(plate, cache);
    this.ownedPlateTextures.add(cache);
    return texture;
  }

  uniformBufferForIndex(index: number): PlateUniformResource {
    this.assertActive();
    if (this.uniformBuffers[index]) return this.uniformBuffers[index];
    const resource = { uniform: this.root.createUniform(plateCompositeUniformSchema) };
    this.scope.own(resource.uniform.buffer);
    this.uniformBuffers[index] = resource;
    return resource;
  }

  bindGroupFor(texture: PlateTexture, uniform: PlateUniformResource): TgpuBindGroup {
    this.assertActive();
    const cached = this.plateBindGroups.get(uniform);
    if (cached?.texture === texture) return cached.group;
    const group = this.root.createBindGroup(plateCompositeBindings, {
      plate: uniform.uniform.buffer,
      sampler: this.sampler,
      texture,
    });
    this.plateBindGroups.set(uniform, { texture, group });
    return group;
  }

  guideBindGroup(): TgpuBindGroup {
    this.assertActive();
    if (this.cachedGuideBindGroup) return this.cachedGuideBindGroup;
    this.cachedGuideBindGroup = this.root.createBindGroup(plateGuideBindings, {
      guide: this.guideUniform.buffer,
    });
    return this.cachedGuideBindGroup;
  }

  resetPlateTextures(): void {
    if (this.destroyed) return;
    for (const cached of this.ownedPlateTextures) {
      this.scope.release(cached.texture).destroy();
    }
    this.ownedPlateTextures.clear();
    this.plateTextures = new WeakMap<PlateImage, PlateTextureCache>();
    this.plateBindGroups = new WeakMap();
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.scope.destroy();
    this.outputTexture = null;
    this.outputWidth = 0;
    this.outputHeight = 0;
    this.ownedPlateTextures.clear();
    this.plateTextures = new WeakMap<PlateImage, PlateTextureCache>();
    this.plateBindGroups = new WeakMap();
    this.cachedGuideBindGroup = null;
    this.uniformBuffers = [];
  }

  private destroyPlateTexture(cached: PlateTextureCache): void {
    this.scope.release(cached.texture).destroy();
    this.ownedPlateTextures.delete(cached);
  }

  private assertActive(): void {
    if (this.destroyed) {
      throw new Error("Plate GPU compositor has been destroyed.");
    }
    this.runtime.assertActive();
  }
}
