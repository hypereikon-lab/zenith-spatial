import {
  conjugateQuaternion,
  identityQuaternion,
  multiplyQuaternions,
  normalizeQuaternion,
  quaternionFromAxisAngle,
  rotateVectorByQuaternion,
  slerpQuaternion,
  type Quaternion,
} from "../geometry/camera-rig.js";
import { clamp, normalize, type Vec3 } from "../projection.js";

export type DeviceOrientationAngles = {
  readonly alpha: number;
  readonly beta: number;
  readonly gamma: number;
  readonly screenAngleDegrees?: number;
};

export type ZenithCameraBasis = {
  readonly forward: Vec3;
  readonly up: Vec3;
  readonly right: Vec3;
};

export type OrientationFilterOptions = {
  readonly deadbandDegrees: number;
  readonly slowResponseMs: number;
  readonly fastResponseMs: number;
  readonly fastAngleDegrees: number;
  readonly maxAngularVelocityDegreesPerSecond: number;
  readonly maxDeltaMs: number;
};

export const DEFAULT_ORIENTATION_FILTER: OrientationFilterOptions = {
  deadbandDegrees: 0.18,
  slowResponseMs: 68,
  fastResponseMs: 24,
  fastAngleDegrees: 12,
  maxAngularVelocityDegreesPerSecond: 720,
  maxDeltaMs: 50,
};

const DEG_TO_RAD = Math.PI / 180;
const RAD_TO_DEG = 180 / Math.PI;
const DEVICE_VIEW_FORWARD: Vec3 = [0, 0, -1];
const DEVICE_SCREEN_UP: Vec3 = [0, 1, 0];
const DEVICE_SCREEN_RIGHT: Vec3 = [1, 0, 0];

export class StabilizedDeviceOrientation {
  private baseline: Quaternion | null = null;
  private latest: Quaternion | null = null;
  private target = identityQuaternion();
  private stabilized = identityQuaternion();

  constructor(private readonly filter: OrientationFilterOptions = DEFAULT_ORIENTATION_FILTER) {}

  ingest(angles: DeviceOrientationAngles): boolean {
    const firstReading = this.latest === null;
    const current = screenAdjustedDeviceOrientation(angles);
    this.latest = current;
    this.baseline ??= current;
    this.target = relativeDeviceOrientation(this.baseline, current);
    return firstReading;
  }

  recenter(): void {
    this.baseline = this.latest;
    this.target = identityQuaternion();
    this.stabilized = identityQuaternion();
  }

  advance(deltaMs: number): Quaternion {
    this.stabilized = stabilizeDeviceOrientation(this.stabilized, this.target, deltaMs, this.filter);
    return this.stabilized;
  }

  hasReading(): boolean {
    return this.latest !== null;
  }
}

/** Converts the W3C intrinsic Z-X'-Y'' angles into a unit quaternion. */
export function quaternionFromDeviceOrientation({ alpha, beta, gamma }: DeviceOrientationAngles): Quaternion {
  const halfX = beta * DEG_TO_RAD * 0.5;
  const halfY = gamma * DEG_TO_RAD * 0.5;
  const halfZ = alpha * DEG_TO_RAD * 0.5;
  const cosX = Math.cos(halfX);
  const cosY = Math.cos(halfY);
  const cosZ = Math.cos(halfZ);
  const sinX = Math.sin(halfX);
  const sinY = Math.sin(halfY);
  const sinZ = Math.sin(halfZ);

  return normalizeQuaternion([
    sinX * cosY * cosZ - cosX * sinY * sinZ,
    cosX * sinY * cosZ + sinX * cosY * sinZ,
    cosX * cosY * sinZ + sinX * sinY * cosZ,
    cosX * cosY * cosZ - sinX * sinY * sinZ,
  ]);
}

/** Aligns the W3C device frame with the visible screen in either portrait or landscape. */
export function screenAdjustedDeviceOrientation(angles: DeviceOrientationAngles): Quaternion {
  const device = quaternionFromDeviceOrientation(angles);
  const screen = quaternionFromAxisAngle([0, 0, 1], (angles.screenAngleDegrees ?? 0) * DEG_TO_RAD);
  return multiplyQuaternions(device, screen);
}

