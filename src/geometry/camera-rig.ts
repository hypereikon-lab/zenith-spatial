import {
  angularDistance,
  clamp,
  cross,
  dot,
  lerp,
  lookAtLH,
  normalize,
  scaleVec3,
  subtract,
  vectorLength,
} from "../projection.js";
import type { Mat4, Point2D, Vec3 } from "../projection.js";

export type Quaternion = [number, number, number, number];
export type CameraRigMode = "inside" | "orbit" | "fly";
export type CameraRigPose<Mode extends string = CameraRigMode> = {
  position: Vec3;
  orientation: Quaternion;
  fovDegrees: number;
  mode: Mode;
  pivot?: Vec3 | null;
  nearMeters?: number;
  farMeters?: number;
};

export type CameraRigBasis = {
  position: Vec3;
  orientation: Quaternion;
  right: Vec3;
  up: Vec3;
  forward: Vec3;
  fovDegrees: number;
  nearMeters: number;
  farMeters: number;
};

export type CameraEulerDegrees = {
  yawDegrees: number;
  pitchDegrees: number;
  rollDegrees: number;
};

export type CameraRigDiagnostics = {
  travelMeters: number;
  angularChangeDegrees: number;
  expectedDisocclusion: number;
  risk: "low" | "medium" | "high";
  notes: string[];
};
export type CameraArcballViewport = { width: number; height: number };

const DEG_TO_RAD = Math.PI / 180;
const RAD_TO_DEG = 180 / Math.PI;
const IDENTITY_QUATERNION: Quaternion = [0, 0, 0, 1];
const WORLD_UP: Vec3 = [0, 1, 0];
const CANONICAL_RIGHT: Vec3 = [1, 0, 0];
const CANONICAL_UP: Vec3 = [0, 1, 0];
const CANONICAL_FORWARD: Vec3 = [0, 0, 1];

type PoseInput<Mode extends string> = Partial<CameraRigPose<Mode>> & Record<string, unknown>;

export function identityQuaternion(): Quaternion {
  return [...IDENTITY_QUATERNION];
}

export function normalizeQuaternion(input: unknown): Quaternion {
  if (!Array.isArray(input) || input.length < 4) return identityQuaternion();
  const quaternion: Quaternion = [
    Number(input[0]) || 0,
    Number(input[1]) || 0,
    Number(input[2]) || 0,
    Number(input[3]) || 0,
  ];
  const length = Math.hypot(quaternion[0], quaternion[1], quaternion[2], quaternion[3]);
  if (!Number.isFinite(length) || length <= 0.000001) return identityQuaternion();
  return [quaternion[0] / length, quaternion[1] / length, quaternion[2] / length, quaternion[3] / length];
}

export function quaternionFromAxisAngle(axis: Vec3, angleRadians: number): Quaternion {
  const normalizedAxis = normalize(axis);
  const half = angleRadians * 0.5;
  const sine = Math.sin(half);
  return normalizeQuaternion([
    normalizedAxis[0] * sine,
    normalizedAxis[1] * sine,
    normalizedAxis[2] * sine,
    Math.cos(half),
  ]);
}

export function quaternionFromUnitVectors(from: Vec3, to: Vec3): Quaternion {
  const source = normalize(from);
  const target = normalize(to);
  const cosine = clamp(dot(source, target), -1, 1);
  if (cosine < -0.999999) {
    const fallbackAxis =
      vectorLength(cross(CANONICAL_RIGHT, source)) > 0.000001
        ? cross(CANONICAL_RIGHT, source)
        : cross(CANONICAL_UP, source);
    return quaternionFromAxisAngle(fallbackAxis, Math.PI);
  }
  const axis = cross(source, target);
  return normalizeQuaternion([axis[0], axis[1], axis[2], 1 + cosine]);
}

export function multiplyQuaternions(left: Quaternion, right: Quaternion): Quaternion {
  const [ax, ay, az, aw] = left;
  const [bx, by, bz, bw] = right;
  return normalizeQuaternion([
    aw * bx + ax * bw + ay * bz - az * by,
    aw * by - ax * bz + ay * bw + az * bx,
    aw * bz + ax * by - ay * bx + az * bw,
    aw * bw - ax * bx - ay * by - az * bz,
  ]);
}

