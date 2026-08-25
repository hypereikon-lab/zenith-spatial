import { distance2d, wrapDegrees } from "../projection.js";
import {
  cornerOffsetsFromSourceLocalDrag,
  hitPlateEditorHandle,
  moveDomePointBySourcePointerDrag,
  plateLocalFromSourceDirection,
  scaleFromSourceLocalDrag,
  sourceDirectionHitsPlatePlacement,
  spinFromSourceLocalRotateDrag,
} from "./plate-drag-math.js";
import { clonePlateCornerOffsets, normalizePlatePlacement, preparePlatePlacement } from "./plate-placement.js";
import type { Point2D, Vec3 } from "../projection.js";
import type { SourceProjectionMode } from "../geometry/source-projection.js";
import type { ProjectionSurface } from "../lib/shared/contracts/projection-authoring.js";
import type { PlateEditorHit } from "./plate-drag-math.js";
import type { PlateEditorProjectionAdapter } from "./plate-editor-projection-adapter.js";
import type {
  NormalizedPlatePlacement,
  PlateCorner,
  PlateCornerOffsets,
  PlateLike,
  PreparedPlatePlacement,
} from "./plate-placement.js";
import type { PlateSketchEditorGeometry } from "./plate-sketch-editor-view-model.js";

export type PlateSketchEditorHit = PlateEditorHit;

export type PlateSketchEditorDrag =
  | {
      action: "move";
      pointerId: number;
      startClient: Point2D;
      startCenter: Point2D;
      startPointerDirection: Vec3 | null;
      startCenterDirection: Vec3;
      started: boolean;
    }
  | {
      action: "scale";
      pointerId: number;
      startScale: number;
      startLocal: Point2D | null;
      startPrepared: PreparedPlatePlacement;
    }
  | {
      action: "warp";
      pointerId: number;
      corner: PlateCorner;
      startLocal: Point2D | null;
      startPrepared: PreparedPlatePlacement;
      startCornerOffsets: PlateCornerOffsets;
    }
  | {
      action: "rotate";
      pointerId: number;
      startSpin: number;
      startLocal: Point2D | null;
      startPrepared: PreparedPlatePlacement;
      started: boolean;
    };

export type PlateSketchEditorDragUpdate =
  | {
      kind: "ignored";
      drag: PlateSketchEditorDrag;
    }
  | {
      kind: "updated";
      drag: PlateSketchEditorDrag;
      placement: NormalizedPlatePlacement;
      changed: boolean;
    };

export function hitTestPlateSketchEditor({
  point,
  direction,
  activeIndex,
  geometries,
  placements,
  plates,
  sourceProjectionMode,
  innerGuideSplit,
  carrierHorizonRadius,
  projectionSurface,
  plateFit,
  handleRadius,
  hitLocalPad,
  preferActiveBody = false,
}: {
  point: Point2D | null;
  direction: Vec3 | null;
  activeIndex: number;
  geometries: PlateSketchEditorGeometry[];
  placements: NormalizedPlatePlacement[];
  plates: PlateLike[];
  sourceProjectionMode: SourceProjectionMode;
  innerGuideSplit?: number | string | null;
  carrierHorizonRadius?: number | string | null;
  projectionSurface?: ProjectionSurface | null;
  plateFit: string;
  handleRadius: number;
  hitLocalPad: number;
  preferActiveBody?: boolean;
}): PlateSketchEditorHit | null {
  if (!point) return null;

  const activeGeometry = geometries.find((geometry) => geometry.index === activeIndex) || null;
  const handle = hitPlateEditorHandle(point, activeGeometry?.handles || [], handleRadius);
  if (handle) return { index: activeIndex, handle };

  if (!direction) return null;
  if (
    preferActiveBody &&
    activeIndex >= 0 &&
    activeIndex < Math.min(plates.length, placements.length) &&
    sourceDirectionHitsPlatePlacement({
      direction,
      placement: placements[activeIndex],
      plate: plates[activeIndex],
      projectionMode: sourceProjectionMode,
      innerGuideSplit,
      carrierHorizonRadius,
      projectionSurface,
      plateFit,
      hitLocalPad,
    })
  ) {
    return { index: activeIndex, handle: { action: "move" } };
  }
  for (let index = Math.min(plates.length, placements.length) - 1; index >= 0; index -= 1) {
    if (
      sourceDirectionHitsPlatePlacement({
        direction,
        placement: placements[index],
        plate: plates[index],
        projectionMode: sourceProjectionMode,
        innerGuideSplit,
        carrierHorizonRadius,
        projectionSurface,
        plateFit,
        hitLocalPad,
      })
    ) {
      return { index, handle: { action: "move" } };
    }
  }
  return null;
}

