import { clamp } from "../projection.js";
import type { Point2D } from "../projection.js";

export type EditorClientRect = {
  left: number;
  top: number;
  width: number;
  height: number;
};

export type EditorViewportSize = {
  width: number;
  height: number;
};

export type EditorClientPointInput = {
  clientX: number;
  clientY: number;
};

export function clientPointToViewportPoint(
  client: Point2D,
  rect: EditorClientRect,
  viewport: EditorViewportSize,
  { clampToViewport = false }: { clampToViewport?: boolean } = {},
): Point2D {
  const x = ((client.x - rect.left) / Math.max(rect.width, 1)) * Math.max(viewport.width, 1);
  const y = ((client.y - rect.top) / Math.max(rect.height, 1)) * Math.max(viewport.height, 1);
  if (!clampToViewport) return { x, y };
  return {
    x: clamp(x, 0, Math.max(viewport.width, 1)),
    y: clamp(y, 0, Math.max(viewport.height, 1)),
  };
}

export function pointerEventClientPoint(event: EditorClientPointInput): Point2D {
  return { x: event.clientX, y: event.clientY };
}
