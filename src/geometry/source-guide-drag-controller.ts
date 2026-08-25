import {
  nearestEditableSourceGuideBreakpoint,
  sourceGuideBreakpointKeyboardRadius,
  sourceGuideRadiusFromClientX,
} from "./source-guide-editor.js";
import type { EditorClientRect } from "./editor-viewport.js";
import type { SourceGuideBreakpoint } from "./source-guide-semantics.js";

export type SourceGuideBreakpointId = SourceGuideBreakpoint["id"];

export type SourceGuideBreakpointDragState = {
  id: SourceGuideBreakpointId;
  pointerId: number;
  railRect: EditorClientRect;
};

export type SourceGuideBreakpointRadiusUpdate =
  | {
      action: "set";
      id: SourceGuideBreakpointId;
      radius: number;
    }
  | {
      action: "none";
    };

export function sourceGuideBreakpointFromRailPointer({
  breakpoints,
  clientX,
  railRect,
}: {
  breakpoints: SourceGuideBreakpoint[];
  clientX: number;
  railRect: EditorClientRect;
}): SourceGuideBreakpoint | null {
  return nearestEditableSourceGuideBreakpoint(breakpoints, sourceGuideRadiusFromClientX(clientX, railRect));
}

export function beginSourceGuideBreakpointDrag({
  id,
  pointerId,
  railRect,
}: {
  id: SourceGuideBreakpointId;
  pointerId: number;
  railRect: EditorClientRect;
}): SourceGuideBreakpointDragState {
  return {
    id,
    pointerId,
    railRect: {
      left: railRect.left,
      top: railRect.top,
      width: railRect.width,
      height: railRect.height,
    },
  };
}

export function updateSourceGuideBreakpointDrag({
  drag,
  pointerId,
  clientX,
}: {
  drag: SourceGuideBreakpointDragState;
  pointerId: number;
  clientX: number;
}): SourceGuideBreakpointRadiusUpdate {
  if (pointerId !== drag.pointerId) return { action: "none" };
  return {
    action: "set",
    id: drag.id,
    radius: sourceGuideRadiusFromClientX(clientX, drag.railRect),
  };
}

export function sourceGuideBreakpointRadiusFromKey({
  breakpoints,
  id,
  key,
  shiftKey = false,
}: {
  breakpoints: SourceGuideBreakpoint[];
  id: SourceGuideBreakpointId;
  key: string;
  shiftKey?: boolean;
}): SourceGuideBreakpointRadiusUpdate {
  const breakpoint = breakpoints.find((candidate) => candidate.id === id);
  if (!breakpoint) return { action: "none" };
  const next = sourceGuideBreakpointKeyboardRadius({
    currentRadius: breakpoint.radius,
    key,
    shiftKey,
  });
  if (next.action === "none") return next;
  return {
    action: "set",
    id,
    radius: next.radius,
  };
}
