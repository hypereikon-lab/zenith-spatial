import tgpu, { common, d } from "typegpu";
import { CAVE_HANDOFF_GUIDE } from "../geometry/cave-handoff-guide.js";
import { DOME_HANDOFF_GUIDE } from "../geometry/dome-handoff-guide.js";
import { guideCarrierCoordinateKernel } from "../kernels/guides/carrier.js";
import {
  guideFieldAzimuthKernel,
  guideFieldColorKernel,
  profiledHallGuideFieldColorKernel,
} from "../kernels/guides/field.js";
import { ProjectionCenterCode, ProjectionTopologyCode } from "../kernels/projection/constants.js";
import { doubleGableCarrierUvToSurfaceKernel } from "../kernels/projection/double-gable.js";
import { planarRoofNormalizedHeightKernel } from "../kernels/projection/planar-roof-profile.js";
import { planarRoofProfileKernelSchema } from "../kernels/schemas.js";
import { plateGuideBindings } from "../graphics/typegpu/contracts.js";

const guideCarrierCoordinateGpu = tgpu
  .fn([d.vec2f, d.u32, d.vec2f], d.vec4f)(guideCarrierCoordinateKernel)
  .$name("guideCarrierCoordinateKernel");
const guideFieldColorGpu = tgpu
  .fn([d.f32, d.f32, d.f32, d.vec3f, d.vec3f, d.vec3f, d.vec3f], d.vec3f)(guideFieldColorKernel)
  .$name("guideFieldColorKernel");
const guideFieldAzimuthGpu = tgpu.fn([d.f32, d.f32], d.f32)(guideFieldAzimuthKernel).$name("guideFieldAzimuthKernel");
const profiledHallGuideFieldColorGpu = tgpu
  .fn([d.f32, d.f32, d.f32, d.vec3f, d.vec3f, d.vec3f, d.f32], d.vec3f)(profiledHallGuideFieldColorKernel)
  .$name("profiledHallGuideFieldColorKernel");
const doubleGableCarrierUvToSurfaceGpu = tgpu
  .fn([
      d.vec2f,
      d.vec3f,
      d.vec3f,
      planarRoofProfileKernelSchema,
      d.f32,
      d.f32,
      d.f32,
    ], d.vec4f)(doubleGableCarrierUvToSurfaceKernel)
  .$name("doubleGableCarrierUvToSurfaceKernel");
const planarRoofNormalizedHeightGpu = tgpu
  .fn([d.f32, d.f32, planarRoofProfileKernelSchema], d.f32)(planarRoofNormalizedHeightKernel)
  .$name("planarRoofNormalizedHeightKernel");
const guide = plateGuideBindings.bound.guide;

/**
 * Model-facing Plate Sketch field. It deliberately contains no baked rings,
 * spokes, grids or black construction seams; those live in the editor's
 * optional diagnostic overlay and never become pixels sent to inpainting.
 */
