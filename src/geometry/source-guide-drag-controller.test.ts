import { describe, expect, test } from "vitest";
import {
  beginSourceGuideBreakpointDrag,
  sourceGuideBreakpointFromRailPointer,
  sourceGuideBreakpointRadiusFromKey,
  updateSourceGuideBreakpointDrag,
} from "./source-guide-drag-controller.js";
import type { SourceGuideBreakpoint } from "./source-guide-semantics.js";

describe("source guide drag controller", () => {
  const breakpoints: SourceGuideBreakpoint[] = [
    { id: "inner-split", label: "Inner", radius: 0.3, editable: true, role: "semantic-split" },
    { id: "carrier-horizon", label: "Horizon", radius: 0.72, editable: true, role: "horizon" },
    { id: "physical-horizon", label: "Fixed", radius: 0.9, editable: false, role: "horizon" },
  ];
  const railRect = { left: 10, top: 0, width: 100, height: 20 };

  test("selects the nearest editable breakpoint from a rail pointer", () => {
    expect(sourceGuideBreakpointFromRailPointer({ breakpoints, clientX: 78, railRect })?.id).toBe("carrier-horizon");
    expect(sourceGuideBreakpointFromRailPointer({ breakpoints, clientX: 94, railRect })?.id).toBe("carrier-horizon");
  });

  test("begins drags as JSON-safe state and clamps pointer radius updates", () => {
    const drag = beginSourceGuideBreakpointDrag({
      id: "inner-split",
      pointerId: 9,
      railRect,
    });

    expect(JSON.parse(JSON.stringify(drag))).toEqual(drag);
    expect(updateSourceGuideBreakpointDrag({ drag, pointerId: 9, clientX: -20 })).toEqual({
      action: "set",
      id: "inner-split",
      radius: 0,
    });
    expect(updateSourceGuideBreakpointDrag({ drag, pointerId: 9, clientX: 160 })).toEqual({
      action: "set",
      id: "inner-split",
      radius: 1,
    });
  });

  test("ignores non-owning pointer ids", () => {
    const drag = beginSourceGuideBreakpointDrag({
      id: "carrier-horizon",
      pointerId: 9,
      railRect,
    });

    expect(updateSourceGuideBreakpointDrag({ drag, pointerId: 10, clientX: 50 })).toEqual({ action: "none" });
  });

  test("converts key commands into breakpoint radius updates", () => {
    expect(sourceGuideBreakpointRadiusFromKey({
      breakpoints,
      id: "inner-split",
      key: "ArrowRight",
    })).toEqual({
      action: "set",
      id: "inner-split",
      radius: 0.31,
    });
    expect(sourceGuideBreakpointRadiusFromKey({
      breakpoints,
      id: "carrier-horizon",
      key: "ArrowDown",
      shiftKey: true,
    })).toEqual({
      action: "set",
      id: "carrier-horizon",
      radius: 0.6699999999999999,
    });
    expect(sourceGuideBreakpointRadiusFromKey({
      breakpoints,
      id: "inner-split",
      key: "Escape",
    })).toEqual({ action: "none" });
  });
});
