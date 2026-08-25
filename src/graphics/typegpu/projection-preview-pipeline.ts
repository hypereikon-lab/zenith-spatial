import tgpu, { common, d, type TgpuRoot } from "typegpu";
import { caveContinuityDirectionFromSurfaceKernel, caveFloorBoundaryKernel } from "../../kernels/projection/cave.js";
import { ProjectionModeCode, ProjectionTopologyCode } from "../../kernels/projection/constants.js";
import {
  physicalDirectionFromSourceKernel,
  sourceDirectionFromPhysicalKernel,
} from "../../kernels/projection/orientation.js";
import { sourceDirectionToUvKernel, sourceUvToDirectionKernel } from "../../kernels/projection/index.js";
import { planarRoofProfileKernelSchema } from "../../kernels/schemas.js";
import {
  doubleGableCarrierUvToSurfaceKernel,
  planarHallRoofHeightKernel,
} from "../../kernels/projection/double-gable.js";
import {
  planarRoofNearestInteriorAnchorDistanceKernel,
  planarRoofSegmentSlopeKernel,
} from "../../kernels/projection/planar-roof-profile.js";
import { cylinderProjectionPreviewBindings, projectionPreviewBindings } from "./contracts.js";

const surfaceVertex = d.unstruct({
  position: d.float32x3,
  faceUv: d.float32x2,
  face: d.float32,
});

const domeVertex = d.unstruct({ position: d.float32x3 });

export const domeVertexLayout = tgpu.vertexLayout((count: number) => d.disarrayOf(domeVertex, count));
export const surfaceVertexLayout = tgpu.vertexLayout((count: number) => d.disarrayOf(surfaceVertex, count));

const sourceDirectionFromPhysicalGpu = tgpu.fn(
  [d.vec3f, d.f32, d.f32, d.f32],
  d.vec3f,
)(sourceDirectionFromPhysicalKernel);
const physicalDirectionFromSourceGpu = tgpu.fn(
  [d.vec3f, d.f32, d.f32, d.f32],
  d.vec3f,
)(physicalDirectionFromSourceKernel);
const sourceDirectionToUvGpu = tgpu.fn(
  [
    d.vec3f,
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
  ],
  d.vec4f,
)(sourceDirectionToUvKernel);
const sourceUvToDirectionGpu = tgpu.fn(
  [
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
  ],
  d.vec4f,
)(sourceUvToDirectionKernel);
const caveContinuityDirectionFromSurfaceGpu = tgpu.fn(
  [d.vec3f, d.vec3f, d.vec3f],
  d.vec3f,
)(caveContinuityDirectionFromSurfaceKernel);
const caveFloorBoundaryGpu = tgpu.fn([d.f32, d.f32, d.vec3f, d.vec3f], d.vec2f)(caveFloorBoundaryKernel);
const planarHallRoofHeightGpu = tgpu.fn(
  [d.f32, d.vec3f, planarRoofProfileKernelSchema],
  d.f32,
)(planarHallRoofHeightKernel);
const planarRoofNearestInteriorAnchorDistanceGpu = tgpu.fn(
  [d.f32, d.f32, planarRoofProfileKernelSchema],
  d.f32,
)(planarRoofNearestInteriorAnchorDistanceKernel);
const planarRoofSegmentSlopeGpu = tgpu.fn(
  [d.f32, d.f32, planarRoofProfileKernelSchema],
  d.f32,
)(planarRoofSegmentSlopeKernel);
const doubleGableCarrierUvToSurfaceGpu = tgpu.fn(
  [d.vec2f, d.vec3f, d.vec3f, planarRoofProfileKernelSchema, d.f32, d.f32, d.f32],
  d.vec4f,
)(doubleGableCarrierUvToSurfaceKernel);

const preview = projectionPreviewBindings.bound;
const cylinderPreview = cylinderProjectionPreviewBindings.bound;

const sampleSourceColorGpu = tgpu
  .fn(
    [d.vec2f],
    d.vec3f,
  )(
    `(uv) {
    let base = textureSampleLevel(sourceTexture, sourceSampler, uv, 0.0);
    let overlay = textureSampleLevel(sourceOverlayTexture, sourceSampler, uv, 0.0);
    let overlayOpacity = clamp(uniforms.sourceOverlay.x, 0.0, 1.0);
    let overlayAlpha = clamp(overlay.a * overlayOpacity, 0.0, 1.0);
    return clamp(base.rgb * (1.0 - overlayAlpha) + overlay.rgb * overlayOpacity, vec3f(0.0), vec3f(1.0));
  }`,
  )
  .$uses({
    sourceOverlayTexture: preview.overlayTexture,
    sourceSampler: preview.sampler,
    sourceTexture: preview.sourceTexture,
    uniforms: preview.uniforms,
  })
  .$name("sampleSourceColor");

const lineAtGpu = tgpu
  .fn(
    [d.f32, d.f32, d.f32],
    d.f32,
  )(
    `(value, interval, widthFactor) {
    let dist = abs(fract(value / interval + 0.5) - 0.5) * interval;
    let width = max(fwidth(value) * widthFactor, 0.0015);
    return 1.0 - smoothstep(0.0, width, dist);
  }`,
  )
  .$name("lineAt");

const rotate2dGpu = tgpu
  .fn(
    [d.vec2f, d.f32],
    d.vec2f,
  )(
    `(value, angle) {
    let sine = sin(angle);
    let cosine = cos(angle);
    return vec2f(value.x * cosine - value.y * sine, value.x * sine + value.y * cosine);
  }`,
  )
  .$name("rotate2d");