export const plateGuideFragment = tgpu
  .fragmentFn({ in: { uv: d.vec2f }, out: d.vec4f })(
    `{
    let carrier = guideCarrierCoordinateKernel(
      in.uv,
      guide.projection.topology,
      guide.projection.fisheyeScale,
    );

    if (carrier.w < 0.5) {
      return vec4f(0.0, 0.0, 0.0, 1.0);
    }

    let sky = ${wgslVec3Rgb(DOME_HANDOFF_GUIDE.colors.sky)};
    let horizon = ${wgslVec3Rgb(DOME_HANDOFF_GUIDE.colors.horizon)};
    let floor = ${wgslVec3Rgb(CAVE_HANDOFF_GUIDE.colors.floor)};
    let lowerWall = ${wgslVec3Rgb(CAVE_HANDOFF_GUIDE.colors.lowerWall)};
    let upperWall = ${wgslVec3Rgb(CAVE_HANDOFF_GUIDE.colors.upperWall)};
    let darkLowerWall = lowerWall * 0.72;
    let darkUpperWall = upperWall * 0.72;
    let firstAnchor = clamp(guide.projection.innerSplit, 0.0001, 0.9998);
    let secondAnchor = clamp(guide.projection.horizonSplit, firstAnchor + 0.0001, 0.9999);
    let azimuthTint = guideFieldAzimuthKernel(carrier.x, carrier.y);

    if (guide.projection.topology == ${ProjectionTopologyCode.CylinderWall}u) {
      let field = guideFieldColorKernel(
        carrier.z,
        firstAnchor,
        secondAnchor,
        darkLowerWall,
        lowerWall,
        upperWall,
        darkUpperWall,
      );
      let seamContinuousTint = mix(vec3f(0.94, 1.0, 0.98), vec3f(1.03, 0.96, 1.02), 0.5 + 0.5 * sin(in.uv.x * 6.283185307179586));
      return vec4f(clamp(field * seamContinuousTint, vec3f(0.0), vec3f(1.0)), 1.0);
    }

    if (guide.projection.topology == ${ProjectionTopologyCode.CylinderRadial}u) {
      let isZenith = guide.projection.center == ${ProjectionCenterCode.Zenith}u;
      let capColor = select(floor, sky, isZenith);
      let nearWall = select(lowerWall, upperWall, isZenith);
      let farWall = select(upperWall, lowerWall, isZenith);
      let field = guideFieldColorKernel(carrier.z, firstAnchor, secondAnchor, capColor, nearWall, farWall, farWall * 0.72);
      let tint = mix(vec3f(0.95, 1.0, 0.98), vec3f(1.03, 0.96, 1.02), azimuthTint);
      return vec4f(clamp(field * tint, vec3f(0.0), vec3f(1.0)), 1.0);
    }

    if (guide.projection.topology == ${ProjectionTopologyCode.GabledShell}u) {
      let hallPoint = doubleGableCarrierUvToSurfaceKernel(
        in.uv,
        guide.projection.boxSize,
        guide.projection.boxObserver,
        guide.projection.roofProfile,
        firstAnchor,
        secondAnchor,
        guide.projection.physicalHorizon,
      );
      let worldZ = hallPoint.z + guide.projection.boxObserver.z;
      let crossHall = clamp(worldZ / max(guide.projection.boxSize.y, 0.0001) + 0.5, 0.0, 1.0);
      let roofHeight = planarRoofNormalizedHeightKernel(
        worldZ,
        guide.projection.boxSize.y,
        guide.projection.roofProfile,
      );
      let roofLow = mix(upperWall, sky, 0.24);
      let roofHigh = mix(sky, horizon, 0.34);
      let roofWave = roofHeight * roofHeight * (3.0 - 2.0 * roofHeight);
      let roofPositionWash = mix(vec3f(0.98, 1.01, 1.03), vec3f(1.02, 0.98, 1.0), crossHall);
      let roofColor = clamp(mix(roofLow, roofHigh, roofWave) * roofPositionWash, vec3f(0.0), vec3f(1.0));
      let field = profiledHallGuideFieldColorKernel(
        carrier.z,
        firstAnchor,
        secondAnchor,
        roofColor,
        lowerWall,
        darkLowerWall,
        azimuthTint,
      );
      return vec4f(field, 1.0);
    }

    if (guide.projection.topology == ${ProjectionTopologyCode.CavePerimeter}u) {
      let field = guideFieldColorKernel(carrier.z, firstAnchor, secondAnchor, floor, lowerWall, upperWall, darkUpperWall);
      let tint = mix(vec3f(0.96, 1.0, 0.98), vec3f(1.03, 0.97, 1.02), azimuthTint);
      return vec4f(clamp(field * tint, vec3f(0.0), vec3f(1.0)), 1.0);
    }

    var field = guideFieldColorKernel(carrier.z, firstAnchor, secondAnchor, sky, horizon, floor, floor * 0.72);
    if (guide.projection.physicalHorizon >= 0.999) {
      field = guideFieldColorKernel(carrier.z, firstAnchor, secondAnchor, sky, horizon, horizon, horizon * 0.78);
    }
    if (guide.projection.center == ${ProjectionCenterCode.Nadir}u) {
      field = guideFieldColorKernel(carrier.z, firstAnchor, secondAnchor, floor, horizon, horizon, sky);
    }
    let tint = mix(vec3f(0.97, 1.0, 0.99), vec3f(1.02, 0.97, 1.01), azimuthTint);
    return vec4f(clamp(field * tint, vec3f(0.0), vec3f(1.0)), 1.0);
  }`,
  )
  .$uses({
    doubleGableCarrierUvToSurfaceKernel: doubleGableCarrierUvToSurfaceGpu,
    guide,
    guideCarrierCoordinateKernel: guideCarrierCoordinateGpu,
    guideFieldAzimuthKernel: guideFieldAzimuthGpu,
    guideFieldColorKernel: guideFieldColorGpu,
    planarRoofNormalizedHeightKernel: planarRoofNormalizedHeightGpu,
    profiledHallGuideFieldColorKernel: profiledHallGuideFieldColorGpu,
  })
  .$name("fragmentMain");

export const plateGuideShader = tgpu.resolve([common.fullScreenTriangle, plateGuideFragment], {
  names: "strict",
});

function wgslFloat(value: number): string {
  return value.toFixed(10).replace(/0+$/, "").replace(/\.$/, ".0");
}

function wgslVec3Rgb(rgb: readonly [number, number, number]): string {
  return `vec3f(${rgb.map((channel) => wgslFloat(channel / 255)).join(", ")})`;
}
