import { describe, expect, test } from "vitest";
import { angularDistance, normalize, subtract, vectorLength } from "../projection.js";
import { cameraBasisFromRigPose, quaternionFromLookAt } from "./camera-rig.js";
import type { CameraRigPose } from "./camera-rig.js";
import {
  applyProjectionCameraPointerDrag,
  applyProjectionCameraWheel,
  cameraFocusDistance,
} from "./projection-camera-controls.js";

describe("projection camera quaternion controls", () => {
  test("orbits Dome Orbit around its pivot with a normalized quaternion pose", () => {
    const camera = orbitCamera([0, 0, -4], [0, 0, 0]);
    const next = applyProjectionCameraPointerDrag({
      viewMode: "dome-orbit",
      startCamera: camera,
      startPoint: { x: 240, y: 240 },
      currentPoint: { x: 360, y: 140 },
      viewport: { width: 480, height: 480 },
    });

    expect(vectorLength(subtract(next.position, [0, 0, 0]))).toBeCloseTo(4, 5);
    expect(Math.hypot(...next.orientation)).toBeCloseTo(1, 6);
    expect(angularDistance(cameraBasisFromRigPose(next).forward, normalize(scale(next.position, -1)))).toBeLessThan(0.00001);
  });

  test("uses the same orbit behavior for CAVE Room inspection", () => {
    const camera = orbitCamera([0, 2.6, -3.2], [0, 0, 0]);
    const next = applyProjectionCameraPointerDrag({
      viewMode: "cave-room",
      startCamera: camera,
      startPoint: { x: 240, y: 240 },
      currentPoint: { x: 120, y: 310 },
      viewport: { width: 480, height: 480 },
    });

    expect(vectorLength(subtract(next.position, [0, 0, 0]))).toBeCloseTo(vectorLength(camera.position), 5);
    expect(angularDistance(cameraBasisFromRigPose(next).forward, normalize(scale(next.position, -1)))).toBeLessThan(0.00001);
  });

  test("rotates Dome POV in place without changing position", () => {
    const camera: CameraRigPose<"inside"> = {
      ...orbitCamera([0, 0, 0], [0, 0, 1]),
      mode: "inside" as const,
      pivot: null,
    };
    const next = applyProjectionCameraPointerDrag({
      viewMode: "dome-pov",
      startCamera: camera,
      startPoint: { x: 240, y: 240 },
      currentPoint: { x: 310, y: 220 },
      viewport: { width: 480, height: 480 },
    });

    expect(next.position).toEqual(camera.position);
    expect(angularDistance(cameraBasisFromRigPose(next).forward, cameraBasisFromRigPose(camera).forward)).toBeGreaterThan(0.05);
  });

  test("wheel dollies orbit cameras toward the pivot", () => {
    const camera = orbitCamera([0, 0, -4], [0, 0, 0]);
    const next = applyProjectionCameraWheel({
      viewMode: "dome-orbit",
      camera,
      deltaY: -120,
    });

    expect(cameraFocusDistance(next)).toBeLessThan(cameraFocusDistance(camera));
    expect(angularDistance(cameraBasisFromRigPose(next).forward, normalize(scale(next.position, -1)))).toBeLessThan(0.00001);
  });
});

function orbitCamera(position: [number, number, number], pivot: [number, number, number]): CameraRigPose<"orbit"> {
  return {
    position,
    orientation: quaternionFromLookAt(position, pivot),
    pivot,
    fovDegrees: 78,
    mode: "orbit",
    nearMeters: 0.01,
    farMeters: 80,
  };
}

function scale(vector: [number, number, number], amount: number): [number, number, number] {
  return [vector[0] * amount, vector[1] * amount, vector[2] * amount];
}