const caveCarrierRhoGpu = tgpu
  .fn(
    [d.vec2f],
    d.f32,
  )(
    `(uv) {
    let local = abs((uv - vec2f(0.5)) * 2.0);
    return max(local.x, local.y);
  }`,
  )
  .$name("caveCarrierRho");

const caveCarrierRayAngleGpu = tgpu
  .fn(
    [d.vec2f],
    d.f32,
  )(
    `(uv) {
    let local = (uv - vec2f(0.5)) * vec2f(2.0, -2.0);
    return atan2(local.x, local.y);
  }`,
  )
  .$name("caveCarrierRayAngle");

export const flatProjectionFragment = tgpu
  .fragmentFn({ in: { uv: d.vec2f }, out: d.vec4f })(
    `{
    if (uniforms.kernel.topology == ${ProjectionTopologyCode.CylinderWall}u) {
      var color = sampleSourceColor(in.uv) * uniforms.exposure;
      let carrierTraversal = 1.0 - in.uv.y;
      let horizonBand = uniforms.kernel.innerSplit;
      let horizon = (1.0 - smoothstep(0.002, 0.012 + fwidth(carrierTraversal) * 2.0, abs(carrierTraversal - horizonBand))) * uniforms.showHorizon;
      let rings = max(
        1.0 - smoothstep(0.002, 0.012 + fwidth(carrierTraversal) * 2.0, abs(carrierTraversal - horizonBand * 0.5)),
        1.0 - smoothstep(0.002, 0.012 + fwidth(carrierTraversal) * 2.0, abs(carrierTraversal - (horizonBand + (1.0 - horizonBand) * 0.5)))
      ) * uniforms.showRings * 0.44;
      let azimuths = lineAt(in.uv.x, 1.0 / 12.0, 1.35) * uniforms.showSpokes * 0.42;
      let seam = max(
        1.0 - smoothstep(0.0, 0.008 + fwidth(in.uv.x) * 2.0, in.uv.x),
        1.0 - smoothstep(0.0, 0.008 + fwidth(in.uv.x) * 2.0, 1.0 - in.uv.x)
      ) * uniforms.showSourceCircle;
      let overlay = clamp(max(max(max(horizon, rings), azimuths), seam) * uniforms.overlayOpacity, 0.0, 0.82);
      color = mix(color, vec3f(0.78, 0.96, 1.0), overlay);
      return vec4f(color, 1.0);
    }
    if (uniforms.kernel.topology == ${ProjectionTopologyCode.CylinderRadial}u) {
      let local = (in.uv - vec2f(0.5)) * vec2f(2.0, -2.0);
      let rho = length(local);
      let insideCarrier = step(rho, 1.0);
      var color = sampleSourceColor(in.uv) * uniforms.exposure;
      let capBand = uniforms.kernel.innerSplit;
      let horizonBand = uniforms.kernel.horizonSplit;
      let rayAngle = atan2(local.x, local.y);
      let center = (1.0 - smoothstep(0.0, 0.018 + fwidth(rho) * 2.0, rho)) * uniforms.showZenith;
      let capSeam = (1.0 - smoothstep(0.002, 0.012 + fwidth(rho) * 2.0, abs(rho - capBand))) * uniforms.showSourceCircle;
      let eyeHorizon = (1.0 - smoothstep(0.002, 0.012 + fwidth(rho) * 2.0, abs(rho - horizonBand))) * uniforms.showHorizon;
      let boundary = (1.0 - smoothstep(0.002, 0.012 + fwidth(rho) * 2.0, abs(rho - 1.0))) * uniforms.showSourceCircle;
      let wallMask = smoothstep(capBand + 0.006, capBand + 0.026, rho);
      let rings = max(
        (1.0 - smoothstep(0.002, 0.012 + fwidth(rho) * 2.0, abs(rho - mix(capBand, horizonBand, 0.5)))) * uniforms.showRings,
        (1.0 - smoothstep(0.002, 0.012 + fwidth(rho) * 2.0, abs(rho - mix(horizonBand, 1.0, 0.5)))) * uniforms.showRings
      ) * 0.44;
      let spokes = lineAt(rayAngle, 3.141592653589793 / 12.0, 1.35) * wallMask * uniforms.showSpokes * 0.42;
      let overlay = clamp(max(max(max(max(max(center, capSeam), eyeHorizon), boundary), rings), spokes) * uniforms.overlayOpacity, 0.0, 0.82);
      color = mix(color, vec3f(0.78, 0.96, 1.0), overlay);
      return vec4f(color * insideCarrier, 1.0);
    }
    if (
      uniforms.kernel.topology == ${ProjectionTopologyCode.CavePerimeter}u ||
      uniforms.kernel.topology == ${ProjectionTopologyCode.GabledShell}u
    ) {
      var color = sampleSourceColor(in.uv) * uniforms.exposure;
      let rho = caveCarrierRho(in.uv);
      let floorBand = uniforms.kernel.innerSplit;
      let horizonBand = uniforms.kernel.horizonSplit;
      let rayAngle = caveCarrierRayAngle(in.uv);
      let center = (1.0 - smoothstep(0.0, 0.018 + fwidth(rho) * 2.0, rho)) * uniforms.showZenith;
      let floorSeam = (1.0 - smoothstep(0.002, 0.012 + fwidth(rho) * 2.0, abs(rho - floorBand))) * uniforms.showSourceCircle;
      let eyeHorizon = (1.0 - smoothstep(0.002, 0.012 + fwidth(rho) * 2.0, abs(rho - horizonBand))) * uniforms.showHorizon;
      let boundary = (1.0 - smoothstep(0.002, 0.012 + fwidth(rho) * 2.0, abs(rho - 1.0))) * uniforms.showSourceCircle;
      let wallMask = smoothstep(floorBand + 0.015, floorBand + 0.055, rho);
      let carrierLocal = (in.uv - vec2f(0.5)) * 2.0;
      let wallCornerDistance = abs(abs(carrierLocal.x) - abs(carrierLocal.y));
      let wallCorners = (1.0 - smoothstep(0.0, max(fwidth(wallCornerDistance) * 1.6, 0.003), wallCornerDistance)) * wallMask * uniforms.showSourceCircle * 0.62;
      let rings = max(
        (1.0 - smoothstep(0.002, 0.012 + fwidth(rho) * 2.0, abs(rho - mix(floorBand, horizonBand, 0.5)))) * uniforms.showRings,
        (1.0 - smoothstep(0.002, 0.012 + fwidth(rho) * 2.0, abs(rho - mix(horizonBand, 1.0, 0.5)))) * uniforms.showRings
      ) * 0.44;
      let spokes = lineAt(rayAngle, 3.141592653589793 / 6.0, 1.35) * wallMask * uniforms.showSpokes * 0.42;
      let roofPoint = doubleGableCarrierUvToSurfaceKernel(
        in.uv,
        uniforms.kernel.boxSize,
        uniforms.kernel.boxObserver,
        uniforms.kernel.roofProfile,
        floorBand,
        horizonBand,
        uniforms.kernel.physicalHorizon,
      );
      let worldZ = roofPoint.z + uniforms.kernel.boxObserver.z;
      let profileDistance = planarRoofNearestInteriorAnchorDistanceKernel(
        worldZ,
        uniforms.kernel.boxSize.y,
        uniforms.kernel.roofProfile,
      );
      let profileWidth = max(fwidth(worldZ) * 1.75, 0.008);
      let roofStructure = (1.0 - smoothstep(0.0, profileWidth, profileDistance))
        * uniforms.showSourceCircle
        * step(rho, floorBand + 0.0001)
        * select(0.0, 0.72, uniforms.kernel.topology == ${ProjectionTopologyCode.GabledShell}u);
      let overlay = clamp(max(max(max(max(max(max(max(center, floorSeam), eyeHorizon), boundary), wallCorners), rings), spokes), roofStructure) * uniforms.overlayOpacity, 0.0, 0.82);
      color = mix(color, vec3f(0.78, 0.96, 1.0), overlay);
      return vec4f(color, 1.0);
    }

    let fisheyeScale = max(uniforms.kernel.fisheyeScale, vec2f(0.0001));
    let normalized = (in.uv - vec2f(0.5)) / fisheyeScale;
    let radius = length(normalized);
    let insideMask = step(radius, 1.0);
    let rotatedSample = rotate2d(normalized, uniforms.rotation);
    let sampleUv = vec2f(0.5) + rotatedSample * fisheyeScale;
    let sampledColor = sampleSourceColor(sampleUv) * uniforms.exposure;
    var color = select(sampledColor, vec3f(0.0), radius > 1.0);
    let directionSample = sourceUvToDirectionKernel(
      in.uv,
      uniforms.kernel.mode,
      uniforms.kernel.topology,
      uniforms.kernel.flags,
      uniforms.kernel.fisheyeScale,
      uniforms.kernel.halfAngle,
      uniforms.kernel.innerSplit,
      uniforms.kernel.horizonSplit,
      uniforms.kernel.physicalSemantic,
      uniforms.kernel.physicalHorizon,
      uniforms.kernel.centerAxis,
      uniforms.kernel.imageRightAxis,
      uniforms.kernel.imageUpAxis,
      uniforms.kernel.boxSize,
      uniforms.kernel.boxObserver,
      uniforms.kernel.roofProfile,
      uniforms.kernel.doubleGable,
      uniforms.kernel.cylinder,
    );
    let sourceDirection = normalize(directionSample.xyz);
    let centerDot = clamp(dot(sourceDirection, uniforms.kernel.centerAxis), -1.0, 1.0);
    let theta = acos(centerDot);
    var angle = uniforms.rotation;
    if (theta > 0.000001) {
      let tangent = normalize(sourceDirection - uniforms.kernel.centerAxis * centerDot);
      angle = angle + atan2(dot(tangent, uniforms.kernel.imageRightAxis), dot(tangent, uniforms.kernel.imageUpAxis));
    }
    let splitLine = (1.0 - smoothstep(0.002, 0.012 + fwidth(radius) * 2.0, abs(radius - uniforms.kernel.innerSplit))) * insideMask * uniforms.showHorizon;
    let ring = lineAt(theta, 3.141592653589793 / 12.0, 1.4) * insideMask * uniforms.showRings;
    let spoke = lineAt(angle, 3.141592653589793 / 12.0, 1.4) * insideMask * uniforms.showSpokes;
    let horizon = (1.0 - smoothstep(0.002, 0.01 + fwidth(theta) * 2.0, abs(theta - 1.5707963267948966))) * insideMask * uniforms.showHorizon;
    let sourceCircle = (1.0 - smoothstep(0.002, 0.012 + fwidth(radius) * 2.0, abs(radius - 1.0))) * insideMask * uniforms.showSourceCircle;
    let overlay = clamp(max(max(max(max(ring * 0.4, spoke * 0.38), horizon), sourceCircle), splitLine) * uniforms.overlayOpacity, 0.0, 0.82);
    color = mix(color, vec3f(0.78, 0.96, 1.0), overlay);
    return vec4f(color, 1.0);
  }`,
  )
  .$uses({
    caveCarrierRayAngle: caveCarrierRayAngleGpu,
    caveCarrierRho: caveCarrierRhoGpu,
    doubleGableCarrierUvToSurfaceKernel: doubleGableCarrierUvToSurfaceGpu,
    lineAt: lineAtGpu,
    planarRoofNearestInteriorAnchorDistanceKernel: planarRoofNearestInteriorAnchorDistanceGpu,
    rotate2d: rotate2dGpu,
    sampleSourceColor: sampleSourceColorGpu,
    sourceUvToDirectionKernel: sourceUvToDirectionGpu,
    uniforms: preview.uniforms,
  })
  .$name("flatProjectionFragment");