/** Normalizes the legacy clockwise Window angle to the modern counter-clockwise Screen angle. */
export function screenOrientationCompensationDegrees(
  modernAngle: number | null | undefined,
  legacyAngle: number | null | undefined,
): number {
  if (typeof modernAngle === "number" && Number.isFinite(modernAngle)) return modernAngle;
  return typeof legacyAngle === "number" && Number.isFinite(legacyAngle) ? -legacyAngle : 0;
}

/** Expresses the current device pose in the coordinate frame captured at recenter. */
export function relativeDeviceOrientation(baseline: Quaternion, current: Quaternion): Quaternion {
  return multiplyQuaternions(conjugateQuaternion(normalizeQuaternion(baseline)), normalizeQuaternion(current));
}

/** Maps the complete relative phone pose into Zenith's Y-up, +Z-forward OpenGL camera convention. */
export function zenithCameraBasisFromRelativeDeviceOrientation(relative: Quaternion): ZenithCameraBasis {
  return {
    forward: deviceVectorToZenith(rotateVectorByQuaternion(DEVICE_VIEW_FORWARD, relative)),
    up: deviceVectorToZenith(rotateVectorByQuaternion(DEVICE_SCREEN_UP, relative)),
    right: deviceVectorToZenith(rotateVectorByQuaternion(DEVICE_SCREEN_RIGHT, relative)),
  };
}

/** Retained for consumers that only need the camera's viewing ray. */
export function zenithForwardFromRelativeDeviceOrientation(relative: Quaternion): Vec3 {
  return zenithCameraBasisFromRelativeDeviceOrientation(relative).forward;
}

/** Applies authored/touch yaw and pitch without collapsing the sensor pose into Euler angles. */
export function offsetZenithCameraBasis(
  basis: ZenithCameraBasis,
  yawDegrees: number,
  pitchDegrees: number,
): ZenithCameraBasis {
  const yaw = quaternionFromAxisAngle([0, 1, 0], yawDegrees * DEG_TO_RAD);
  const yawed = rotateCameraBasis(basis, yaw);
  const pitch = quaternionFromAxisAngle(yawed.right, pitchDegrees * DEG_TO_RAD);
  return rotateCameraBasis(yawed, pitch);
}

export function quaternionAngularDistanceDegrees(left: Quaternion, right: Quaternion): number {
  const a = normalizeQuaternion(left);
  const b = normalizeQuaternion(right);
  const cosine = Math.abs(clamp(a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3], -1, 1));
  return 2 * Math.acos(cosine) * RAD_TO_DEG;
}

/** Adaptive, time-based SLERP: quiet when stationary, responsive during intentional turns, and spike-limited. */
export function stabilizeDeviceOrientation(
  current: Quaternion,
  target: Quaternion,
  deltaMs: number,
  options: OrientationFilterOptions = DEFAULT_ORIENTATION_FILTER,
): Quaternion {
  const distanceDegrees = quaternionAngularDistanceDegrees(current, target);
  if (!Number.isFinite(distanceDegrees) || distanceDegrees <= options.deadbandDegrees) return current;

  const elapsedMs = clamp(Number.isFinite(deltaMs) ? deltaMs : 0, 0, options.maxDeltaMs);
  if (elapsedMs <= 0) return current;
  const maximumStepDegrees = (options.maxAngularVelocityDegreesPerSecond * elapsedMs) / 1000;
  const boundedTarget =
    distanceDegrees > maximumStepDegrees
      ? slerpQuaternion(current, target, maximumStepDegrees / distanceDegrees)
      : target;
  const motion = clamp(distanceDegrees / options.fastAngleDegrees, 0, 1);
  const responseMs = options.slowResponseMs + (options.fastResponseMs - options.slowResponseMs) * motion;
  const amount = 1 - Math.exp(-elapsedMs / Math.max(responseMs, 1));
  return slerpQuaternion(current, boundedTarget, amount);
}

export function identityDeviceOrientation(): Quaternion {
  return identityQuaternion();
}

function rotateCameraBasis(basis: ZenithCameraBasis, rotation: Quaternion): ZenithCameraBasis {
  return {
    forward: normalize(rotateVectorByQuaternion(basis.forward, rotation)),
    up: normalize(rotateVectorByQuaternion(basis.up, rotation)),
    right: normalize(rotateVectorByQuaternion(basis.right, rotation)),
  };
}

/** The device's +X points opposite OpenGL camera-right when Zenith looks along +Z. */
function deviceVectorToZenith(vector: Vec3): Vec3 {
  return normalize([-vector[0], vector[1], -vector[2]]);
}