export function beginPlateSketchEditorDrag({
  pointerId,
  point,
  hit,
  geometry,
  placement,
  plate,
  adapter,
  sourceProjectionMode,
  innerGuideSplit,
  carrierHorizonRadius,
  projectionSurface,
  plateEditMode,
  shiftKey = false,
  altKey = false,
}: {
  pointerId: number;
  point: Point2D | null;
  hit: PlateSketchEditorHit;
  geometry: PlateSketchEditorGeometry | null;
  placement: NormalizedPlatePlacement | null | undefined;
  plate: PlateLike | null | undefined;
  adapter: PlateEditorProjectionAdapter;
  sourceProjectionMode: SourceProjectionMode;
  innerGuideSplit?: number | string | null;
  carrierHorizonRadius?: number | string | null;
  projectionSurface?: ProjectionSurface | null;
  plateEditMode: "scale" | "warp";
  shiftKey?: boolean;
  altKey?: boolean;
}): PlateSketchEditorDrag | null {
  if (!point || !geometry || !placement || !plate) return null;
  const prepared = preparePlatePlacement(
    placement,
    plate,
    sourceProjectionMode,
    innerGuideSplit,
    carrierHorizonRadius,
    projectionSurface,
  );
  const direction = adapter.sourceDirectionAt(point);

  if (hit.handle.action === "rotate") {
    return {
      action: "rotate",
      pointerId,
      startSpin: placement.spin,
      startLocal: plateLocalFromSourceDirection(direction, prepared),
      startPrepared: prepared,
      started: false,
    };
  }

  if (hit.handle.action === "scale") {
    const useWarp = plateEditMode === "warp" || shiftKey || altKey;
    if (useWarp) {
      return {
        action: "warp",
        pointerId,
        corner: hit.handle.corner,
        startLocal: plateLocalFromSourceDirection(direction, prepared),
        startPrepared: prepared,
        startCornerOffsets: clonePlateCornerOffsets(prepared.cornerOffsets),
      };
    }
    return {
      action: "scale",
      pointerId,
      startScale: placement.scale,
      startLocal: plateLocalFromSourceDirection(direction, prepared),
      startPrepared: prepared,
    };
  }

  return {
    action: "move",
    pointerId,
    startClient: point,
    startCenter: geometry.center,
    startPointerDirection: direction,
    startCenterDirection: prepared.center,
    started: false,
  };
}

export function updatePlateSketchEditorDrag({
  drag,
  pointerId,
  point,
  placement,
  plate,
  adapter,
  sourceProjectionMode,
  innerGuideSplit,
  carrierHorizonRadius,
  projectionSurface,
  minScale,
  maxScale,
  dragThresholdPx = 3,
}: {
  drag: PlateSketchEditorDrag;
  pointerId: number;
  point: Point2D | null;
  placement: NormalizedPlatePlacement | null | undefined;
  plate: PlateLike | null | undefined;
  adapter: PlateEditorProjectionAdapter;
  sourceProjectionMode: SourceProjectionMode;
  innerGuideSplit?: number | string | null;
  carrierHorizonRadius?: number | string | null;
  projectionSurface?: ProjectionSurface | null;
  minScale: number;
  maxScale: number;
  dragThresholdPx?: number;
}): PlateSketchEditorDragUpdate {
  if (pointerId !== drag.pointerId || !placement) return { kind: "ignored", drag };
  if (!point) return updated(drag, placement, plate, false);

  if (drag.action === "move") {
    return updateMoveDrag({
      drag,
      point,
      placement,
      plate,
      adapter,
      sourceProjectionMode,
      innerGuideSplit,
      carrierHorizonRadius,
      projectionSurface,
      dragThresholdPx,
    });
  }
  if (drag.action === "scale") {
    return updateScaleDrag({ drag, point, placement, plate, adapter, minScale, maxScale });
  }
  if (drag.action === "warp") {
    return updateWarpDrag({ drag, point, placement, plate, adapter });
  }
  return updateRotateDrag({ drag, point, placement, plate, adapter, dragThresholdPx });
}

