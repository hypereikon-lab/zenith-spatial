import { describe, expect, test } from "vitest";
import {
  DOME_HANDOFF_GUIDE,
  domeGuideBackgroundColor,
  domeGuidePromptClause,
  domeGuideScaffold,
} from "./dome-handoff-guide.js";

describe("dome handoff guide", () => {
  test("separates zenith 180 inner sky from outer horizon/human-level continuity", () => {
    expect(domeGuideBackgroundColor("zenith-180", 0, 1)).toEqual([...DOME_HANDOFF_GUIDE.colors.sky]);
    expect(domeGuideBackgroundColor("zenith-180", 0.92, 1)).toEqual([...DOME_HANDOFF_GUIDE.colors.horizon]);
  });

  test("separates zenith 230 sky, horizon, and below-horizon lower-world areas", () => {
    expect(domeGuideBackgroundColor("zenith-230", 0.2, 18 / 23)).toEqual([...DOME_HANDOFF_GUIDE.colors.sky]);
    expect(domeGuideBackgroundColor("zenith-230", 0.5, 18 / 23)).toEqual([...DOME_HANDOFF_GUIDE.colors.horizon]);
    expect(domeGuideBackgroundColor("zenith-230", 0.96, 18 / 23)).toEqual([...DOME_HANDOFF_GUIDE.colors.floor]);
    expect(domeGuideBackgroundColor("zenith-230", 0.72, 18 / 23, 1 / 3, 0.74)).toEqual([
      ...DOME_HANDOFF_GUIDE.colors.horizon,
    ]);
    expect(domeGuideBackgroundColor("zenith-230", 0.82, 18 / 23, 1 / 3, 0.74)).toEqual([
      ...DOME_HANDOFF_GUIDE.colors.floor,
    ]);
  });

  test("keeps nadir center as floor and reserves the outside for horizon-level continuity", () => {
    expect(domeGuideBackgroundColor("nadir-180", 0.1, 1)).toEqual([...DOME_HANDOFF_GUIDE.colors.floor]);
    expect(domeGuideBackgroundColor("nadir-180", 1, 1)).toEqual([...DOME_HANDOFF_GUIDE.colors.horizon]);
  });

  test("normalizes configurable semantic split values", () => {
    expect(domeGuideBackgroundColor("zenith-180", 0.4, 1, 0.5)).toEqual([...DOME_HANDOFF_GUIDE.colors.sky]);
    expect(domeGuideBackgroundColor("zenith-180", 0.6, 1, 0.5)).toEqual([...DOME_HANDOFF_GUIDE.colors.horizon]);
  });

  test("derives optional contour rings outside the compressed semantic center", () => {
    const scaffold = domeGuideScaffold("zenith-180", 1, 1 / 3);

    expect(scaffold.spokeStartRadius).toBeCloseTo(1 / 3);
    expect(scaffold.ringRadii[0]).toBeCloseTo(1 / 3);
    expect(scaffold.ringRadii).toEqual([0.3333, 0.6667]);
  });

  test("keeps zenith 230 horizon as an optional contour while remapping wall contours", () => {
    const scaffold = domeGuideScaffold("zenith-230", 18 / 23, 1 / 3, 0.7);

    expect(scaffold.spokeStartRadius).toBeCloseTo(1 / 3);
    expect(scaffold.ringRadii).toContain(0.7);
    expect(scaffold.ringRadii.every((radius) => radius >= 0.3333)).toBe(true);
  });

  test("describes the color harness per projection", () => {
    expect(domeGuidePromptClause("zenith-180")).toContain("outer field is the human-level directional band");
    expect(domeGuidePromptClause("zenith-230")).toContain("outer annulus is the below-horizon band");
    expect(domeGuidePromptClause("zenith-230", 1 / 3, 0.7)).toContain(
      "physical horizon is remapped to a second guide boundary at 70%",
    );
    expect(domeGuidePromptClause("nadir-180")).toContain("inner disk is the downward directional band");
    expect(domeGuidePromptClause("zenith-180", 0.5)).toContain("50% from the center");
    expect(domeGuidePromptClause("zenith-180")).toContain("continuous field provides positional evidence");
    expect(domeGuidePromptClause("zenith-180")).toContain(
      "without prescribing subject matter or baking rings and spokes",
    );
  });
});
