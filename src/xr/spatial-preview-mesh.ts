import type { AudienceInSpace, ImageSpatialSpec } from "../domain/schema.js";
import { d } from "typegpu";
import {
  createCaveContinuityCarrierProfile,
  caveContinuitySurfacePointToUv,
} from "../geometry/cave-continuity-carrier.js";
import {
  createCylinderContinuityCarrierProfile,
  cylinderContinuitySurfacePointToUv,
} from "../geometry/cylinder-continuity-carrier.js";
import { audienceVenuePlan } from "../geometry/audience-in-space.js";
import { compileProjectionKernelParams } from "../geometry/projection-kernel-parameters.js";
import { sourceProjectionGeometryRange } from "../geometry/source-projection.js";
import {
  buildCaveRoomGeometry,
  buildCylinderRoomGeometry,
  buildDomeGeometry,
  buildDoubleGableRoomGeometry,
} from "../graphics/geometry.js";
import { normalizeProjectionSurfaceForMode } from "../lib/shared/contracts/projection-authoring.js";
import { sourceDirectionToUvKernel } from "../kernels/projection/index.js";
import { normalize, type Vec3 } from "../projection.js";

export type ImmersiveCarrierMesh = {
  /** Interleaved physical XYZ and portable source UV. */
  readonly vertices: Float32Array;
  readonly indices: Uint32Array;
};

export type ImmersiveArPlacement = {
  readonly scale: number;
  readonly scaleDenominator: number;
  readonly modelMatrix: Float32Array;
};

type SourceGeometry = {
  readonly vertices: Float32Array;
  readonly indices: Uint32Array;
  readonly vertexStrideFloats?: number;
};

const DEFAULT_SUBDIVISION_DEPTH = 2;

export function buildImmersiveCarrierMesh(spec: ImageSpatialSpec, audience: AudienceInSpace): ImmersiveCarrierMesh {
  const surface = normalizeProjectionSurfaceForMode(spec.surface, spec.projectionMode);
  const source = sourceGeometry(spec, audience);
  const stride = source.vertexStrideFloats ?? 3;
  const mappedVertices: number[] = [];
  const mappedIndices: number[] = [];
  const caveProfile =
    surface.kind === "box-room"
      ? createCaveContinuityCarrierProfile({
          width: spec.targetWidth,
          height: spec.targetHeight,
          room: surface,
          floorBand: spec.guideSplit,
          horizonBand: spec.horizonSplit,
        })
      : null;
  const cylinderProfile =
    surface.kind === "cylinder" && spec.projectionMode !== "cylinder-wall"
      ? createCylinderContinuityCarrierProfile({
          mode: spec.projectionMode === "cylinder-nadir" ? "cylinder-nadir" : "cylinder-zenith",
          width: spec.targetWidth,
          height: spec.targetHeight,
          room: surface,
          capBand: spec.guideSplit,
          horizonBand: spec.horizonSplit,
        })
      : null;
  const kernel = compileProjectionKernelParams({
    mode: spec.projectionMode,
    width: spec.targetWidth,
    height: spec.targetHeight,
    radiusScale: 1,
    innerSplit: spec.guideSplit,
    horizonSplit: spec.horizonSplit,
    surface,
  });

  const uvForPoint = (point: Vec3) => {
    if (caveProfile) return caveContinuitySurfacePointToUv(point, caveProfile);
    if (cylinderProfile) return cylinderContinuitySurfacePointToUv(point, cylinderProfile);
    const direction = normalize(point);
    const sample = sourceDirectionToUvKernel(
      d.vec3f(direction[0], direction[1], direction[2]),
      kernel.mode,
      kernel.topology,
      kernel.flags,
      kernel.fisheyeScale,
      kernel.halfAngle,
      kernel.innerSplit,
      kernel.horizonSplit,
      kernel.physicalSemantic,
      kernel.physicalHorizon,
      kernel.centerAxis,
      kernel.imageRightAxis,
      kernel.imageUpAxis,
      kernel.boxSize,
      kernel.boxObserver,
      kernel.roofProfile,
      kernel.doubleGable,
      kernel.cylinder,
    );
    return sample.z < 0.5 ? null : { u: sample.x, v: sample.y };
  };

  const pointAt = (index: number): Vec3 => [
    source.vertices[index * stride]!,
    source.vertices[index * stride + 1]!,
    source.vertices[index * stride + 2]!,
  ];
  const isDome = surface.kind === "angular";
  const subdivisionDepth = isDome ? 0 : DEFAULT_SUBDIVISION_DEPTH;

  if (isDome) return mapIndexedGeometry(source, stride, uvForPoint);

  for (let index = 0; index < source.indices.length; index += 3) {
    const a = pointAt(source.indices[index]!);
    const b = pointAt(source.indices[index + 1]!);
    const c = pointAt(source.indices[index + 2]!);
    appendSubdividedTriangle(a, b, c, subdivisionDepth, uvForPoint, mappedVertices, mappedIndices);
  }

  return {
    vertices: new Float32Array(mappedVertices),
    indices: new Uint32Array(mappedIndices),
  };
}

