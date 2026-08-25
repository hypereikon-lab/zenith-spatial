import { describe, expect, test } from "vitest";
import { clientPointToViewportPoint, pointerEventClientPoint } from "./editor-viewport.js";
import {
  nearestEditableSourceGuideBreakpoint,
  sourceGuideBreakpointKeyboardRadius,
  sourceGuideRadiusFromClientX,
} from "./source-guide-editor.js";
import type { SourceGuideBreakpoint } from "./source-guide-semantics.js";

describe("editor viewport primitives", () => {
  test("maps client coordinates into viewport coordinates with optional clamping", () => {
    const rect = { left: 10, top: 20, width: 200, height: 100 };
    const viewport = { width: 1000, height: 500 };

    expect(clientPointToViewportPoint({ x: 110, y: 70 }, rect, viewport)).toEqual({ x: 500, y: 250 });
    expect(clientPointToViewportPoint({ x: -20, y: 200 }, rect, viewport, { clampToViewport: true })).toEqual({
      x: 0,
      y: 500,
    });
    expect(pointerEventClientPoint({ clientX: 7, clientY: 9 })).toEqual({ x: 7, y: 9 });
  });

  test("computes source-guide rail radius and nearest editable breakpoint", () => {
    const breakpoints: SourceGuideBreakpoint[] = [
      { id: "inner-split", label: "Inner", radius: 0.3, editable: true, role: "semantic-split" },
      { id: "carrier-horizon", label: "Horizon", radius: 0.72, editable: true, role: "horizon" },
      { id: "physical-horizon", label: "Fixed", radius: 0.9, editable: false, role: "horizon" },
    ];

    expect(sourceGuideRadiusFromClientX(60, { left: 10, top: 0, width: 100, height: 20 })).toBeCloseTo(0.5, 5);
    expect(nearestEditableSourceGuideBreakpoint(breakpoints, 0.68)?.id).toBe("carrier-horizon");
    expect(nearestEditableSourceGuideBreakpoint(breakpoints, 0.93)?.id).toBe("carrier-horizon");
  });

  test("keeps source-guide keyboard radius updates pure", () => {
    expect(sourceGuideBreakpointKeyboardRadius({ currentRadius: 0.4, key: "ArrowRight" })).toEqual({
      action: "set",
      radius: 0.41000000000000003,
    });
    expect(sourceGuideBreakpointKeyboardRadius({ currentRadius: 0.4, key: "ArrowDown", shiftKey: true })).toEqual({
      action: "set",
      radius: 0.35000000000000003,
    });
    expect(sourceGuideBreakpointKeyboardRadius({ currentRadius: 0.4, key: "Escape" })).toEqual({ action: "none" });
  });
});