export function conjugateQuaternion(input: Quaternion): Quaternion {
  return [-input[0], -input[1], -input[2], input[3]];
}

export function rotateVectorByQuaternion(vector: Vec3, orientation: Quaternion): Vec3 {
  const [qx, qy, qz, qw] = normalizeQuaternion(orientation);
  const uv = cross([qx, qy, qz], vector);
  const uuv = cross([qx, qy, qz], uv);
  return [
    vector[0] + (uv[0] * qw + uuv[0]) * 2,
    vector[1] + (uv[1] * qw + uuv[1]) * 2,
    vector[2] + (uv[2] * qw + uuv[2]) * 2,
  ];
}

export function slerpQuaternion(a: Quaternion, b: Quaternion, t: number): Quaternion {
  const amount = clamp(t, 0, 1);
  const left = normalizeQuaternion(a);
  let right = normalizeQuaternion(b);
  let cosine = quaternionDot(left, right);
  if (cosine < 0) {
    right = [-right[0], -right[1], -right[2], -right[3]];
    cosine = -cosine;
  }
  if (cosine > 0.9995) {
    return normalizeQuaternion([
      lerp(left[0], right[0], amount),
      lerp(left[1], right[1], amount),
      lerp(left[2], right[2], amount),
      lerp(left[3], right[3], amount),
    ]);
  }
  const theta = Math.acos(clamp(cosine, -1, 1));
  const sine = Math.sin(theta);
  const leftScale = Math.sin((1 - amount) * theta) / sine;
  const rightScale = Math.sin(amount * theta) / sine;
  return normalizeQuaternion([
    left[0] * leftScale + right[0] * rightScale,
    left[1] * leftScale + right[1] * rightScale,
    left[2] * leftScale + right[2] * rightScale,
    left[3] * leftScale + right[3] * rightScale,
  ]);
}

export function quaternionFromEulerDegrees(
  yawDegrees: number | string | null | undefined = 0,
  pitchDegrees: number | string | null | undefined = 0,
  rollDegrees: number | string | null | undefined = 0,
): Quaternion {
  const yaw = (Number(yawDegrees) || 0) * DEG_TO_RAD;
  const pitch = (Number(pitchDegrees) || 0) * DEG_TO_RAD;
  const roll = (Number(rollDegrees) || 0) * DEG_TO_RAD;
  const cosPitch = Math.cos(pitch);
  const forward: Vec3 = normalize([Math.sin(yaw) * cosPitch, Math.sin(pitch), Math.cos(yaw) * cosPitch]);
  const rightBase =
    vectorLength(cross(WORLD_UP, forward)) > 0.000001 ? normalize(cross(WORLD_UP, forward)) : CANONICAL_RIGHT;
  const upBase = normalize(cross(forward, rightBase));
  const rollQuaternion = quaternionFromAxisAngle(forward, roll);
  return quaternionFromBasis(
    rotateVectorByQuaternion(rightBase, rollQuaternion),
    rotateVectorByQuaternion(upBase, rollQuaternion),
    forward,
  );
}

export function eulerDegreesFromQuaternion(orientation: Quaternion): CameraEulerDegrees {
  const basis = cameraBasisFromOrientation(orientation);
  const yawDegrees = Math.atan2(basis.forward[0], basis.forward[2]) * RAD_TO_DEG;
  const pitchDegrees = Math.asin(clamp(basis.forward[1], -1, 1)) * RAD_TO_DEG;
  const baseRight =
    vectorLength(cross(WORLD_UP, basis.forward)) > 0.000001
      ? normalize(cross(WORLD_UP, basis.forward))
      : CANONICAL_RIGHT;
  const baseUp = normalize(cross(basis.forward, baseRight));
  const rollDegrees = Math.atan2(dot(cross(baseUp, basis.up), basis.forward), dot(baseUp, basis.up)) * RAD_TO_DEG;
  return {
    yawDegrees: cleanDegrees(yawDegrees),
    pitchDegrees: cleanDegrees(pitchDegrees),
    rollDegrees: cleanDegrees(rollDegrees),
  };
}

