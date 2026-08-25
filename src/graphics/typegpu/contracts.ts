import tgpu, { d, type TgpuLayoutEntry } from "typegpu";
import {
  guideKernelParamsSchema,
  plateKernelParamsSchema,
  projectionKernelParamsSchema,
} from "../../kernels/schemas.js";

/**
 * Browser-GPU contracts only. These schemas intentionally mirror the field
 * order of the raw WGSL interfaces while TypeGPU owns alignment and binding
 * indices. Portable geometry and composition contracts stay outside this
 * module.
 */
export const projectionPreviewUniformSchema = d.struct({
  mvp: d.mat4x4f,
  rotation: d.f32,
  exposure: d.f32,
  overlayOpacity: d.f32,
  mirror: d.f32,
  domeTilt: d.f32,
  cutaway: d.f32,
  showRings: d.f32,
  showSpokes: d.f32,
  showHorizon: d.f32,
  showZenith: d.f32,
  showSourceCircle: d.f32,
  shellShade: d.f32,
  showCaveMask: d.f32,
  cameraPosX: d.f32,
  cameraPosY: d.f32,
  cameraPosZ: d.f32,
  sourceOverlay: d.vec4f,
  kernel: projectionKernelParamsSchema,
});

const projectionPreviewBindingEntries = {
  uniforms: { uniform: projectionPreviewUniformSchema, visibility: ["vertex", "fragment"] },
  sampler: { sampler: "filtering", visibility: ["fragment"] },
  sourceTexture: { texture: d.texture2d(), visibility: ["fragment"] },
  overlayTexture: { texture: d.texture2d(), visibility: ["fragment"] },
} satisfies Record<string, TgpuLayoutEntry>;

/** Shared ABI for flat, dome, and CAVE source projection shaders. */
export const projectionPreviewBindings = tgpu.bindGroupLayout(projectionPreviewBindingEntries).$idx(0);

/** Cylinder-only extension: the wall renderer can blend a separately composed cap. */
export const cylinderProjectionPreviewBindings = tgpu
  .bindGroupLayout({
    ...projectionPreviewBindingEntries,
    capDetailTexture: { texture: d.texture2d(), visibility: ["fragment"] },
  } satisfies Record<string, TgpuLayoutEntry>)
  .$idx(0);

export const plateCompositeUniformSchema = d.struct({
  plate: plateKernelParamsSchema,
  projection: projectionKernelParamsSchema,
});

export const plateCompositeBindings = tgpu
  .bindGroupLayout({
    plate: { uniform: plateCompositeUniformSchema, visibility: ["fragment"] },
    sampler: { sampler: "filtering", visibility: ["fragment"] },
    texture: { texture: d.texture2d(), visibility: ["fragment"] },
  })
  .$idx(0);

export const plateGuideUniformSchema = guideKernelParamsSchema;

export const plateGuideBindings = tgpu
  .bindGroupLayout({
    guide: { uniform: plateGuideUniformSchema, visibility: ["fragment"] },
  })
  .$idx(0);

export const previewCopyBindings = tgpu
  .bindGroupLayout({
    sampler: { sampler: "filtering", visibility: ["fragment"] },
    texture: { texture: d.texture2d(), visibility: ["fragment"] },
  })
  .$idx(0);
