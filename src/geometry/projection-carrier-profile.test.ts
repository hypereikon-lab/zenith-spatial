import { describe, expect, test } from "vitest";
import { SOURCE_PROJECTION_MODES } from "../lib/shared/contracts/projection-profile.js";
import {
  PROJECTION_CARRIER_PROFILES,
  projectionCarrierRenderTarget,
  sourceProjectionIsCaveCarrier,
  sourceProjectionIsCylinderCarrier,
  sourceProjectionIsGabledShellCarrier,
  sourceProjectionIsRadialCylinderCarrier,
  sourceProjectionIsUnwrappedCylinderCarrier,
  sourceProjectionUsesCircularDomain,
} from "./projection-carrier-profile.js";

describe("projection carrier profile registry", () => {
  test("has one authoritative profile for every persisted mode", () => {
    expect(Object.keys(PROJECTION_CARRIER_PROFILES)).toEqual([...SOURCE_PROJECTION_MODES]);
    for (const mode of SOURCE_PROJECTION_MODES) {
      expect(PROJECTION_CARRIER_PROFILES[mode].mode).toBe(mode);
    }
  });

  test("keeps square and circular carrier domains explicit", () => {
    expect(sourceProjectionIsCaveCarrier("cave-270")).toBe(true);
    expect(sourceProjectionUsesCircularDomain("cave-270")).toBe(false);
    expect(sourceProjectionIsGabledShellCarrier("hall-double-gable")).toBe(true);
    expect(sourceProjectionUsesCircularDomain("hall-double-gable")).toBe(false);
    expect(sourceProjectionIsCylinderCarrier("cylinder-nadir")).toBe(true);
    expect(sourceProjectionUsesCircularDomain("cylinder-nadir")).toBe(true);
    expect(sourceProjectionIsCylinderCarrier("cylinder-wall")).toBe(true);
    expect(sourceProjectionIsRadialCylinderCarrier("cylinder-wall")).toBe(false);
    expect(sourceProjectionIsUnwrappedCylinderCarrier("cylinder-wall")).toBe(true);
    expect(sourceProjectionUsesCircularDomain("cylinder-wall")).toBe(false);
  });

  test("owns the matching authoring render target", () => {
    expect(projectionCarrierRenderTarget("zenith-180")).toBe("source-map");
    expect(projectionCarrierRenderTarget("cave-270")).toBe("cave-carrier");
    expect(projectionCarrierRenderTarget("hall-double-gable")).toBe("cave-carrier");
    expect(projectionCarrierRenderTarget("cylinder-nadir")).toBe("cylinder-carrier");
    expect(projectionCarrierRenderTarget("cylinder-zenith")).toBe("cylinder-carrier");
    expect(projectionCarrierRenderTarget("cylinder-wall")).toBe("cylinder-carrier");
  });
});