export function quaternionFromLookAt(position: Vec3, target: Vec3, rollDegrees = 0): Quaternion {
  const forward = normalize(subtract(target, position));
  const rightBase =
    vectorLength(cross(WORLD_UP, forward)) > 0.000001 ? normalize(cross(WORLD_UP, forward)) : CANONICAL_RIGHT;
  const upBase = normalize(cross(forward, rightBase));
  const rollQuaternion = quaternionFromAxisAngle(forward, rollDegrees * DEG_TO_RAD);
  return quaternionFromBasis(
    rotateVectorByQuaternion(rightBase, rollQuaternion),
    rotateVectorByQuaternion(upBase, rollQuaternion),
    forward,
  );
}

export function normalizeCameraRigPose<Mode extends string = CameraRigMode>(
  input: PoseInput<Mode> = {},
  defaults: Partial<CameraRigPose<Mode>> = {},
): CameraRigPose<Mode> {
  const defaultPosition = defaults.position || [0, 0, 0];
  const positionInput = input.position || defaultPosition;
  const position: Vec3 = [
    clamp(Number(positionInput[0]) || 0, -120, 120),
    clamp(Number(positionInput[1]) || 0, -120, 120),
    clamp(Number(positionInput[2]) || 0, -120, 120),
  ];
  const orientation = Array.isArray(input.orientation)
    ? normalizeQuaternion(input.orientation)
    : Array.isArray(defaults.orientation)
      ? normalizeQuaternion(defaults.orientation)
      : identityQuaternion();
  const pivotInput = input.pivot === null ? null : input.pivot || defaults.pivot || null;
  const pivot = Array.isArray(pivotInput)
    ? ([
        clamp(Number(pivotInput[0]) || 0, -120, 120),
        clamp(Number(pivotInput[1]) || 0, -120, 120),
        clamp(Number(pivotInput[2]) || 0, -120, 120),
      ] as Vec3)
    : null;
  const defaultMode = defaults.mode || ("inside" as Mode);
  return {
    position,
    orientation,
    fovDegrees: clamp(Number(input.fovDegrees ?? defaults.fovDegrees) || 72, 8, 170),
    mode: (input.mode || defaultMode) as Mode,
    pivot,
    nearMeters: clamp(Number(input.nearMeters ?? defaults.nearMeters) || 0.01, 0.001, 10),
    farMeters: clamp(Number(input.farMeters ?? defaults.farMeters) || 80, 1, 1000),
  };
}

export function cameraBasisFromRigPose<Mode extends string = CameraRigMode>(
  pose: Partial<CameraRigPose<Mode>> & Record<string, unknown> = {},
): CameraRigBasis {
  const normalizedPose = normalizeCameraRigPose(pose);
  const orientation = normalizeQuaternion(normalizedPose.orientation);
  const basis = cameraBasisFromOrientation(orientation);
  const position = normalizedPose.mode === "inside" ? ([0, 0, 0] as Vec3) : normalizedPose.position;
  return {
    position,
    orientation,
    right: basis.right,
    up: basis.up,
    forward: basis.forward,
    fovDegrees: normalizedPose.fovDegrees,
    nearMeters: normalizedPose.nearMeters || 0.01,
    farMeters: normalizedPose.farMeters || 80,
  };
}

export function viewMatrixFromCameraRigPose<Mode extends string = CameraRigMode>(
  pose: Partial<CameraRigPose<Mode>> & Record<string, unknown> = {},
): Mat4 {
  const basis = cameraBasisFromRigPose(pose);
  return lookAtLH(basis.position, addVec3(basis.position, basis.forward), basis.up);
}

export function worldRayFromCameraRigNdc<Mode extends string = CameraRigMode>(
  pose: Partial<CameraRigPose<Mode>> & Record<string, unknown> = {},
  ndcX: number,
  ndcY: number,
  aspect = 1,
): Vec3 {
  const basis = cameraBasisFromRigPose(pose);
  const tanHalfFov = Math.tan((basis.fovDegrees * DEG_TO_RAD) / 2);
  return normalize([
    basis.forward[0] + basis.right[0] * ndcX * tanHalfFov * aspect + basis.up[0] * ndcY * tanHalfFov,
    basis.forward[1] + basis.right[1] * ndcX * tanHalfFov * aspect + basis.up[1] * ndcY * tanHalfFov,
    basis.forward[2] + basis.right[2] * ndcX * tanHalfFov * aspect + basis.up[2] * ndcY * tanHalfFov,
  ]);
}