const sourceDirectionFromPhysicalPreviewGpu = tgpu
  .fn(
    [d.vec3f],
    d.vec3f,
  )(
    `(physicalDir) {
    return sourceDirectionFromPhysicalKernel(physicalDir, uniforms.rotation, uniforms.domeTilt, uniforms.mirror);
  }`,
  )
  .$uses({ sourceDirectionFromPhysicalKernel: sourceDirectionFromPhysicalGpu, uniforms: preview.uniforms })
  .$name("sourceDirectionFromPhysical");

const physicalDirectionFromSourcePreviewGpu = tgpu
  .fn(
    [d.vec3f],
    d.vec3f,
  )(
    `(sourceDir) {
    return physicalDirectionFromSourceKernel(sourceDir, uniforms.rotation, uniforms.domeTilt, uniforms.mirror);
  }`,
  )
  .$uses({ physicalDirectionFromSourceKernel: physicalDirectionFromSourceGpu, uniforms: preview.uniforms })
  .$name("physicalDirectionFromSource");

const sourceSampleGpu = tgpu
  .fn(
    [d.vec3f],
    d.vec3f,
  )(
    `(sourceDir) {
    let sample = sourceDirectionToUvKernel(
      sourceDir,
      uniforms.kernel.mode,
      uniforms.kernel.topology,
      uniforms.kernel.flags,
      uniforms.kernel.fisheyeScale,
      uniforms.kernel.halfAngle,
      uniforms.kernel.innerSplit,
      uniforms.kernel.horizonSplit,
      uniforms.kernel.physicalSemantic,
      uniforms.kernel.physicalHorizon,
      uniforms.kernel.centerAxis,
      uniforms.kernel.imageRightAxis,
      uniforms.kernel.imageUpAxis,
      uniforms.kernel.boxSize,
      uniforms.kernel.boxObserver,
      uniforms.kernel.roofProfile,
      uniforms.kernel.doubleGable,
      uniforms.kernel.cylinder,
    );
    return vec3f(sample.xy, sample.z);
  }`,
  )
  .$uses({ sourceDirectionToUvKernel: sourceDirectionToUvGpu, uniforms: preview.uniforms })
  .$name("sourceSample");

