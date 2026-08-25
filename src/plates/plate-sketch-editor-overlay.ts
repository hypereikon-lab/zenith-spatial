import type { Point2D } from "../projection.js";
import type { PlateSketchEditorViewModel } from "./plate-sketch-editor-view-model.js";
import type { ProjectedSpatialAnchorGuide } from "./projected-physical-horizon.js";

export type PlateSketchEditorOverlayInput = {
  context: CanvasRenderingContext2D;
  viewModel: PlateSketchEditorViewModel;
  canvasWidth: number;
  canvasHeight: number;
  previewWidth: number;
  previewHeight: number;
  activeIndex: number;
  plateEditMode: "scale" | "warp";
  projectedGuides?: readonly ProjectedSpatialAnchorGuide[];
  coordinateSpace?: "preview-size" | "canvas";
};

export function renderPlateSketchEditorOverlay({
  context,
  viewModel,
  canvasWidth,
  canvasHeight,
  previewWidth,
  previewHeight,
  activeIndex,
  plateEditMode,
  projectedGuides,
  coordinateSpace = "preview-size",
}: PlateSketchEditorOverlayInput): void {
  context.clearRect(0, 0, canvasWidth, canvasHeight);
  context.save();
  if (coordinateSpace === "preview-size") {
    context.scale(canvasWidth / previewWidth, canvasHeight / previewHeight);
  }
  drawPlateEditorOverlay(context, viewModel, activeIndex, plateEditMode, projectedGuides);
  context.restore();
}

function drawPlateEditorOverlay(
  context: CanvasRenderingContext2D,
  viewModel: PlateSketchEditorViewModel,
  activeIndex: number,
  plateEditMode: "scale" | "warp",
  projectedGuides: readonly ProjectedSpatialAnchorGuide[] = [],
): void {
  context.save();
  for (const geometry of viewModel.geometries) {
    const active = geometry.index === activeIndex;
    context.lineWidth = active ? 2.2 : 1.15;
    context.strokeStyle = active ? "rgba(117, 215, 229, 0.96)" : "rgba(230, 244, 248, 0.38)";
    context.fillStyle = active ? "rgba(117, 215, 229, 0.1)" : "rgba(230, 244, 248, 0.035)";
    drawOutline(context, geometry.outlineSegments, geometry.outlineClosed);
    if (active) {
      drawCenterHandle(context, geometry.center);
      if (geometry.rotateAnchor && geometry.rotateHandle) {
        context.beginPath();
        context.moveTo(geometry.rotateAnchor.x, geometry.rotateAnchor.y);
        context.lineTo(geometry.rotateHandle.x, geometry.rotateHandle.y);
        context.stroke();
      }
      for (const handle of geometry.handles) {
        if (handle.action === "scale") {
          drawSquareHandle(context, handle, plateEditMode === "warp");
        } else {
          drawRoundHandle(context, handle);
        }
      }
    }
  }
  for (const guide of projectedGuides) drawProjectedSpatialAnchor(context, guide);
  context.restore();
}

function drawProjectedSpatialAnchor(context: CanvasRenderingContext2D, guide: ProjectedSpatialAnchorGuide): void {
  context.save();
  context.strokeStyle = guide.id === "semantic" ? "rgba(220, 166, 86, 0.96)" : "rgba(97, 216, 239, 0.94)";
  context.lineWidth = 2;
  context.setLineDash([7, 5]);
  context.shadowColor = "rgba(0, 0, 0, 0.85)";
  context.shadowBlur = 4;
  for (const segment of guide.segments) {
    if (segment.length < 2) continue;
    context.beginPath();
    context.moveTo(segment[0].x, segment[0].y);
    for (const point of segment.slice(1)) context.lineTo(point.x, point.y);
    context.stroke();
  }
  context.setLineDash([]);
  if (guide.handle) {
    context.fillStyle = "rgba(4, 10, 14, 0.94)";
    context.lineWidth = 3;
    context.beginPath();
    context.arc(guide.handle.x, guide.handle.y, 12, 0, Math.PI * 2);
    context.fill();
    context.stroke();
    context.beginPath();
    context.moveTo(guide.handle.x - 5, guide.handle.y);
    context.lineTo(guide.handle.x + 5, guide.handle.y);
    context.stroke();

    context.shadowBlur = 3;
    context.fillStyle = "rgba(226, 248, 252, 0.96)";
    context.font = "600 11px ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace";
    context.textBaseline = "middle";
    const unit = guide.unit === "meters" ? "M" : "°";
    context.fillText(
      `${guide.label.toUpperCase()} ${guide.value.toFixed(guide.unit === "meters" ? 2 : 1)} ${unit}`,
      guide.handle.x + 19,
      guide.handle.y,
    );
  }
  context.restore();
}

function drawOutline(context: CanvasRenderingContext2D, outlineSegments: Point2D[][], closed: boolean): void {
  const drawableSegments = outlineSegments.filter((segment) => segment.length > 1);
  if (drawableSegments.length === 0) return;
  for (const segment of drawableSegments) {
    context.beginPath();
    context.moveTo(segment[0].x, segment[0].y);
    for (const point of segment.slice(1)) context.lineTo(point.x, point.y);
    if (closed && drawableSegments.length === 1) {
      context.closePath();
      context.fill();
    }
    context.stroke();
  }
}

function drawCenterHandle(context: CanvasRenderingContext2D, point: Point2D): void {
  context.save();
  context.fillStyle = "rgba(117, 215, 229, 0.22)";
  context.strokeStyle = "rgba(117, 215, 229, 0.96)";
  context.lineWidth = 2;
  context.beginPath();
  context.arc(point.x, point.y, 13, 0, Math.PI * 2);
  context.fill();
  context.stroke();
  context.restore();
}

function drawSquareHandle(context: CanvasRenderingContext2D, point: Point2D, warpMode: boolean): void {
  const size = warpMode ? 32 : 28;
  context.save();
  context.fillStyle = warpMode ? "rgba(238, 120, 109, 0.92)" : "rgba(6, 10, 13, 0.92)";
  context.strokeStyle = "rgba(180, 255, 225, 0.98)";
  context.lineWidth = 2;
  context.beginPath();
  context.rect(point.x - size * 0.5, point.y - size * 0.5, size, size);
  context.fill();
  context.stroke();
  context.restore();
}

function drawRoundHandle(context: CanvasRenderingContext2D, point: Point2D): void {
  context.save();
  context.fillStyle = "rgba(6, 10, 13, 0.92)";
  context.strokeStyle = "rgba(180, 255, 225, 0.98)";
  context.lineWidth = 2;
  context.beginPath();
  context.arc(point.x, point.y, 15, 0, Math.PI * 2);
  context.fill();
  context.stroke();
  context.restore();
}