export function translateCameraLocal<Mode extends string>(
  pose: CameraRigPose<Mode>,
  truck: number,
  lift: number,
  push: number,
): CameraRigPose<Mode> {
  const basis = cameraBasisFromRigPose(pose);
  const offset = addVec3(
    addVec3(scaleVec3(basis.right, truck), scaleVec3(basis.up, lift)),
    scaleVec3(basis.forward, push),
  );
  return normalizeCameraRigPose<Mode>({
    ...pose,
    position: addVec3(pose.position, offset),
  });
}

export function rotateCameraLocal<Mode extends string>(
  pose: CameraRigPose<Mode>,
  yawDeltaDegrees: number,
  pitchDeltaDegrees: number,
  rollDeltaDegrees: number,
): CameraRigPose<Mode> {
  const basis = cameraBasisFromRigPose(pose);
  const yaw = quaternionFromAxisAngle(basis.up, yawDeltaDegrees * DEG_TO_RAD);
  const pitch = quaternionFromAxisAngle(basis.right, -pitchDeltaDegrees * DEG_TO_RAD);
  const roll = quaternionFromAxisAngle(basis.forward, rollDeltaDegrees * DEG_TO_RAD);
  return normalizeCameraRigPose<Mode>({
    ...pose,
    orientation: multiplyQuaternions(multiplyQuaternions(multiplyQuaternions(roll, pitch), yaw), basis.orientation),
  });
}

export function arcballVectorFromPoint(point: Point2D, viewport: CameraArcballViewport): Vec3 {
  const width = Math.max(1, viewport.width);
  const height = Math.max(1, viewport.height);
  const size = Math.max(1, Math.min(width, height));
  const x = (2 * point.x - width) / size;
  const y = (height - 2 * point.y) / size;
  const lengthSquared = x * x + y * y;
  if (lengthSquared <= 1) {
    return [x, y, Math.sqrt(1 - lengthSquared)];
  }
  const inverseLength = 1 / Math.sqrt(lengthSquared);
  return [x * inverseLength, y * inverseLength, 0];
}

export function arcballRotationForCamera<Mode extends string>(
  pose: CameraRigPose<Mode>,
  startPoint: Point2D,
  currentPoint: Point2D,
  viewport: CameraArcballViewport,
  strength = 1,
): Quaternion {
  const start = arcballVectorFromPoint(startPoint, viewport);
  const current = arcballVectorFromPoint(currentPoint, viewport);
  const localRotation = quaternionFromUnitVectors(start, current);
  const localAxisLength = Math.hypot(localRotation[0], localRotation[1], localRotation[2]);
  if (localAxisLength <= 0.000001) return identityQuaternion();
  const basis = cameraBasisFromRigPose(pose);
  const localAxis: Vec3 = [
    localRotation[0] / localAxisLength,
    localRotation[1] / localAxisLength,
    localRotation[2] / localAxisLength,
  ];
  const worldAxis = normalize(
    addVec3(
      addVec3(scaleVec3(basis.right, localAxis[0]), scaleVec3(basis.up, localAxis[1])),
      scaleVec3(basis.forward, localAxis[2]),
    ),
  );
  const angle = 2 * Math.atan2(localAxisLength, localRotation[3]) * strength;
  return quaternionFromAxisAngle(worldAxis, angle);
}

export function rotateCameraArcball<Mode extends string>(
  pose: CameraRigPose<Mode>,
  startPoint: Point2D,
  currentPoint: Point2D,
  viewport: CameraArcballViewport,
  strength = 1,
): CameraRigPose<Mode> {
  const rotation = arcballRotationForCamera(pose, startPoint, currentPoint, viewport, strength);
  return normalizeCameraRigPose<Mode>({
    ...pose,
    orientation: multiplyQuaternions(rotation, pose.orientation),
  });
}

