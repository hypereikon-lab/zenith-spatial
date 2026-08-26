import { describe, expect, test } from "vitest";

import { multiplyQuaternions, quaternionFromAxisAngle, type Quaternion } from "../geometry/camera-rig.js";
import {
  identityDeviceOrientation,
  quaternionAngularDistanceDegrees,
  quaternionFromDeviceOrientation,
  relativeDeviceOrientation,
  StabilizedDeviceOrientation,
  stabilizeDeviceOrientation,
  zenithForwardFromRelativeDeviceOrientation,
} from "./device-orientation.js";

const closeQuaternion = (left: Quaternion, right: Quaternion, precision = 6) => {
  const distance = Math.min(
    Math.hypot(...left.map((value, index) => value - right[index]!)),
    Math.hypot(...left.map((value, index) => value + right[index]!)),
  );
  expect(distance).toBeCloseTo(0, precision);
};

describe("device orientation quaternion pipeline", () => {
  test("implements the W3C Z-X'-Y'' quaternion construction", () => {
    closeQuaternion(quaternionFromDeviceOrientation({ alpha: 0, beta: 0, gamma: 0 }), [0, 0, 0, 1]);
    closeQuaternion(
      quaternionFromDeviceOrientation({ alpha: 90, beta: 0, gamma: 0 }),
      quaternionFromAxisAngle([0, 0, 1], Math.PI / 2),
    );
    closeQuaternion(
      quaternionFromDeviceOrientation({ alpha: 0, beta: 90, gamma: 0 }),
      quaternionFromAxisAngle([1, 0, 0], Math.PI / 2),
    );
    closeQuaternion(
      quaternionFromDeviceOrientation({ alpha: 0, beta: 0, gamma: 90 }),
      quaternionFromAxisAngle([0, 1, 0], Math.PI / 2),
    );
  });

  test("stays continuous through the upright Euler singularity", () => {
    const first = quaternionFromDeviceOrientation({ alpha: 10, beta: 90, gamma: 20 });
    const equivalent = quaternionFromDeviceOrientation({ alpha: 20, beta: 90, gamma: 10 });
    closeQuaternion(first, equivalent);
  });

  test("takes the shortest relative rotation across the alpha wrap", () => {
    const baseline = quaternionFromDeviceOrientation({ alpha: 359, beta: 90, gamma: 0 });
    const current = quaternionFromDeviceOrientation({ alpha: 0, beta: 90, gamma: 0 });
    expect(
      quaternionAngularDistanceDegrees(identityDeviceOrientation(), relativeDeviceOrientation(baseline, current)),
    ).toBeCloseTo(1, 5);
  });

  test("maps relative heading and pitch into Zenith's level Y-up view", () => {
    const baseline = quaternionFromDeviceOrientation({ alpha: 0, beta: 90, gamma: 0 });
    const rightTurn = relativeDeviceOrientation(
      baseline,
      quaternionFromDeviceOrientation({ alpha: -30, beta: 90, gamma: 0 }),
    );
    const upwardTurn = relativeDeviceOrientation(
      baseline,
      quaternionFromDeviceOrientation({ alpha: 0, beta: 120, gamma: 0 }),
    );

    expect(zenithForwardFromRelativeDeviceOrientation(rightTurn)).toEqual([
      expect.closeTo(0.5, 6),
      expect.closeTo(0, 6),
      expect.closeTo(Math.sqrt(3) / 2, 6),
    ]);
    expect(zenithForwardFromRelativeDeviceOrientation(upwardTurn)).toEqual([
      expect.closeTo(0, 6),
      expect.closeTo(0.5, 6),
      expect.closeTo(Math.sqrt(3) / 2, 6),
    ]);
  });

  test("keeps the viewing ray stable when the screen moves from portrait to landscape", () => {
    const portrait = quaternionFromDeviceOrientation({ alpha: 0, beta: 90, gamma: 0 });
    // W3C's equivalent upright pose with the top of the screen pointing right.
    const landscape = quaternionFromDeviceOrientation({ alpha: 270, beta: 0, gamma: 90 });
    expect(zenithForwardFromRelativeDeviceOrientation(relativeDeviceOrientation(portrait, landscape))).toEqual([
      expect.closeTo(0, 6),
      expect.closeTo(0, 6),
      expect.closeTo(1, 6),
    ]);
  });

  test("suppresses sub-degree jitter without freezing intentional motion", () => {
    const identity = identityDeviceOrientation();
    const jitter = quaternionFromAxisAngle([0, 1, 0], (0.1 * Math.PI) / 180);
    const target = quaternionFromAxisAngle([0, 1, 0], (20 * Math.PI) / 180);

    expect(stabilizeDeviceOrientation(identity, jitter, 16)).toEqual(identity);
    const first = stabilizeDeviceOrientation(identity, target, 16);
    const second = stabilizeDeviceOrientation(first, target, 16);
    const firstDistance = quaternionAngularDistanceDegrees(identity, first);
    const secondDistance = quaternionAngularDistanceDegrees(identity, second);
    expect(firstDistance).toBeGreaterThan(0);
    expect(secondDistance).toBeGreaterThan(firstDistance);
    expect(secondDistance).toBeLessThan(20);
  });

  test("uses the same shortest path for equivalent quaternion signs", () => {
    const target = multiplyQuaternions(
      quaternionFromAxisAngle([0, 1, 0], Math.PI / 3),
      quaternionFromAxisAngle([1, 0, 0], Math.PI / 8),
    );
    const negated: Quaternion = [-target[0], -target[1], -target[2], -target[3]];
    expect(quaternionAngularDistanceDegrees(target, negated)).toBeCloseTo(0, 7);
  });

  test("recenters the latest accepted pose without retaining filter lag", () => {
    const tracker = new StabilizedDeviceOrientation();
    expect(tracker.ingest({ alpha: 0, beta: 90, gamma: 0 })).toBe(true);
    expect(tracker.ingest({ alpha: -25, beta: 104, gamma: 3 })).toBe(false);
    expect(quaternionAngularDistanceDegrees(identityDeviceOrientation(), tracker.advance(16))).toBeGreaterThan(0);

    tracker.recenter();
    expect(tracker.hasReading()).toBe(true);
    expect(tracker.advance(16)).toEqual(identityDeviceOrientation());
    expect(tracker.ingest({ alpha: -25, beta: 104, gamma: 3 })).toBe(false);
    expect(tracker.advance(16)).toEqual(identityDeviceOrientation());
  });
});