export const domeProjectionVertex = tgpu
  .vertexFn({
    in: { position: d.vec3f },
    out: { position: d.builtin.position, world: d.vec3f },
  })(
    `{
    let physical = physicalDirectionFromSource(in.position);
    return Out(uniforms.mvp * vec4f(physical, 1.0), physical);
  }`,
  )
  .$uses({ physicalDirectionFromSource: physicalDirectionFromSourcePreviewGpu, uniforms: preview.uniforms })
  .$name("domeProjectionVertex");

export const domeProjectionFragment = tgpu
  .fragmentFn({ in: { position: d.builtin.position, world: d.vec3f }, out: d.vec4f })(
    `{
    if (uniforms.showCaveMask > 0.5) {
      let isFirstPixel = u32(in.position.x) % 2u == 0u && u32(in.position.y) % 2u == 0u;
      if ((uniforms.showCaveMask > 1.5 && isFirstPixel) || (uniforms.showCaveMask <= 1.5 && !isFirstPixel)) {
        discard;
      }
    }
    let physicalDir = normalize(in.world);
    if (uniforms.cutaway > 0.5 && physicalDir.x < -0.025) {
      discard;
    }
    let sourceDir = sourceDirectionFromPhysical(physicalDir);
    let sample = sourceSample(sourceDir);
    var color = sampleSourceColor(clamp(sample.xy, vec2f(0.0), vec2f(1.0))) * uniforms.exposure;
    color = select(vec3f(0.0), color, sample.z > 0.5);
    color = color * mix(1.0, 0.66 + 0.34 * smoothstep(0.0, 1.0, physicalDir.y), uniforms.shellShade);
    let center = normalize(uniforms.kernel.centerAxis);
    let centerDot = clamp(dot(sourceDir, center), -1.0, 1.0);
    let theta = acos(centerDot);
    var azimuth = 0.0;
    if (theta > 0.000001) {
      let tangent = normalize(sourceDir - center * centerDot);
      azimuth = atan2(dot(tangent, uniforms.kernel.imageRightAxis), dot(tangent, uniforms.kernel.imageUpAxis));
    }
    let thetaMax = max(uniforms.kernel.halfAngle, 0.0001);
    let horizon = uniforms.kernel.physicalHorizon;
    let semanticPhysical = clamp(horizon * 0.5, 0.0001, max(horizon - 0.0001, 0.0001));
    let centerLine = (1.0 - smoothstep(0.0, 0.022 + fwidth(theta) * 2.0, theta)) * uniforms.showZenith;
    let splitLine = (1.0 - smoothstep(0.002, 0.012 + fwidth(theta) * 2.0, abs(theta - semanticPhysical * thetaMax))) * uniforms.showHorizon;
    let horizonLine = (1.0 - smoothstep(0.002, 0.012 + fwidth(theta) * 2.0, abs(theta - horizon * thetaMax))) * uniforms.showHorizon;
    let boundaryLine = (1.0 - smoothstep(0.002, 0.012 + fwidth(theta) * 2.0, abs(theta - thetaMax))) * uniforms.showSourceCircle;
    let rings = max(
      max(
        (1.0 - smoothstep(0.002, 0.012 + fwidth(theta) * 2.0, abs(theta - semanticPhysical * 0.5 * thetaMax))) * uniforms.showRings,
        (1.0 - smoothstep(0.002, 0.012 + fwidth(theta) * 2.0, abs(theta - mix(semanticPhysical, horizon, 0.5) * thetaMax))) * uniforms.showRings
      ),
      (1.0 - smoothstep(0.002, 0.012 + fwidth(theta) * 2.0, abs(theta - mix(horizon, 1.0, 0.5) * thetaMax))) * uniforms.showRings
    ) * 0.44;
    let spokes = lineAt(azimuth, 3.141592653589793 / 12.0, 1.35) * uniforms.showSpokes * 0.42;
    let overlay = clamp(max(max(max(max(max(centerLine, splitLine), horizonLine), boundaryLine), rings), spokes) * uniforms.overlayOpacity, 0.0, 0.82);
    color = mix(color, vec3f(0.78, 0.96, 1.0), overlay);
    color = color + vec3f(0.08, 0.12, 0.13) * horizonLine * uniforms.shellShade;
    return vec4f(color, 1.0);
  }`,
  )
  .$uses({
    lineAt: lineAtGpu,
    sampleSourceColor: sampleSourceColorGpu,
    sourceDirectionFromPhysical: sourceDirectionFromPhysicalPreviewGpu,
    sourceSample: sourceSampleGpu,
    uniforms: preview.uniforms,
  })
  .$name("domeProjectionFragment");

