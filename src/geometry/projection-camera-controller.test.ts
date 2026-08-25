import { describe, expect, test } from "vitest";
import { subtract, vectorLength } from "../projection.js";
import { cameraBasisFromRigPose, quaternionFromLookAt } from "./camera-rig.js";
import { cameraFocusDistance } from "./projection-camera-controls.js";
import {
  beginProjectionCameraDrag,
  projectionCameraPointerModifiers,
  projectionCameraViewportPoint,
  updateProjectionCameraDrag,
  updateProjectionCameraWheel,
} from "./projection-camera-controller.js";
import type { CameraRigPose } from "./camera-rig.js";

describe("projection camera controller", () => {
  const rect = { left: 10, top: 20, width: 200, height: 100 };
  const viewport = { width: 1000, height: 500 };

  test("maps client points into viewport coordinates with optional clamping", () => {
    expect(projectionCameraViewportPoint({ clientX: 110, clientY: 70 }, rect, viewport)).toEqual({ x: 500, y: 250 });
    expect(projectionCameraViewportPoint({ clientX: -20, clientY: 200 }, rect, viewport, { clampToViewport: true })).toEqual({
      x: 0,
      y: 500,
    });
  });

  test("begins camera drags as JSON-safe state and waits below the drag threshold", () => {
    const camera = orbitCamera([0, 0, -4], [0, 0, 0]);
    const drag = beginProjectionCameraDrag({
      pointerId: 7,
      clientPoint: { clientX: 20, clientY: 30 },
      rect,
      viewport,
      camera,
      modifiers: projectionCameraPointerModifiers({ button: 0 }),
    });

    expect(JSON.parse(JSON.stringify(drag))).toEqual(drag);
    const update = updateProjectionCameraDrag({
      drag,
      pointerId: 7,
      clientPoint: { clientX: 20.2, clientY: 30.2 },
      rect,
      viewport,
      viewMode: "dome-orbit",
    });
    expect(update.kind).toBe("pending");
  });

  test("orbits from the stored start point once the threshold is crossed", () => {
    const camera = orbitCamera([0, 0, -4], [0, 0, 0]);
    const drag = beginProjectionCameraDrag({
      pointerId: 3,
      clientPoint: { clientX: 20, clientY: 30 },
      rect,
      viewport,
      camera,
    });
    const update = updateProjectionCameraDrag({
      drag,
      pointerId: 3,
      clientPoint: { clientX: 60, clientY: 50 },
      rect,
      viewport,
      viewMode: "dome-orbit",
    });

    expect(update.kind).toBe("updated");
    if (update.kind !== "updated") throw new Error("Expected camera update");
    expect(update.drag.started).toBe(true);
    expect(vectorLength(subtract(update.camera.position, [0, 0, 0]))).toBeCloseTo(4, 5);
    expect(cameraBasisFromRigPose(update.camera).forward).not.toEqual(cameraBasisFromRigPose(camera).forward);
  });

  test("pans with shift modifiers and zooms with wheel updates", () => {
    const camera = orbitCamera([0, 0, -4], [0, 0, 0]);
    const panDrag = beginProjectionCameraDrag({
      pointerId: 4,
      clientPoint: { clientX: 20, clientY: 30 },
      rect,
      viewport,
      camera,
      modifiers: projectionCameraPointerModifiers({ shiftKey: true }),
    });
    const pan = updateProjectionCameraDrag({
      drag: panDrag,
      pointerId: 4,
      clientPoint: { clientX: 90, clientY: 30 },
      rect,
      viewport,
      viewMode: "dome-orbit",
    });
    expect(pan.kind).toBe("updated");
    if (pan.kind !== "updated") throw new Error("Expected pan update");
    expect(pan.camera.position[0]).not.toBeCloseTo(camera.position[0], 5);

    const zoom = updateProjectionCameraWheel({
      viewMode: "dome-orbit",
      camera,
      deltaY: -120,
    });
    expect(cameraFocusDistance(zoom)).toBeLessThan(cameraFocusDistance(camera));
  });

  test("ignores non-owning pointer ids", () => {
    const drag = beginProjectionCameraDrag({
      pointerId: 4,
      clientPoint: { clientX: 20, clientY: 30 },
      rect,
      viewport,
      camera: orbitCamera([0, 0, -4], [0, 0, 0]),
    });
    expect(updateProjectionCameraDrag({
      drag,
      pointerId: 5,
      clientPoint: { clientX: 90, clientY: 30 },
      rect,
      viewport,
      viewMode: "dome-orbit",
    }).kind).toBe("ignored");
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
