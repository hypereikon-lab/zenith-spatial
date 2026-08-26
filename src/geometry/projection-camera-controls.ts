import {
  cameraBasisFromRigPose,
  lookAtPivot,
  normalizeCameraRigPose,
  orbitCameraAroundPivot,
  rotateCameraEuler,
} from "./camera-rig.js";
import { addVec3 } from "./camera-rig.js";
import { clamp, normalize, scaleVec3, subtract, vectorLength } from "../projection.js";
import type { CameraRigMode, CameraRigPose } from "./camera-rig.js";
import type { Point2D, Vec3 } from "../projection.js";

export type ProjectionCameraViewMode = "source-map" | "dome-orbit" | "dome-pov" | "cave-room" | "audience-space";
export type ProjectionCameraDragIntent = "none" | "orbit" | "look" | "pan" | "dolly";

export type ProjectionCameraDragModifiers = {
  button?: number;
  shiftKey?: boolean;
  altKey?: boolean;
  ctrlKey?: boolean;
  metaKey?: boolean;
};

export type ProjectionCameraDragInput<Mode extends string = CameraRigMode> = {
  viewMode: ProjectionCameraViewMode;
  startCamera: CameraRigPose<Mode>;
  startPoint: Point2D;
  currentPoint: Point2D;
  viewport: { width: number; height: number };
  modifiers?: ProjectionCameraDragModifiers;
};

export type ProjectionCameraWheelInput<Mode extends string = CameraRigMode> = {
  viewMode: ProjectionCameraViewMode;
  camera: CameraRigPose<Mode>;
  deltaY: number;
  modifiers?: ProjectionCameraDragModifiers;
};

const MIN_ORBIT_DISTANCE = 0.18;
const MAX_ORBIT_DISTANCE = 80;
const PAN_WORLD_FRACTION_PER_VIEW_HEIGHT = 1.35;
const DOLLY_DISTANCE_FRACTION_PER_VIEW_HEIGHT = 3.0;
const WHEEL_DISTANCE_FRACTION = 0.12;
const ORTHOGRAPHIC_VIEW_HEIGHT_PER_DISTANCE = 1.62;
const ORBIT_DEGREES_PER_PIXEL = 0.45;
const LOOK_DEGREES_PER_PIXEL = 0.25;

export function cloneCameraRigPose<Mode extends string>(pose: CameraRigPose<Mode>): CameraRigPose<Mode> {
  return normalizeCameraRigPose<Mode>({
    ...pose,
    position: [...pose.position] as Vec3,
    orientation: [...pose.orientation],
    pivot: pose.pivot ? ([...pose.pivot] as Vec3) : pose.pivot,
  });
}

export function projectionCameraDragIntent(
  viewMode: ProjectionCameraViewMode,
  modifiers: ProjectionCameraDragModifiers = {},
): ProjectionCameraDragIntent {
  if (viewMode === "source-map") return "none";
  const button = modifiers.button ?? 0;
  if (button === 1 || modifiers.shiftKey) return "pan";
  if (button === 2 || modifiers.altKey) return "dolly";
  return viewMode === "dome-orbit" || viewMode === "cave-room" ? "orbit" : "look";
}

export function applyProjectionCameraPointerDrag<Mode extends string>(
  input: ProjectionCameraDragInput<Mode>,
): CameraRigPose<Mode> {
  const intent = projectionCameraDragIntent(input.viewMode, input.modifiers);
  if (intent === "none") return cloneCameraRigPose(input.startCamera);
  const dx = input.currentPoint.x - input.startPoint.x;
  const dy = input.currentPoint.y - input.startPoint.y;
  if (intent === "pan") {
    const metersPerPixel = panMetersPerPixel(input.startCamera, input.viewport);
    return panProjectionCameraLocal(input.startCamera, -dx * metersPerPixel, dy * metersPerPixel);
  }
  if (intent === "dolly") {
    const amount = -dy * dollyMetersPerPixel(input.startCamera, input.viewport);
    return dollyProjectionCamera(input.startCamera, input.viewMode, amount);
  }
  if (intent === "orbit") {
    return orbitCameraAroundPivot(input.startCamera, -dx * ORBIT_DEGREES_PER_PIXEL, -dy * ORBIT_DEGREES_PER_PIXEL);
  }
  return rotateCameraEuler(input.startCamera, dx * LOOK_DEGREES_PER_PIXEL, dy * LOOK_DEGREES_PER_PIXEL);
}