export function orbitCameraAroundPivotArcball<Mode extends string>(
  pose: CameraRigPose<Mode>,
  startPoint: Point2D,
  currentPoint: Point2D,
  viewport: CameraArcballViewport,
  strength = 1,
): CameraRigPose<Mode> {
  const pivot = pose.pivot || [0, 0, 0];
  const offset = subtract(pose.position, pivot);
  const rotation = arcballRotationForCamera(pose, startPoint, currentPoint, viewport, strength);
  const nextOffset = rotateVectorByQuaternion(offset, rotation);
  return normalizeCameraRigPose<Mode>({
    ...pose,
    position: addVec3(pivot, nextOffset),
    orientation: multiplyQuaternions(rotation, pose.orientation),
    pivot,
  });
}

export function orbitCameraAroundPivot<Mode extends string>(
  pose: CameraRigPose<Mode>,
  yawDeltaDegrees: number,
  pitchDeltaDegrees: number,
): CameraRigPose<Mode> {
  const pivot = pose.pivot || [0, 0, 0];
  const offset = subtract(pose.position, pivot);

  // To clamp pitch, we calculate the current pitch angle of the offset vector relative to the horizontal plane.
  const distance = vectorLength(offset);
  if (distance < 0.000001) return normalizeCameraRigPose({ ...pose }) as CameraRigPose<Mode>;

  // Current pitch angle in radians (arcsin of Y / distance)
  const currentPitch = Math.asin(clamp(offset[1] / distance, -1, 1));
  const currentPitchDegrees = currentPitch * RAD_TO_DEG;

  // Clamp the new pitch to avoid flipping over the poles (gimbal lock)
  const nextPitchDegrees = clamp(currentPitchDegrees + pitchDeltaDegrees, -89.9, 89.9);
  const actualPitchDeltaDegrees = nextPitchDegrees - currentPitchDegrees;

  // Damp the yaw rotation near the poles (gimbal lock region) to maintain constant linear velocity and prevent wild spinning/snapping.
  const cosPitch = Math.abs(Math.cos(currentPitch));
  const scaledYawDelta = yawDeltaDegrees * Math.max(0.02, cosPitch);
  const yaw = quaternionFromAxisAngle(WORLD_UP, scaledYawDelta * DEG_TO_RAD);
  const yawedOffset = rotateVectorByQuaternion(offset, yaw);

  const right = normalize(cross(WORLD_UP, normalize(scaleVec3(yawedOffset, -1))));
  const pitch = quaternionFromAxisAngle(
    vectorLength(right) > 0.000001 ? right : CANONICAL_RIGHT,
    actualPitchDeltaDegrees * DEG_TO_RAD,
  );
  const nextOffset = rotateVectorByQuaternion(yawedOffset, pitch);
  const nextPosition = addVec3(pivot, nextOffset);

  return normalizeCameraRigPose<Mode>({
    ...pose,
    position: nextPosition,
    orientation: quaternionFromLookAt(nextPosition, pivot, 0), // Lock roll to 0 for standard orbit
  });
}

export function rotateCameraEuler<Mode extends string>(
  pose: CameraRigPose<Mode>,
  yawDeltaDegrees: number,
  pitchDeltaDegrees: number,
): CameraRigPose<Mode> {
  const euler = eulerDegreesFromQuaternion(pose.orientation);
  // In a first-person fly camera, pitch is typically clamped to prevent looking past straight up or down.
  const nextPitchDegrees = clamp(euler.pitchDegrees + pitchDeltaDegrees, -89.9, 89.9);
  const nextYawDegrees = euler.yawDegrees + yawDeltaDegrees;

  // Keep roll as 0 (standard for FPS cameras) unless otherwise needed, but we'll use 0 here for stable FPS view
  const nextOrientation = quaternionFromEulerDegrees(nextYawDegrees, nextPitchDegrees, 0);

  // If the pose has a pivot, we want to push the pivot in front of the camera so it remains valid
  const basis = cameraBasisFromRigPose(normalizeCameraRigPose({ ...pose, orientation: nextOrientation }));
  const pivotDistance = pose.pivot ? vectorLength(subtract(pose.pivot, pose.position)) : 5;
  const nextPivot = addVec3(pose.position, scaleVec3(basis.forward, Math.max(1, pivotDistance)));

  return normalizeCameraRigPose<Mode>({
    ...pose,
    orientation: nextOrientation,
    pivot: nextPivot,
  });
}

