import { d } from "typegpu";

export const planarRoofProfileKernelSchema = d.struct({
  positionsA: d.vec4f,
  positionsB: d.vec4f,
  heightsA: d.vec4f,
  heightsB: d.vec4f,
  count: d.u32,
});

export type PlanarRoofProfileKernel = d.Infer<typeof planarRoofProfileKernelSchema>;

/**
 * Portable numerical projection contract shared by CPU selectors and GPU
 * entrypoints. Semantic identity is carried by u32 values; geometry is never
 * inferred from negative angles or overloaded vector components.
 */
export const projectionKernelParamsSchema = d.struct({
  mode: d.u32,
  topology: d.u32,
  center: d.u32,
  domain: d.u32,
  flags: d.u32,
  rasterSize: d.vec2f,
  rasterScale: d.vec2f,
  fisheyeScale: d.vec2f,
  halfAngle: d.f32,
  innerSplit: d.f32,
  horizonSplit: d.f32,
  /** Physical trajectory position of the semantic/sky source anchor. */
  physicalSemantic: d.f32,
  /** Physical trajectory position of the horizon source anchor. */
  physicalHorizon: d.f32,
  centerAxis: d.vec3f,
  imageRightAxis: d.vec3f,
  imageUpAxis: d.vec3f,
  boxSize: d.vec3f,
  boxObserver: d.vec3f,
  roofProfile: planarRoofProfileKernelSchema,
  /** @deprecated Compatibility values for shader snapshots predating planar profiles. */
  doubleGable: d.vec4f,
  cylinder: d.vec3f,
});

export const projectionDirectionSampleSchema = d.struct({
  direction: d.vec3f,
  valid: d.u32,
  surface: d.u32,
});

export const projectionUvSampleSchema = d.struct({
  uv: d.vec2f,
  valid: d.u32,
  surface: d.u32,
});

export const plateKernelParamsSchema = d.struct({
  center: d.vec3f,
  right: d.vec3f,
  down: d.vec3f,
  angularSize: d.vec2f,
  spin: d.vec2f,
  opacity: d.f32,
  feather: d.f32,
  sourceAspect: d.f32,
  fit: d.u32,
  flipX: d.u32,
  flipY: d.u32,
  warpNorth: d.vec4f,
  warpSouth: d.vec4f,
});

export const guideKernelParamsSchema = d.struct({
  projection: projectionKernelParamsSchema,
  lineWidth: d.f32,
});
