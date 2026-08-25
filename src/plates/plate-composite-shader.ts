import tgpu, { common, d } from "typegpu";
import { plateSampleUvForDirectionKernel } from "../kernels/plates/placement.js";
import { ProjectionTopologyCode } from "../kernels/projection/constants.js";
import { sourceUvToDirectionKernel } from "../kernels/projection/index.js";
import { planarRoofProfileKernelSchema } from "../kernels/schemas.js";
import { plateCompositeBindings } from "../graphics/typegpu/contracts.js";

const sourceUvToDirectionGpu = tgpu
  .fn([
      d.vec2f,
      d.u32,
      d.u32,
      d.u32,
      d.vec2f,
      d.f32,
      d.f32,
      d.f32,
      d.f32,
      d.f32,
      d.vec3f,
      d.vec3f,
      d.vec3f,
      d.vec3f,
      d.vec3f,
      planarRoofProfileKernelSchema,
      d.vec4f,
      d.vec3f,
    ], d.vec4f)(sourceUvToDirectionKernel)
  .$name("sourceUvToDirectionKernel");

const plateSampleUvForDirectionGpu = tgpu
  .fn([
      d.vec3f,
      d.vec3f,
      d.vec3f,
      d.vec3f,
      d.vec2f,
      d.vec2f,
      d.f32,
      d.u32,
      d.u32,
      d.u32,
      d.f32,
      d.vec4f,
      d.vec4f,
    ], d.vec4f)(plateSampleUvForDirectionKernel)
  .$name("plateSampleUvForDirectionKernel");

const bindings = plateCompositeBindings.bound;

export const plateCompositeFragment = tgpu
  .fragmentFn({ in: { uv: d.vec2f }, out: d.vec4f })(
    `{
    if (uniforms.projection.topology == ${ProjectionTopologyCode.Fisheye}u) {
      let fisheyeScale = max(uniforms.projection.fisheyeScale, vec2f(0.000001));
      let fisheyePoint = (in.uv - vec2f(0.5)) / fisheyeScale;
      if (length(fisheyePoint) > 1.0) {
        return vec4f(0.0, 0.0, 0.0, 1.0);
      }
    } else if (uniforms.projection.topology == ${ProjectionTopologyCode.CylinderRadial}u) {
      let cylinderPoint = (in.uv - vec2f(0.5)) * 2.0;
      if (length(cylinderPoint) > 1.0) {
        return vec4f(0.0, 0.0, 0.0, 1.0);
      }
    }

    let source = sourceUvToDirectionKernel(
      in.uv,
      uniforms.projection.mode,
      uniforms.projection.topology,
      uniforms.projection.flags,
      uniforms.projection.fisheyeScale,
      uniforms.projection.halfAngle,
      uniforms.projection.innerSplit,
      uniforms.projection.horizonSplit,
      uniforms.projection.physicalSemantic,
      uniforms.projection.physicalHorizon,
      uniforms.projection.centerAxis,
      uniforms.projection.imageRightAxis,
      uniforms.projection.imageUpAxis,
      uniforms.projection.boxSize,
      uniforms.projection.boxObserver,
      uniforms.projection.roofProfile,
      uniforms.projection.doubleGable,
      uniforms.projection.cylinder,
    );
    if (source.w < 0.5) {
      return vec4f(0.0, 0.0, 0.0, 1.0);
    }

    let sample = plateSampleUvForDirectionKernel(
      source.xyz,
      uniforms.plate.center,
      uniforms.plate.right,
      uniforms.plate.down,
      uniforms.plate.angularSize,
      uniforms.plate.spin,
      uniforms.plate.sourceAspect,
      uniforms.plate.fit,
      uniforms.plate.flipX,
      uniforms.plate.flipY,
      uniforms.plate.feather,
      uniforms.plate.warpNorth,
      uniforms.plate.warpSouth,
    );
    if (sample.z < 0.5) {
      discard;
    }

    let color = textureSampleLevel(plateTexture, plateSampler, sample.xy, 0.0);
    let alpha = clamp(color.a * uniforms.plate.opacity * sample.w, 0.0, 1.0);
    if (alpha <= 0.0) {
      discard;
    }
    return vec4f(color.rgb, alpha);
  }`,
  )
  .$uses({
    plateSampler: bindings.sampler,
    plateSampleUvForDirectionKernel: plateSampleUvForDirectionGpu,
    plateTexture: bindings.texture,
    sourceUvToDirectionKernel: sourceUvToDirectionGpu,
    uniforms: bindings.plate,
  })
  .$name("fragmentMain");

export const plateCompositeShader = tgpu.resolve([common.fullScreenTriangle, plateCompositeFragment], {
  names: "strict",
});