const surfaceProjectionVertex = tgpu
  .vertexFn({
    in: { position: d.vec3f, faceUv: d.vec2f, face: d.f32 },
    out: { position: d.builtin.position, world: d.vec3f, faceUv: d.vec2f, face: d.f32 },
  })(
    `{
    return Out(uniforms.mvp * vec4f(in.position, 1.0), in.position, in.faceUv, in.face);
  }`,
  )
  .$uses({ uniforms: preview.uniforms })
  .$name("surfaceProjectionVertex");

const caveContinuityDirectionGpu = tgpu
  .fn(
    [d.vec3f],
    d.vec3f,
  )(
    `(point) {
    return caveContinuityDirectionFromSurfaceKernel(point, uniforms.kernel.boxSize, uniforms.kernel.boxObserver);
  }`,
  )
  .$uses({
    caveContinuityDirectionFromSurfaceKernel: caveContinuityDirectionFromSurfaceGpu,
    uniforms: preview.uniforms,
  })
  .$name("continuityPhysicalDirectionFromCavePoint");

const getFaceNormalGpu = tgpu
  .fn(
    [d.f32],
    d.vec3f,
  )(
    `(face) {
      let faceIndex = max(floor(face + 0.5), 0.0);
    if (faceIndex == 0.0) { return vec3f(0.0, 0.0, -1.0); }
    if (faceIndex == 1.0) { return vec3f(-1.0, 0.0, 0.0); }
    if (faceIndex == 2.0) { return vec3f(0.0, 0.0, 1.0); }
    if (faceIndex == 3.0) { return vec3f(1.0, 0.0, 0.0); }
    if (uniforms.kernel.topology == ${ProjectionTopologyCode.GabledShell}u) {
      let slope = planarRoofSegmentSlopeKernel(
        faceIndex - 4.0,
        uniforms.kernel.boxSize.y,
        uniforms.kernel.roofProfile,
      );
      return normalize(vec3f(0.0, -1.0, slope));
    }
    return vec3f(0.0, 1.0, 0.0);
  }`,
  )
  .$uses({ planarRoofSegmentSlopeKernel: planarRoofSegmentSlopeGpu, uniforms: preview.uniforms })
  .$name("getFaceNormal");

const edgeLineGpu = tgpu
  .fn(
    [d.f32],
    d.f32,
  )(
    `(value) {
    let dist = min(abs(value), abs(1.0 - value));
    let width = max(fwidth(value) * 2.0, 0.002);
    return 1.0 - smoothstep(0.0, width, dist);
  }`,
  )
  .$name("edgeLine");

