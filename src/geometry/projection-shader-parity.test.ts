import { describe, expect, test } from "vitest";
import { directionToFisheyeUv, fisheyeUvToDirection } from "./fisheye-projection.js";
import { SOURCE_PROJECTION_MODES, sourceProjectionProfileForMode } from "./source-projection.js";
import { physicalDirectionFromSourceDirection, sourceDirectionFromPhysicalDirection } from "./source-transform.js";
import { clamp, dot, normalize, scaleVec3, subtract } from "../projection.js";
import type { FisheyeProjectionProfile } from "./fisheye-projection.js";
import type { Vec3 } from "../projection.js";

describe("CPU projection math vs WGSL-equivalent formulas", () => {
  test("shader sourceSample formula matches CPU directionToFisheyeUv for every source mode", () => {
    const directions: Vec3[] = [
      [0, 1, 0],
      [0, -1, 0],
      [0, 0, 1],
      [1, 0, 0],
      normalize([0.31, 0.72, -0.62]),
      normalize([-0.24, -0.64, 0.73]),
    ];

    for (const mode of SOURCE_PROJECTION_MODES) {
      const profile = sourceProjectionProfileForMode(mode, 1536, 1536);
      for (const direction of directions) {
        const shader = shaderSourceSample(direction, profile);
        const cpu = directionToFisheyeUv(direction, profile);
        expect(shader.valid).toBe(cpu !== null);
        if (cpu) {
          expect(shader.u).toBeCloseTo(cpu.u, 6);
          expect(shader.v).toBeCloseTo(cpu.v, 6);
        }
      }
    }
  });

  test("plate compositor sourceDirectionFromUv formula matches CPU fisheyeUvToDirection", () => {
    const domeRadiusUv = 0.492;
    const radiusScale = domeRadiusUv * 2;
    const samples = [
      [0.5, 0.5],
      [0.5, 0.5 - domeRadiusUv * 0.5],
      [0.5 + domeRadiusUv * (2 / 3), 0.5],
      [0.5 - domeRadiusUv * 0.35, 0.5 + domeRadiusUv * 0.22],
    ];

    for (const mode of SOURCE_PROJECTION_MODES) {
      const profile = sourceProjectionProfileForMode(mode, 2048, 2048, radiusScale);
      for (const [u, v] of samples) {
        const shader = shaderSourceDirectionFromUv(u, v, profile, domeRadiusUv);
        const cpu = fisheyeUvToDirection(u, v, profile);
        expectVectorClose(shader, cpu);
      }
    }
  });

  test("source/physical orientation transform matches the WGSL-equivalent transform", () => {
    const transform = {
      sourceRotationRadians: Math.PI * 0.37,
      domeTiltRadians: -Math.PI * 0.18,
      mirror: true,
    };
    const directions: Vec3[] = [[0, 1, 0], [0, -1, 0], normalize([0.44, 0.2, 0.88]), normalize([-0.5, -0.3, 0.81])];

    for (const direction of directions) {
      expectVectorClose(
        shaderSourceDirectionFromPhysical(direction, transform),
        sourceDirectionFromPhysicalDirection(direction, transform),
      );
      expectVectorClose(
        shaderPhysicalDirectionFromSource(direction, transform),
        physicalDirectionFromSourceDirection(direction, transform),
      );
    }
  });
});

function shaderSourceSample(
  sourceDirection: Vec3,
  profile: FisheyeProjectionProfile,
): { u: number; v: number; valid: boolean } {
  const sourceDir = normalize(sourceDirection);
  const center = normalize(profile.centerAxis);
  const thetaMax = Math.max(profile.fieldOfViewDegrees * 0.5 * (Math.PI / 180), 0.0001);
  const centerDot = clamp(dot(sourceDir, center), -1, 1);
  const theta = Math.acos(centerDot);
  const radial = theta / thetaMax;
  let localX = 0;
  let localY = 0;
  if (theta > 0.000001) {
    const tangent = normalize(subtract(sourceDir, scaleVec3(center, centerDot)));
    localX = dot(tangent, profile.imageRightAxis);
    localY = dot(tangent, profile.imageUpAxis);
  }
  return {
    u: 0.5 + localX * profile.fisheyeScaleX * radial,
    v: 0.5 - localY * profile.fisheyeScaleY * radial,
    valid: radial <= 1.0001,
  };
}

