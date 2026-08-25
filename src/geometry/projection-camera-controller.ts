import {
  applyProjectionCameraPointerDrag,
  applyProjectionCameraWheel,
  cloneCameraRigPose,
  type ProjectionCameraDragModifiers,
  type ProjectionCameraViewMode,
} from "./projection-camera-controls.js";
import { clientPointToViewportPoint, pointerEventClientPoint } from "./editor-viewport.js";
import type { CameraRigMode, CameraRigPose } from "./camera-rig.js";
import type { EditorClientPointInput, EditorClientRect, EditorViewportSize } from "./editor-viewport.js";
import type { Point2D } from "../projection.js";

export type ProjectionCameraPointerModifierInput = Partial<ProjectionCameraDragModifiers>;

export type ProjectionCameraDragState<Mode extends string = CameraRigMode> = {
  pointerId: number;
  startPoint: Point2D;
  startCamera: CameraRigPose<Mode>;
  modifiers: ProjectionCameraDragModifiers;
  started: boolean;
};

export type ProjectionCameraDragUpdate<Mode extends string = CameraRigMode> =
  | {
      kind: "ignored";
      drag: ProjectionCameraDragState<Mode>;
    }
  | {
      kind: "pending";
      drag: ProjectionCameraDragState<Mode>;
    }
  | {
      kind: "updated";
      drag: ProjectionCameraDragState<Mode>;
      camera: CameraRigPose<Mode>;
    };

export function projectionCameraPointerModifiers(input: ProjectionCameraPointerModifierInput): ProjectionCameraDragModifiers {
  return {
    button: input.button,
    shiftKey: Boolean(input.shiftKey),
    altKey: Boolean(input.altKey),
    ctrlKey: Boolean(input.ctrlKey),
    metaKey: Boolean(input.metaKey),
  };
}

export function projectionCameraViewportPoint(
  clientPoint: EditorClientPointInput,
  rect: EditorClientRect,
  viewport: EditorViewportSize,
  { clampToViewport = false }: { clampToViewport?: boolean } = {},
): Point2D {
  return clientPointToViewportPoint(pointerEventClientPoint(clientPoint), rect, viewport, { clampToViewport });
}

export function beginProjectionCameraDrag<Mode extends string>({
  pointerId,
  clientPoint,
  rect,
  viewport,
  camera,
  modifiers = {},
  clampToViewport = false,
}: {
  pointerId: number;
  clientPoint: EditorClientPointInput;
  rect: EditorClientRect;
  viewport: EditorViewportSize;
  camera: CameraRigPose<Mode>;
  modifiers?: ProjectionCameraDragModifiers;
  clampToViewport?: boolean;
}): ProjectionCameraDragState<Mode> {
  return {
    pointerId,
    startPoint: projectionCameraViewportPoint(clientPoint, rect, viewport, { clampToViewport }),
    startCamera: cloneCameraRigPose(camera),
    modifiers,
    started: false,
  };
}

export function updateProjectionCameraDrag<Mode extends string>({
  drag,
  pointerId,
  clientPoint,
  rect,
  viewport,
  viewMode,
  clampToViewport = false,
  dragThresholdPx = 3,
}: {
  drag: ProjectionCameraDragState<Mode>;
  pointerId: number;
  clientPoint: EditorClientPointInput;
  rect: EditorClientRect;
  viewport: EditorViewportSize;
  viewMode: ProjectionCameraViewMode;
  clampToViewport?: boolean;
  dragThresholdPx?: number;
}): ProjectionCameraDragUpdate<Mode> {
  if (pointerId !== drag.pointerId) return { kind: "ignored", drag };
  const currentPoint = projectionCameraViewportPoint(clientPoint, rect, viewport, { clampToViewport });
  const dx = currentPoint.x - drag.startPoint.x;
  const dy = currentPoint.y - drag.startPoint.y;
  if (!drag.started && Math.hypot(dx, dy) < dragThresholdPx) {
    return { kind: "pending", drag };
  }
  const nextDrag = { ...drag, started: true };
  return {
    kind: "updated",
    drag: nextDrag,
    camera: applyProjectionCameraPointerDrag({
      viewMode,
      startCamera: drag.startCamera,
      startPoint: drag.startPoint,
      currentPoint,
      viewport,
      modifiers: drag.modifiers,
    }),
  };
}

export function updateProjectionCameraWheel<Mode extends string>({
  viewMode,
  camera,
  deltaY,
  modifiers = {},
}: {
  viewMode: ProjectionCameraViewMode;
  camera: CameraRigPose<Mode>;
  deltaY: number;
  modifiers?: ProjectionCameraDragModifiers;
}): CameraRigPose<Mode> {
  return applyProjectionCameraWheel({ viewMode, camera, deltaY, modifiers });
}
