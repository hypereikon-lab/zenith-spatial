import { describe, expect, test } from "vitest";

import { LookaroundNavigation } from "./lookaround-navigation.js";

describe("lookaround touch navigation", () => {
  test("keeps one-finger drag as yaw and pitch", () => {
    const navigation = new LookaroundNavigation(2);
    navigation.pointerDown(1, 100, 100, [0, 0, 1]);
    expect(navigation.pointerMove(1, 150, 120, [0, 0, 1])).toBe("drag");
    expect(navigation.state()).toMatchObject({ yawDegrees: 8, pitchDegrees: 2.6, offsetMeters: 0 });
  });

  test("maps pinch expansion to forward travel and contraction to backward travel", () => {
    const navigation = new LookaroundNavigation(2);
    navigation.setViewportSize(400, 800);
    navigation.pointerDown(1, 100, 100, [0, 0, 1]);
    navigation.pointerDown(2, 200, 100, [0, 0, 1]);
    expect(navigation.pointerMove(2, 300, 100, [0, 0, 1])).toBe("pinch");
    expect(navigation.state().offset).toEqual([0, 0, 0.625]);

    navigation.recenter([0, 0, 1]);
    navigation.pointerMove(2, 250, 100, [0, 0, 1]);
    expect(navigation.state().offset).toEqual([0, 0, -0.3125]);
  });

  test("accumulates movement in world space instead of orbiting when the view turns", () => {
    const navigation = new LookaroundNavigation(3);
    navigation.dollyBy(1, [0, 0, 1]);
    navigation.dollyBy(1, [1, 0, 0]);
    expect(navigation.state().offset).toEqual([1, 0, 1]);
  });

  test("clamps spatial travel to its configured bounded range", () => {
    const navigation = new LookaroundNavigation(2);
    navigation.dollyBy(10, [0, 0, 1]);
    expect(navigation.state().offset).toEqual([0, 0, 2]);
    expect(navigation.state().offsetMeters).toBe(2);
  });

  test("rebases the remaining pointer after a pinch without a drag jump", () => {
    const navigation = new LookaroundNavigation(2);
    navigation.pointerDown(1, 100, 100, [0, 0, 1]);
    navigation.pointerDown(2, 200, 100, [0, 0, 1]);
    navigation.pointerMove(2, 260, 100, [0, 0, 1]);
    navigation.pointerEnd(2, [0, 0, 1]);
    navigation.pointerMove(1, 100, 100, [0, 0, 1]);
    expect(navigation.state()).toMatchObject({ yawDegrees: 0, pitchDegrees: 0 });
  });

  test("maps wheel-up to forward travel and ignores non-finite input", () => {
    const navigation = new LookaroundNavigation(1.8);
    navigation.dollyFromWheel(-90, [0, 0, 1]);
    expect(navigation.state().offset[2]).toBeCloseTo(0.18, 6);
    navigation.dollyBy(Number.NaN, [0, 0, 1]);
    expect(navigation.state().offset[2]).toBeCloseTo(0.18, 6);
  });

  test("keeps the last valid viewport scale when resize data is invalid", () => {
    const navigation = new LookaroundNavigation(2);
    navigation.setViewportSize(400, 800);
    navigation.setViewportSize(Number.NaN, 800);
    navigation.pointerDown(1, 100, 100, [0, 0, 1]);
    navigation.pointerDown(2, 200, 100, [0, 0, 1]);
    navigation.pointerMove(2, 300, 100, [0, 0, 1]);
    expect(navigation.state().offset).toEqual([0, 0, 0.625]);
  });
});