export const caveProjectionFragment = tgpu
  .fragmentFn({
    in: { position: d.builtin.position, world: d.vec3f, faceUv: d.vec2f, face: d.f32 },
    out: d.vec4f,
  })(
    `{
    if (uniforms.showCaveMask > 0.5) {
      let cameraPos = vec3f(uniforms.cameraPosX, uniforms.cameraPosY, uniforms.cameraPosZ);
      let viewDir = normalize(in.world - cameraPos);
      if (dot(viewDir, getFaceNormal(in.face)) > 0.0) {
        let isFirstPixel = u32(in.position.x) % 2u == 0u && u32(in.position.y) % 2u == 0u;
        if ((uniforms.showCaveMask > 1.5 && isFirstPixel) || (uniforms.showCaveMask <= 1.5 && !isFirstPixel)) {
          discard;
        }
      }
    }
    var continuityPhysicalDir = continuityPhysicalDirectionFromCavePoint(in.world);
    if (uniforms.kernel.topology == ${ProjectionTopologyCode.GabledShell}u) {
      continuityPhysicalDir = normalize(in.world);
    }
    let sourceDir = sourceDirectionFromPhysical(continuityPhysicalDir);
    let sample = sourceSample(sourceDir);
    let sampledColor = sampleSourceColor(clamp(sample.xy, vec2f(0.0), vec2f(1.0))) * uniforms.exposure;
    var color = select(vec3f(0.006, 0.008, 0.009), sampledColor, sample.z > 0.5);
    let bottomY = -uniforms.kernel.boxObserver.y;
    let topY = uniforms.kernel.boxSize.z - uniforms.kernel.boxObserver.y;
    var surfaceTopY = topY;
    if (uniforms.kernel.topology == ${ProjectionTopologyCode.GabledShell}u) {
      surfaceTopY = planarHallRoofHeightKernel(
        in.world.z + uniforms.kernel.boxObserver.z,
        uniforms.kernel.boxSize,
        uniforms.kernel.roofProfile,
      ) - uniforms.kernel.boxObserver.y;
    }
    let heightShade = 0.78 + 0.22 * smoothstep(bottomY, topY, in.world.y);
    color = color * mix(1.0, heightShade * select(1.0, 0.86, in.face > 3.5), uniforms.shellShade);
    let boundaryPt = caveFloorBoundaryKernel(in.world.x, in.world.z, uniforms.kernel.boxSize, uniforms.kernel.boxObserver);
    let rhoFloorVal = clamp(length(in.world.xz) / max(length(boundaryPt), 0.000001), 0.0, 1.0);
    let rayAngle = atan2(continuityPhysicalDir.x, continuityPhysicalDir.z);
    let fwidthY = fwidth(in.world.y);
    let fwidthRhoFloor = fwidth(rhoFloorVal);
    let fwidthWorldZ = fwidth(in.world.z);
    var center = 0.0;
    var capSeam = 0.0;
    var eyeHorizon = 0.0;
    var boundary = 0.0;
    var rings = 0.0;
    var roofStructure = 0.0;
    if (in.face > 3.5) {
      center = (1.0 - smoothstep(0.0, 0.018 + fwidthRhoFloor * 2.0, rhoFloorVal)) * uniforms.showZenith;
      capSeam = (1.0 - smoothstep(0.002, 0.012 + fwidthRhoFloor * 2.0, abs(rhoFloorVal - 1.0))) * uniforms.showSourceCircle;
      rings = (1.0 - smoothstep(0.002, 0.012 + fwidthRhoFloor * 2.0, abs(rhoFloorVal - 0.5))) * uniforms.showRings * 0.44;
      if (uniforms.kernel.topology == ${ProjectionTopologyCode.GabledShell}u) {
        let worldZ = in.world.z + uniforms.kernel.boxObserver.z;
        let roofLineWidth = max(fwidthWorldZ * 1.75, 0.008);
        let profileDistance = planarRoofNearestInteriorAnchorDistanceKernel(worldZ, uniforms.kernel.boxSize.y, uniforms.kernel.roofProfile);
        roofStructure = (1.0 - smoothstep(0.0, roofLineWidth, profileDistance)) * uniforms.showSourceCircle * 0.72;
      }
    } else {
      eyeHorizon = (1.0 - smoothstep(0.002, 0.012 + fwidthY * 2.0, abs(in.world.y))) * uniforms.showHorizon;
      if (uniforms.kernel.topology == ${ProjectionTopologyCode.GabledShell}u) {
        capSeam = (1.0 - smoothstep(0.002, 0.012 + fwidthY * 2.0, abs(in.world.y - surfaceTopY))) * uniforms.showSourceCircle;
        boundary = (1.0 - smoothstep(0.002, 0.012 + fwidthY * 2.0, abs(in.world.y - bottomY))) * uniforms.showSourceCircle;
      } else {
        capSeam = (1.0 - smoothstep(0.002, 0.012 + fwidthY * 2.0, abs(in.world.y - bottomY))) * uniforms.showSourceCircle;
        boundary = (1.0 - smoothstep(0.002, 0.012 + fwidthY * 2.0, abs(in.world.y - surfaceTopY))) * uniforms.showSourceCircle;
      }
      let ringBelow = (1.0 - smoothstep(0.002, 0.012 + fwidthY * 2.0, abs(in.world.y - mix(bottomY, 0.0, 0.5)))) * uniforms.showRings;
      let ringAbove = (1.0 - smoothstep(0.002, 0.012 + fwidthY * 2.0, abs(in.world.y - mix(0.0, surfaceTopY, 0.5)))) * uniforms.showRings;
      rings = max(ringBelow, ringAbove) * 0.44;
    }
    let spokes = lineAt(rayAngle, 3.141592653589793 / 6.0, 1.35) * select(0.0, 1.0, in.face <= 3.5) * uniforms.showSpokes * 0.42;
    let faceEdge = max(edgeLine(in.faceUv.x), edgeLine(in.faceUv.y)) * uniforms.showSourceCircle * 0.35;
    let overlay = clamp(max(max(max(max(max(max(max(center, capSeam), eyeHorizon), boundary), rings), roofStructure), spokes), faceEdge) * uniforms.overlayOpacity, 0.0, 0.82);
    color = mix(color, vec3f(0.78, 0.96, 1.0), overlay);
    return vec4f(color, 1.0);
  }`,
  )
  .$uses({
    caveFloorBoundaryKernel: caveFloorBoundaryGpu,
    continuityPhysicalDirectionFromCavePoint: caveContinuityDirectionGpu,
    planarRoofNearestInteriorAnchorDistanceKernel: planarRoofNearestInteriorAnchorDistanceGpu,
    edgeLine: edgeLineGpu,
    planarHallRoofHeightKernel: planarHallRoofHeightGpu,
    getFaceNormal: getFaceNormalGpu,
    lineAt: lineAtGpu,
    sampleSourceColor: sampleSourceColorGpu,
    sourceDirectionFromPhysical: sourceDirectionFromPhysicalPreviewGpu,
    sourceSample: sourceSampleGpu,
    uniforms: preview.uniforms,
  })
  .$name("caveProjectionFragment");