export function applyProjectionCameraWheel<Mode extends string>(
  input: ProjectionCameraWheelInput<Mode>,
): CameraRigPose<Mode> {
  if (input.viewMode === "source-map") return cloneCameraRigPose(input.camera);
  const distance = cameraFocusDistance(input.camera);
  const rawAmount = (-input.deltaY * WHEEL_DISTANCE_FRACTION * Math.max(0.08, distance)) / 120;
  const amount = clamp(rawAmount, -distance * 0.65, distance * 0.65);
  return dollyProjectionCamera(input.camera, input.viewMode, amount);
}

export function panProjectionCameraLocal<Mode extends string>(
  pose: CameraRigPose<Mode>,
  truck: number,
  lift: number,
): CameraRigPose<Mode> {
  const basis = cameraBasisFromRigPose(pose);
  const offset = addVec3(scaleVec3(basis.right, truck), scaleVec3(basis.up, lift));
  return normalizeCameraRigPose<Mode>({
    ...pose,
    position: addVec3(pose.position, offset),
    pivot: pose.pivot ? addVec3(pose.pivot, offset) : pose.pivot,
  });
}

export function dollyProjectionCamera<Mode extends string>(
  pose: CameraRigPose<Mode>,
  viewMode: ProjectionCameraViewMode,
  amount: number,
): CameraRigPose<Mode> {
  if (viewMode === "dome-orbit" || viewMode === "cave-room" || pose.mode === "orbit") {
    const pivot = pose.pivot || addVec3(pose.position, cameraBasisFromRigPose(pose).forward);
    const offset = subtract(pose.position, pivot);
    const distance = vectorLength(offset);
    if (!Number.isFinite(distance) || distance <= 0.000001) return cloneCameraRigPose(pose);
    const nextDistance = clamp(distance - amount, MIN_ORBIT_DISTANCE, MAX_ORBIT_DISTANCE);
    const directionFromPivot = normalize(offset);
    const nextPosition = addVec3(pivot, scaleVec3(directionFromPivot, nextDistance));
    return lookAtPivot(
      normalizeCameraRigPose<Mode>({
        ...pose,
        position: nextPosition,
        pivot,
      }),
    );
  }
  const basis = cameraBasisFromRigPose(pose);
  const offset = scaleVec3(basis.forward, amount);
  return normalizeCameraRigPose<Mode>({
    ...pose,
    position: addVec3(pose.position, offset),
    pivot: pose.pivot ? addVec3(pose.pivot, offset) : pose.pivot,
  });
}

export function nudgeProjectionCamera<Mode extends string>(
  pose: CameraRigPose<Mode>,
  viewMode: ProjectionCameraViewMode,
  truck: number,
  lift: number,
  push: number,
): CameraRigPose<Mode> {
  let next = pose;
  if (truck !== 0 || lift !== 0) {
    next = panProjectionCameraLocal(next, truck, lift);
  }
  if (push !== 0) {
    next = dollyProjectionCamera(next, viewMode, push);
  }
  return normalizeCameraRigPose<Mode>(next);
}

export function relockProjectionCameraToPivot<Mode extends string>(pose: CameraRigPose<Mode>): CameraRigPose<Mode> {
  return lookAtPivot(pose);
}

export function cameraFocusDistance<Mode extends string>(pose: CameraRigPose<Mode>): number {
  if (pose.pivot) return vectorLength(subtract(pose.position, pose.pivot));
  return 1.5;
}

export function projectionCameraControlHelp(viewMode: ProjectionCameraViewMode): string {
  if (viewMode === "source-map") return "Plate Map is edited in flat dome-map coordinates.";
  const primary =
    viewMode === "dome-pov" || viewMode === "audience-space"
      ? "Drag to look from the camera."
      : "Drag to orbit around the pivot.";
  const wheel = viewMode === "audience-space" ? "Wheel walks through the venue." : "Wheel zooms the orthographic view.";
  return `${primary} Shift or middle-drag pans. Option or right-drag dollies. ${wheel}`;
}

function panMetersPerPixel<Mode extends string>(
  pose: CameraRigPose<Mode>,
  viewport: { width: number; height: number },
): number {
  const distance = cameraFocusDistance(pose);
  const height = Math.max(1, viewport.height);
  const visibleHeight = Math.max(0.08, distance) * ORTHOGRAPHIC_VIEW_HEIGHT_PER_DISTANCE;
  return (visibleHeight * PAN_WORLD_FRACTION_PER_VIEW_HEIGHT) / height;
}

function dollyMetersPerPixel<Mode extends string>(
  pose: CameraRigPose<Mode>,
  viewport: { width: number; height: number },
): number {
  const distance = cameraFocusDistance(pose);
  const height = Math.max(1, viewport.height);
  return (Math.max(0.08, distance) * DOLLY_DISTANCE_FRACTION_PER_VIEW_HEIGHT) / height;
}