function shaderSourceDirectionFromUv(
  u: number,
  v: number,
  profile: FisheyeProjectionProfile,
  domeRadiusUv: number,
): Vec3 {
  const domePointX = (u - 0.5) / Math.max(domeRadiusUv, 0.000001);
  const domePointY = (v - 0.5) / Math.max(domeRadiusUv, 0.000001);
  const radius = Math.hypot(domePointX, domePointY);
  const theta = clamp(radius, 0, 1) * Math.max(profile.fieldOfViewDegrees * 0.5 * (Math.PI / 180), 0.0001);
  let tangent: Vec3 = [0, 0, 0];
  if (radius > 0.000001) {
    const localX = domePointX / radius;
    const localY = domePointY / radius;
    tangent = normalize([
      profile.imageRightAxis[0] * localX + profile.imageUpAxis[0] * -localY,
      profile.imageRightAxis[1] * localX + profile.imageUpAxis[1] * -localY,
      profile.imageRightAxis[2] * localX + profile.imageUpAxis[2] * -localY,
    ]);
  }
  return normalize([
    profile.centerAxis[0] * Math.cos(theta) + tangent[0] * Math.sin(theta),
    profile.centerAxis[1] * Math.cos(theta) + tangent[1] * Math.sin(theta),
    profile.centerAxis[2] * Math.cos(theta) + tangent[2] * Math.sin(theta),
  ]);
}

function shaderSourceDirectionFromPhysical(
  physicalDirection: Vec3,
  transform: { sourceRotationRadians: number; domeTiltRadians: number; mirror: boolean },
): Vec3 {
  const dir = normalize(rotateX(physicalDirection, transform.domeTiltRadians));
  const theta = Math.acos(clamp(dir[1], -1, 1));
  const sinTheta = Math.sin(theta);
  let azimuth = Math.atan2(dir[0], dir[2]);
  if (transform.mirror) {
    azimuth = -azimuth;
  }
  azimuth += transform.sourceRotationRadians;
  return normalize([sinTheta * Math.sin(azimuth), Math.cos(theta), sinTheta * Math.cos(azimuth)]);
}

function shaderPhysicalDirectionFromSource(
  sourceDirection: Vec3,
  transform: { sourceRotationRadians: number; domeTiltRadians: number; mirror: boolean },
): Vec3 {
  const source = normalize(sourceDirection);
  const theta = Math.acos(clamp(source[1], -1, 1));
  const sinTheta = Math.sin(theta);
  let azimuth = Math.atan2(source[0], source[2]) - transform.sourceRotationRadians;
  if (transform.mirror) {
    azimuth = -azimuth;
  }
  const tilted: Vec3 = [sinTheta * Math.sin(azimuth), Math.cos(theta), sinTheta * Math.cos(azimuth)];
  return normalize(rotateX(tilted, -transform.domeTiltRadians));
}

function rotateX(value: Vec3, angle: number): Vec3 {
  const cosine = Math.cos(angle);
  const sine = Math.sin(angle);
  return [value[0], value[1] * cosine - value[2] * sine, value[1] * sine + value[2] * cosine];
}

function expectVectorClose(actual: Vec3 | null, expected: Vec3 | null): void {
  expect(actual).not.toBeNull();
  expect(expected).not.toBeNull();
  const actualValue = actual as Vec3;
  const expectedValue = expected as Vec3;
  for (let index = 0; index < 3; index += 1) {
    expect(actualValue[index]).toBeCloseTo(expectedValue[index], 6);
  }
}