const cylinderSourceDirectionFromPhysicalGpu = tgpu
  .fn(
    [d.vec3f],
    d.vec3f,
  )(
    `(physicalDir) {
    return sourceDirectionFromPhysicalKernel(physicalDir, uniforms.rotation, uniforms.domeTilt, uniforms.mirror);
  }`,
  )
  .$uses({ sourceDirectionFromPhysicalKernel: sourceDirectionFromPhysicalGpu, uniforms: cylinderPreview.uniforms })
  .$name("cylinderSourceDirectionFromPhysical");

const cylinderSampleSourceGpu = tgpu
  .fn(
    [d.vec2f, d.vec2f, d.bool],
    d.vec3f,
  )(
    `(uv, capUv, useCapDetail) {
    let carrier = textureSampleLevel(sourceTexture, sourceSampler, uv, 0.0);
    let capDetail = textureSampleLevel(sourceCapDetailTexture, sourceSampler, capUv, 0.0);
    let base = select(carrier, capDetail, useCapDetail && uniforms.sourceOverlay.y > 0.5);
    let overlay = textureSampleLevel(sourceOverlayTexture, sourceSampler, uv, 0.0);
    let overlayOpacity = clamp(uniforms.sourceOverlay.x, 0.0, 1.0);
    let overlayAlpha = clamp(overlay.a * overlayOpacity, 0.0, 1.0);
    return clamp(base.rgb * (1.0 - overlayAlpha) + overlay.rgb * overlayOpacity, vec3f(0.0), vec3f(1.0));
  }`,
  )
  .$uses({
    sourceCapDetailTexture: cylinderPreview.capDetailTexture,
    sourceOverlayTexture: cylinderPreview.overlayTexture,
    sourceSampler: cylinderPreview.sampler,
    sourceTexture: cylinderPreview.sourceTexture,
    uniforms: cylinderPreview.uniforms,
  })
  .$name("cylinderSampleSource");

const cylinderProjectionVertex = tgpu
  .vertexFn({
    in: { position: d.vec3f, faceUv: d.vec2f, face: d.f32 },
    out: { position: d.builtin.position, world: d.vec3f, faceUv: d.vec2f, face: d.f32 },
  })(
    `{
    return Out(uniforms.mvp * vec4f(in.position, 1.0), in.position, in.faceUv, in.face);
  }`,
  )
  .$uses({ uniforms: cylinderPreview.uniforms })
  .$name("cylinderProjectionVertex");