export function lookAtPivot<Mode extends string>(pose: CameraRigPose<Mode>): CameraRigPose<Mode> {
  const pivot = pose.pivot || addVec3(pose.position, cameraBasisFromRigPose(pose).forward);
  return normalizeCameraRigPose<Mode>({
    ...pose,
    orientation: quaternionFromLookAt(pose.position, pivot, eulerDegreesFromQuaternion(pose.orientation).rollDegrees),
  });
}

export function cameraRigDiagnostics(
  pose: Partial<CameraRigPose>,
  reference: Partial<CameraRigPose> = {},
): CameraRigDiagnostics {
  const normalized = normalizeCameraRigPose(pose);
  const basis = cameraBasisFromRigPose(normalized);
  const referenceBasis = cameraBasisFromRigPose(normalizeCameraRigPose(reference));
  const travelMeters = vectorLength(normalized.position);
  const angularChangeDegrees = angularDistance(basis.forward, referenceBasis.forward) * RAD_TO_DEG;
  const expectedDisocclusion = clamp(travelMeters / 2.5 + angularChangeDegrees / 120, 0, 1);
  const notes = [
    expectedDisocclusion > 0.65
      ? "Large camera change: expect visible holes and lower fusion confidence."
      : expectedDisocclusion > 0.32
        ? "Moderate camera change: reconstruction should be useful but masks need review."
        : "Small camera change within the current projection view.",
  ];
  return {
    travelMeters,
    angularChangeDegrees,
    expectedDisocclusion,
    risk: expectedDisocclusion > 0.65 ? "high" : expectedDisocclusion > 0.32 ? "medium" : "low",
    notes,
  };
}

export function addVec3(a: Vec3, b: Vec3): Vec3 {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
}

function cameraBasisFromOrientation(orientation: Quaternion): Pick<CameraRigBasis, "right" | "up" | "forward"> {
  const normalized = normalizeQuaternion(orientation);
  return {
    right: normalize(rotateVectorByQuaternion(CANONICAL_RIGHT, normalized)),
    up: normalize(rotateVectorByQuaternion(CANONICAL_UP, normalized)),
    forward: normalize(rotateVectorByQuaternion(CANONICAL_FORWARD, normalized)),
  };
}

function quaternionFromBasis(right: Vec3, up: Vec3, forward: Vec3): Quaternion {
  const m00 = right[0];
  const m01 = up[0];
  const m02 = forward[0];
  const m10 = right[1];
  const m11 = up[1];
  const m12 = forward[1];
  const m20 = right[2];
  const m21 = up[2];
  const m22 = forward[2];
  const trace = m00 + m11 + m22;
  let quaternion: Quaternion;
  if (trace > 0) {
    const s = Math.sqrt(trace + 1) * 2;
    quaternion = [(m21 - m12) / s, (m02 - m20) / s, (m10 - m01) / s, 0.25 * s];
  } else if (m00 > m11 && m00 > m22) {
    const s = Math.sqrt(1 + m00 - m11 - m22) * 2;
    quaternion = [0.25 * s, (m01 + m10) / s, (m02 + m20) / s, (m21 - m12) / s];
  } else if (m11 > m22) {
    const s = Math.sqrt(1 + m11 - m00 - m22) * 2;
    quaternion = [(m01 + m10) / s, 0.25 * s, (m12 + m21) / s, (m02 - m20) / s];
  } else {
    const s = Math.sqrt(1 + m22 - m00 - m11) * 2;
    quaternion = [(m02 + m20) / s, (m12 + m21) / s, 0.25 * s, (m10 - m01) / s];
  }
  return normalizeQuaternion(quaternion);
}

function quaternionDot(a: Quaternion, b: Quaternion): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3];
}

function cleanDegrees(value: number): number {
  return Math.abs(value) < 0.000001 ? 0 : value;
}