function updateMoveDrag({
  drag,
  point,
  placement,
  plate,
  adapter,
  sourceProjectionMode,
  innerGuideSplit,
  carrierHorizonRadius,
  projectionSurface,
  dragThresholdPx,
}: {
  drag: Extract<PlateSketchEditorDrag, { action: "move" }>;
  point: Point2D;
  placement: NormalizedPlatePlacement;
  plate: PlateLike | null | undefined;
  adapter: PlateEditorProjectionAdapter;
  sourceProjectionMode: SourceProjectionMode;
  innerGuideSplit?: number | string | null;
  carrierHorizonRadius?: number | string | null;
  projectionSurface?: ProjectionSurface | null;
  dragThresholdPx: number;
}): PlateSketchEditorDragUpdate {
  const nextCenter = {
    x: drag.startCenter.x + point.x - drag.startClient.x,
    y: drag.startCenter.y + point.y - drag.startClient.y,
  };
  const nextDrag =
    !drag.started && distance2d(nextCenter, drag.startCenter) >= dragThresholdPx ? { ...drag, started: true } : drag;
  if (!nextDrag.started) return updated(nextDrag, placement, plate, false);

  if (adapter.mode === "source-map") {
    const domePoint = adapter.sourcePointAt(nextCenter);
    return domePoint
      ? updated(nextDrag, { ...placement, azimuth: domePoint.azimuth, radius: domePoint.radius }, plate, true)
      : updated(nextDrag, placement, plate, false);
  }

  if (drag.startPointerDirection) {
    const currentDirection = adapter.sourceDirectionAt(point);
    if (!currentDirection) return updated(nextDrag, placement, plate, false);
    const movedDomePoint = moveDomePointBySourcePointerDrag(
      drag.startCenterDirection,
      drag.startPointerDirection,
      currentDirection,
      sourceProjectionMode,
      innerGuideSplit,
      carrierHorizonRadius,
      projectionSurface,
    );
    return updated(
      nextDrag,
      { ...placement, azimuth: movedDomePoint.azimuth, radius: movedDomePoint.radius },
      plate,
      true,
    );
  }

  const domePoint = adapter.sourcePointAt(nextCenter);
  if (!domePoint) return updated(nextDrag, placement, plate, false);
  return updated(nextDrag, { ...placement, azimuth: domePoint.azimuth, radius: domePoint.radius }, plate, true);
}

function updateScaleDrag({
  drag,
  point,
  placement,
  plate,
  adapter,
  minScale,
  maxScale,
}: {
  drag: Extract<PlateSketchEditorDrag, { action: "scale" }>;
  point: Point2D;
  placement: NormalizedPlatePlacement;
  plate: PlateLike | null | undefined;
  adapter: PlateEditorProjectionAdapter;
  minScale: number;
  maxScale: number;
}): PlateSketchEditorDragUpdate {
  const direction = adapter.sourceDirectionAt(point);
  const local = plateLocalFromSourceDirection(direction, drag.startPrepared);
  const scale = scaleFromSourceLocalDrag(
    drag.startScale,
    drag.startLocal,
    local,
    {
      x: drag.startPrepared.angularWidth * 0.5,
      y: drag.startPrepared.angularHeight * 0.5,
    },
    minScale,
    maxScale,
  );
  if (scale === null) return updated(drag, placement, plate, false);
  return updated(drag, { ...placement, scale }, plate, scale !== placement.scale);
}

function updateRotateDrag({
  drag,
  point,
  placement,
  plate,
  adapter,
  dragThresholdPx,
}: {
  drag: Extract<PlateSketchEditorDrag, { action: "rotate" }>;
  point: Point2D;
  placement: NormalizedPlatePlacement;
  plate: PlateLike | null | undefined;
  adapter: PlateEditorProjectionAdapter;
  dragThresholdPx: number;
}): PlateSketchEditorDragUpdate {
  const direction = adapter.sourceDirectionAt(point);
  const local = plateLocalFromSourceDirection(direction, drag.startPrepared);
  const spin = spinFromSourceLocalRotateDrag(drag.startSpin, drag.startLocal, local);
  if (spin === null) return updated(drag, placement, plate, false);
  const nextDrag =
    !drag.started && Math.abs(wrapDegrees(spin - drag.startSpin)) >= dragThresholdPx
      ? { ...drag, started: true }
      : drag;
  if (!nextDrag.started) return updated(nextDrag, placement, plate, false);
  return updated(nextDrag, { ...placement, spin }, plate, spin !== placement.spin);
}

function updateWarpDrag({
  drag,
  point,
  placement,
  plate,
  adapter,
}: {
  drag: Extract<PlateSketchEditorDrag, { action: "warp" }>;
  point: Point2D;
  placement: NormalizedPlatePlacement;
  plate: PlateLike | null | undefined;
  adapter: PlateEditorProjectionAdapter;
}): PlateSketchEditorDragUpdate {
  const direction = adapter.sourceDirectionAt(point);
  const local = plateLocalFromSourceDirection(direction, drag.startPrepared);
  const nextOffsets = cornerOffsetsFromSourceLocalDrag(
    drag.startPrepared,
    drag.corner,
    drag.startLocal,
    local,
    drag.startCornerOffsets,
  );
  if (!nextOffsets) return updated(drag, placement, plate, false);
  return updated(drag, { ...placement, cornerOffsets: nextOffsets }, plate, true);
}

function updated(
  drag: PlateSketchEditorDrag,
  placement: NormalizedPlatePlacement,
  plate: PlateLike | null | undefined,
  changed: boolean,
): PlateSketchEditorDragUpdate {
  return {
    kind: "updated",
    drag,
    placement: normalizePlatePlacement(placement, plate),
    changed,
  };
}