export const cylinderProjectionFragment = tgpu
  .fragmentFn({ in: { world: d.vec3f, faceUv: d.vec2f, face: d.f32 }, out: d.vec4f })(
    `{
    if (uniforms.cutaway > 0.5 && in.world.x < -0.025) { discard; }
    let isUnwrapped = uniforms.kernel.topology == ${ProjectionTopologyCode.CylinderWall}u;
    if (isUnwrapped && in.face > 0.5) { discard; }
    let sourceDirection = sourceDirectionFromPhysical(normalize(in.world));
    let sourceSample = sourceDirectionToUvKernel(
      sourceDirection,
      uniforms.kernel.mode,
      uniforms.kernel.topology,
      uniforms.kernel.flags,
      uniforms.kernel.fisheyeScale,
      uniforms.kernel.halfAngle,
      uniforms.kernel.innerSplit,
      uniforms.kernel.horizonSplit,
      uniforms.kernel.physicalSemantic,
      uniforms.kernel.physicalHorizon,
      uniforms.kernel.centerAxis,
      uniforms.kernel.imageRightAxis,
      uniforms.kernel.imageUpAxis,
      uniforms.kernel.boxSize,
      uniforms.kernel.boxObserver,
      uniforms.kernel.roofProfile,
      uniforms.kernel.doubleGable,
      uniforms.kernel.cylinder,
    );
    let uv = sourceSample.xy;
    let capBand = max(uniforms.kernel.innerSplit, 0.000001);
    let carrierLocal = (uv - vec2f(0.5)) * 2.0;
    let carrierRho = length(carrierLocal);
    let capUv = vec2f(0.5) + carrierLocal / capBand * 0.5;
    let useCapDetail = !isUnwrapped && carrierRho <= capBand + 0.0001;
    var color = select(
      vec3f(0.006, 0.008, 0.009),
      sampleSource(uv, clamp(capUv, vec2f(0.0), vec2f(1.0)), useCapDetail) * uniforms.exposure,
      sourceSample.z > 0.5
    );
    let bottom = -uniforms.kernel.cylinder.z;
    let top = uniforms.kernel.cylinder.y - uniforms.kernel.cylinder.z;
    let heightT = clamp((in.world.y - bottom) / max(uniforms.kernel.cylinder.y, 0.001), 0.0, 1.0);
    color = color * mix(1.0, 0.76 + 0.24 * heightT, uniforms.shellShade);
    let cap = in.face > 0.5;
    let radial = length(in.world.xz) / max(uniforms.kernel.cylinder.x, 0.001);
    let azimuth = atan2(in.world.x, in.world.z);
    let center = (1.0 - smoothstep(0.0, 0.018 + fwidth(radial) * 2.0, radial)) * uniforms.showZenith * select(0.0, 1.0, cap);
    let capEdge = (1.0 - smoothstep(0.002, 0.012 + fwidth(radial) * 2.0, abs(radial - 1.0))) * uniforms.showSourceCircle * select(0.0, 1.0, cap);
    let eyeHorizon = (1.0 - smoothstep(0.002, 0.012 + fwidth(in.world.y) * 2.0, abs(in.world.y))) * uniforms.showHorizon * select(1.0, 0.0, cap);
    let farEdgeY = select(top, bottom, uniforms.kernel.mode == ${ProjectionModeCode.CylinderZenith}u && !isUnwrapped);
    let farEdge = (1.0 - smoothstep(0.002, 0.012 + fwidth(in.world.y) * 2.0, abs(in.world.y - farEdgeY))) * uniforms.showSourceCircle * select(1.0, 0.0, cap);
    let rings = lineAt(heightT, 0.25, 1.35) * uniforms.showRings * select(1.0, 0.0, cap) * 0.44;
    let spokes = lineAt(azimuth, 3.141592653589793 / 12.0, 1.35) * uniforms.showSpokes * 0.42;
    let mappedSurface = select(1.0, sourceSample.z, isUnwrapped);
    let overlay = clamp(max(max(max(max(max(center, capEdge), eyeHorizon), farEdge), rings), spokes) * uniforms.overlayOpacity * mappedSurface, 0.0, 0.82);
    color = mix(color, vec3f(0.78, 0.96, 1.0), overlay);
    return vec4f(color, 1.0);
  }`,
  )
  .$uses({
    lineAt: lineAtGpu,
    sampleSource: cylinderSampleSourceGpu,
    sourceDirectionFromPhysical: cylinderSourceDirectionFromPhysicalGpu,
    sourceDirectionToUvKernel: sourceDirectionToUvGpu,
    uniforms: cylinderPreview.uniforms,
  })
  .$name("cylinderProjectionFragment");

/**
 * Resolved WGSL evidence is exported for parity probes and shader-contract
 * tests. Production renderers consume the typed entry points and pipelines
 * below; there is no second handwritten shader implementation.
 */
export const flatShaderCode = tgpu.resolve([common.fullScreenTriangle, flatProjectionFragment], {
  names: "strict",
});
export const domeShaderCode = tgpu.resolve([domeProjectionVertex, domeProjectionFragment], {
  names: "strict",
});
export const caveShaderCode = tgpu.resolve([surfaceProjectionVertex, caveProjectionFragment], {
  names: "strict",
});
export const cylinderShaderCode = tgpu.resolve([cylinderProjectionVertex, cylinderProjectionFragment], {
  names: "strict",
});

export function createProjectionPreviewPipelines(root: TgpuRoot, format: GPUTextureFormat) {
  const depthStencil: GPUDepthStencilState = {
    depthWriteEnabled: true,
    depthCompare: "less",
    format: "depth24plus",
  };
  return {
    flat: root.createRenderPipeline({
      vertex: common.fullScreenTriangle,
      fragment: flatProjectionFragment,
      targets: { format },
      primitive: { topology: "triangle-list" },
    }),
    dome: root.createRenderPipeline({
      attribs: domeVertexLayout.attrib,
      vertex: domeProjectionVertex,
      fragment: domeProjectionFragment,
      targets: { format },
      primitive: { topology: "triangle-list", cullMode: "none" },
      depthStencil,
    }),
    cave: root.createRenderPipeline({
      attribs: surfaceVertexLayout.attrib,
      vertex: surfaceProjectionVertex,
      fragment: caveProjectionFragment,
      targets: { format },
      primitive: { topology: "triangle-list", cullMode: "none" },
      depthStencil,
    }),
    cylinder: root.createRenderPipeline({
      attribs: surfaceVertexLayout.attrib,
      vertex: cylinderProjectionVertex,
      fragment: cylinderProjectionFragment,
      targets: { format },
      primitive: { topology: "triangle-list", cullMode: "none" },
      depthStencil,
    }),
  };
}

export type ProjectionPreviewPipelines = ReturnType<typeof createProjectionPreviewPipelines>;
