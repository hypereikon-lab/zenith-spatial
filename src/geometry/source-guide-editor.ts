import { clamp } from "../projection.js";
import type { SourceGuideBreakpoint } from "./source-guide-semantics.js";
import type { EditorClientRect } from "./editor-viewport.js";

export type SourceGuideBreakpointKeyResult =
  | {
      action: "set";
      radius: number;
    }
  | {
      action: "none";
    };

export function sourceGuideRadiusFromClientX(clientX: number, rect: EditorClientRect): number {
  return clamp((clientX - rect.left) / Math.max(rect.width, 1), 0, 1);
}

export function nearestEditableSourceGuideBreakpoint(
  breakpoints: SourceGuideBreakpoint[],
  radius: number,
): SourceGuideBreakpoint | null {
  const editable = breakpoints.filter((breakpoint) => breakpoint.editable);
  if (editable.length === 0) return null;
  return editable.reduce((nearest, breakpoint) =>
    Math.abs(breakpoint.radius - radius) < Math.abs(nearest.radius - radius) ? breakpoint : nearest,
  );
}

export function sourceGuideBreakpointKeyboardRadius({
  currentRadius,
  key,
  shiftKey = false,
}: {
  currentRadius: number;
  key: string;
  shiftKey?: boolean;
}): SourceGuideBreakpointKeyResult {
  const step = shiftKey ? 0.05 : 0.01;
  if (key === "Home") return { action: "set", radius: 0 };
  if (key === "End") return { action: "set", radius: 1 };
  if (key === "ArrowLeft" || key === "ArrowDown") return { action: "set", radius: currentRadius - step };
  if (key === "ArrowRight" || key === "ArrowUp") return { action: "set", radius: currentRadius + step };
  return { action: "none" };
}
