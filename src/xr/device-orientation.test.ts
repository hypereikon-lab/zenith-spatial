import { describe, expect, test } from "vitest";

import { multiplyQuaternions, quaternionFromAxisAngle, type Quaternion } from "../geometry/camera-rig.js";
import {
  identityDeviceOrientation,
  quaternionAngularDistanceDegrees,
  quaternionFromDeviceOrientation,
  relativeDeviceOrientation,
  StabilizedDeviceOrientation,
  stabilizeDeviceOrientation,
  offsetZenithCameraBasis,
  zenithCameraBasisFromRelativeDeviceOrientation,
  zenithForwardFromRelativeDeviceOrientation,
} from "./device-orientation.js";

const closeQuaternion = (left: Quaternion, right: Quaternion, precision = 6) => {
  const distance = Math.min(
    Math.hypot(...left.map((value, index) => value - right[index]!)),
    Math.hypot(...left.map((value, index) => value + right[index]!)),
  );
  expect(distance).toBeCloseTo(0, precision);
};

const closeVector = (actual: readonly number[], expected: readonly number[], precision = 6) => {
  expect(actual).toEqual(expected.map((value) => expect.closeTo(value, precision)));
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

  test("maps physical right turns and upward turns into Zenith's camera convention", () => {
    const baseline = quaternionFromDeviceOrientation({ alpha: 0, beta: 90, gamma: 0 });
    const rightTurn = relativeDeviceOrientation(
      baseline,
      quaternionFromDeviceOrientation({ alpha: -30, beta: 90, gamma: 0 }),
    );
    const upwardTurn = relativeDeviceOrientation(
      baseline,
      quaternionFromDeviceOrientation({ alpha: 0, beta: 120, gamma: 0 }),
    );

    closeVector(zenithForwardFromRelativeDeviceOrientation(rightTurn), [-0.5, 0, Math.sqrt(3) / 2]);
    closeVector(zenithForwardFromRelativeDeviceOrientation(upwardTurn), [0, 0.5, Math.sqrt(3) / 2]);
  });

  test("preserves physical roll instead of snapping the camera up to portrait or landscape", () => {
    const portrait = quaternionFromDeviceOrientation({ alpha: 0, beta: 90, gamma: 0 });
    // Same forward ray after a physical 90° clockwise roll around the screen normal.
    const rolled = quaternionFromDeviceOrientation({ alpha: 270, beta: 0, gamma: 90 });
    const basis = zenithCameraBasisFromRelativeDeviceOrientation(relativeDeviceOrientation(portrait, rolled));
    closeVector(basis.forward, [0, 0, 1]);
    closeVector(basis.up, [-1, 0, 0]);
    closeVector(basis.right, [0, -1, 0]);
  });

  test("preserves an arbitrary partial roll rather than quantizing it to screen orientation", () => {
    const relativeRoll = quaternionFromAxisAngle([0, 0, 1], -Math.PI / 4);
    const basis = zenithCameraBasisFromRelativeDeviceOrientation(relativeRoll);
    closeVector(basis.forward, [0, 0, 1]);
    closeVector(basis.up, [-Math.SQRT1_2, Math.SQRT1_2, 0]);
    closeVector(basis.right, [-Math.SQRT1_2, -Math.SQRT1_2, 0]);
  });

  test("crosses the zenith and reaches the rear hemisphere without flipping the camera basis", () => {
    const baseline = quaternionFromDeviceOrientation({ alpha: 0, beta: 90, gamma: 0 });
    const before = zenithCameraBasisFromRelativeDeviceOrientation(
      relativeDeviceOrientation(baseline, quaternionFromDeviceOrientation({ alpha: 0, beta: 179, gamma: 0 })),
    );
    const zenith = zenithCameraBasisFromRelativeDeviceOrientation(
      relativeDeviceOrientation(baseline, quaternionFromDeviceOrientation({ alpha: 0, beta: 180, gamma: 0 })),
    );
    const after = zenithCameraBasisFromRelativeDeviceOrientation(
      relativeDeviceOrientation(baseline, quaternionFromDeviceOrientation({ alpha: 0, beta: 181, gamma: 0 })),
    );
    const behind = zenithCameraBasisFromRelativeDeviceOrientation(
      relativeDeviceOrientation(baseline, quaternionFromDeviceOrientation({ alpha: 0, beta: 270, gamma: 0 })),
    );

    closeVector(zenith.forward, [0, 1, 0]);
    closeVector(zenith.up, [0, 0, -1]);
    closeVector(behind.forward, [0, 0, -1]);
    closeVector(behind.up, [0, -1, 0]);
    expect(dot(before.forward, after.forward)).toBeGreaterThan(0.999);
    expect(dot(before.up, after.up)).toBeGreaterThan(0.999);
  });

  test("applies authored and touch offsets to the full basis instead of extracting Euler angles", () => {
    const basis = zenithCameraBasisFromRelativeDeviceOrientation(identityDeviceOrientation());
    const yawed = offsetZenithCameraBasis(basis, 90, 0);
    const pitched = offsetZenithCameraBasis(basis, 0, 90);

    closeVector(yawed.forward, [1, 0, 0]);
    closeVector(yawed.up, [0, 1, 0]);
    closeVector(pitched.forward, [0, 1, 0]);
    closeVector(pitched.up, [0, 0, -1]);
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

function dot(left: readonly number[], right: readonly number[]): number {
  return left.reduce((sum, value, index) => sum + value * right[index]!, 0);
}