function mapIndexedGeometry(
  source: SourceGeometry,
  stride: number,
  uvForPoint: (point: Vec3) => { readonly u: number; readonly v: number } | null,
): ImmersiveCarrierMesh {
  const vertices: number[] = [];
  const indices: number[] = [];
  const vertexCount = Math.floor(source.vertices.length / stride);
  const mapped = new Int32Array(vertexCount).fill(-1);
  for (let index = 0; index < vertexCount; index += 1) {
    const point: Vec3 = [
      source.vertices[index * stride]!,
      source.vertices[index * stride + 1]!,
      source.vertices[index * stride + 2]!,
    ];
    const uv = uvForPoint(point);
    if (!uv) continue;
    mapped[index] = vertices.length / 5;
    vertices.push(point[0], point[1], point[2], uv.u, uv.v);
  }
  for (let index = 0; index < source.indices.length; index += 3) {
    const a = mapped[source.indices[index]!]!;
    const b = mapped[source.indices[index + 1]!]!;
    const c = mapped[source.indices[index + 2]!]!;
    if (a >= 0 && b >= 0 && c >= 0) indices.push(a, b, c);
  }
  return { vertices: new Float32Array(vertices), indices: new Uint32Array(indices) };
}

export function immersiveVrModelMatrix(audience: AudienceInSpace, spec: ImageSpatialSpec): Float32Array {
  const plan = audienceVenuePlan(audience, spec.projectionMode, spec.surface);
  const yaw = (audience.yawDegrees * Math.PI) / 180;
  const cosine = Math.cos(yaw);
  const sine = Math.sin(yaw);
  const observer = plan.projectionObserver;
  const translationX = cosine * (observer.xMeters - audience.xMeters) - sine * (observer.zMeters - audience.zMeters);
  const translationZ = -sine * (observer.xMeters - audience.xMeters) - cosine * (observer.zMeters - audience.zMeters);

  return new Float32Array([
    cosine,
    0,
    -sine,
    0,
    0,
    1,
    0,
    0,
    -sine,
    0,
    -cosine,
    0,
    translationX,
    observer.eyeHeightMeters,
    translationZ,
    1,
  ]);
}

export function immersiveArPlacement(audience: AudienceInSpace, spec: ImageSpatialSpec): ImmersiveArPlacement {
  const plan = audienceVenuePlan(audience, spec.projectionMode, spec.surface);
  const maximumDimension = Math.max(plan.widthMeters, plan.depthMeters, plan.heightMeters, 0.001);
  const scale = Math.min(0.12, 0.82 / maximumDimension);
  const observer = plan.projectionObserver;
  return {
    scale,
    scaleDenominator: Math.max(1, Math.round(1 / scale)),
    modelMatrix: new Float32Array([
      scale,
      0,
      0,
      0,
      0,
      scale,
      0,
      0,
      0,
      0,
      -scale,
      0,
      observer.xMeters * scale,
      observer.eyeHeightMeters * scale,
      -observer.zMeters * scale,
      1,
    ]),
  };
}

function sourceGeometry(spec: ImageSpatialSpec, audience: AudienceInSpace): SourceGeometry {
  const surface = normalizeProjectionSurfaceForMode(spec.surface, spec.projectionMode);
  if (surface.kind === "angular") {
    const range = sourceProjectionGeometryRange(spec.projectionMode);
    const geometry = buildDomeGeometry(0, range.thetaStart, range.thetaEnd);
    const scaled = geometry.vertices.slice();
    for (let index = 0; index < scaled.length; index += 3) {
      scaled[index] = scaled[index]! * audience.domeRadiusMeters;
      scaled[index + 1] = scaled[index + 1]! * audience.domeRadiusMeters;
      scaled[index + 2] = scaled[index + 2]! * audience.domeRadiusMeters;
    }
    return { ...geometry, vertices: scaled };
  }
  if (surface.kind === "box-room") return buildCaveRoomGeometry(surface);
  if (surface.kind === "double-gable-room") return buildDoubleGableRoomGeometry(surface);
  return buildCylinderRoomGeometry(
    spec.projectionMode === "cylinder-zenith" ? "cylinder-zenith" : "cylinder-nadir",
    surface,
  );
}

function appendSubdividedTriangle(
  a: Vec3,
  b: Vec3,
  c: Vec3,
  depth: number,
  uvForPoint: (point: Vec3) => { readonly u: number; readonly v: number } | null,
  vertices: number[],
  indices: number[],
): void {
  if (depth > 0) {
    const ab = midpoint(a, b);
    const bc = midpoint(b, c);
    const ca = midpoint(c, a);
    appendSubdividedTriangle(a, ab, ca, depth - 1, uvForPoint, vertices, indices);
    appendSubdividedTriangle(ab, b, bc, depth - 1, uvForPoint, vertices, indices);
    appendSubdividedTriangle(ca, bc, c, depth - 1, uvForPoint, vertices, indices);
    appendSubdividedTriangle(ab, bc, ca, depth - 1, uvForPoint, vertices, indices);
    return;
  }

  const points = [a, b, c] as const;
  const samples = points.map(uvForPoint);
  if (samples.some((sample) => !sample)) return;
  const resolved = samples as [{ u: number; v: number }, { u: number; v: number }, { u: number; v: number }];
  unwrapHorizontalSeam(resolved);
  const start = vertices.length / 5;
  for (let index = 0; index < points.length; index += 1) {
    const point = points[index];
    const uv = resolved[index];
    vertices.push(point[0], point[1], point[2], uv.u, uv.v);
  }
  indices.push(start, start + 1, start + 2);
}

function unwrapHorizontalSeam(samples: Array<{ u: number; v: number }>): void {
  const minimum = Math.min(...samples.map((sample) => sample.u));
  const maximum = Math.max(...samples.map((sample) => sample.u));
  if (maximum - minimum <= 0.5) return;
  for (const sample of samples) {
    if (sample.u < 0.5) sample.u += 1;
  }
}

function midpoint(a: Vec3, b: Vec3): Vec3 {
  return [(a[0] + b[0]) * 0.5, (a[1] + b[1]) * 0.5, (a[2] + b[2]) * 0.5];
}
