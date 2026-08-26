import { describe, expect, test } from "vitest";

import { DEFAULT_AUDIENCE_IN_SPACE } from "../domain/schema.js";
import {
  audienceCameraForProjection,
  audienceFromProjectionCamera,
  audienceVenuePlan,
  normalizeAudienceInSpace,
  walkAudienceInSpace,
} from "./audience-in-space.js";

describe("audience in space", () => {
  test("turns an angular carrier into a physical dome without changing its source geometry", () => {
    const audience = { ...DEFAULT_AUDIENCE_IN_SPACE, eyeHeightMeters: 1.5, domeRadiusMeters: 7.5 };
    const camera = audienceCameraForProjection(audience, "zenith-180", { kind: "angular" });

    expect(audienceVenuePlan(audience, "zenith-180", { kind: "angular" })).toMatchObject({
      shape: "circle",
      widthMeters: 15,
      heightMeters: 7.5,
    });
    expect(camera.position).toEqual([0, 0.2, 0]);
    expect(camera.mode).toBe("inside");
    expect(camera.pivot).toBeNull();
  });

  test("keeps the audience pose independent from an off-centre projection observer", () => {
    const surface = {
      kind: "box-room" as const,
      width: 12,
      depth: 8,
      height: 5,
      eyeHeight: 2,
      eyeX: 1.5,
      eyeZ: -0.5,
    };
    const audience = { ...DEFAULT_AUDIENCE_IN_SPACE, xMeters: -2, zMeters: 1, eyeHeightMeters: 1.7 };
    const camera = audienceCameraForProjection(audience, "cave-270", surface);

    expect(camera.position).toEqual([-3.5, -0.30000000000000004, 1.5]);
    expect(audienceFromProjectionCamera(camera, audience, "cave-270", surface)).toMatchObject({
      xMeters: -2,
      zMeters: 1,
      eyeHeightMeters: 1.7,
    });
  });

  test("clamps a person to the measurable interior", () => {
    const audience = normalizeAudienceInSpace(
      { ...DEFAULT_AUDIENCE_IN_SPACE, xMeters: 99, zMeters: 99, eyeHeightMeters: 99, pitchDegrees: 120 },
      "cylinder-zenith",
      { kind: "cylinder", radius: 5, height: 4, eyeHeight: 1.8 },
    );

    expect(Math.hypot(audience.xMeters, audience.zMeters)).toBeCloseTo(4.8, 8);
    expect(audience.eyeHeightMeters).toBe(3.8);
    expect(audience.pitchDegrees).toBe(85);
  });

  test("walks on the floor plane in the facing direction", () => {
    const moved = walkAudienceInSpace(
      { ...DEFAULT_AUDIENCE_IN_SPACE, yawDegrees: 90, eyeHeightMeters: 1.72 },
      1.5,
      "cave-270",
      { kind: "box-room", width: 10, depth: 8, height: 4, eyeHeight: 2, eyeX: 0, eyeZ: 0 },
    );
    expect(moved.xMeters).toBeCloseTo(1.5, 8);
    expect(moved.zMeters).toBeCloseTo(0, 8);
    expect(moved.eyeHeightMeters).toBe(1.72);
  });

  test("keeps eye height below the local profiled-hall roof", () => {
    const audience = normalizeAudienceInSpace(
      { ...DEFAULT_AUDIENCE_IN_SPACE, zMeters: -4.8, eyeHeightMeters: 8 },
      "hall-double-gable",
      {
        kind: "double-gable-room",
        length: 20,
        width: 10,
        eaveHeight: 4,
        ridgeHeight: 8,
        valleyHeight: 5,
        ridgeInset: 2.5,
        eyeHeight: 1.65,
        eyeX: 0,
        eyeZ: 0,
      },
    );
    expect(audience.eyeHeightMeters).toBeLessThan(4.2);
  });
});
