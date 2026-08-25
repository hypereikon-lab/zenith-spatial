import { describe, expect, test } from "vitest";
import { buildPlateSketchCommitPayload } from "./plate-sketch-commit.js";
import { normalizePlatePlacement } from "./plate-placement.js";
import { carrierRasterForAspect } from "../lib/shared/contracts/projection-authoring.js";

describe("plate sketch commit payload", () => {
  test("builds the existing artifact patch, result, config, and status shape", () => {
    const placement = normalizePlatePlacement(
      {
        azimuth: 10,
        radius: 0.4,
        scale: 0.7,
        spin: 3,
        opacity: 0.8,
        cornerOffsets: {
          nw: { x: 0.2, y: 0 },
          ne: { x: 0, y: 0 },
          se: { x: 0, y: -0.3 },
          sw: { x: 0, y: 0 },
        },
      },
      { aspect: 1 },
    );

    const payload = buildPlateSketchCommitPayload({
      dataUrl: "data:image/png;base64,fixture",
      plateCount: 1,
      placements: [placement],
      plateFit: "contain",
      plateFeather: 0.02,
      domeGuideSemanticSplit: 0.5,
      domeGuideHorizonSplit: 0.68,
      plateEditMode: "warp",
      projectionProfile: "zenith-180",
      projectionSurface: { kind: "angular" },
      raster: carrierRasterForAspect("16:9"),
      commitWidth: 2560,
      commitHeight: 1440,
    });

    expect(payload.warpedCornerCount).toBe(2);
    expect(payload.status).toBe("2560 × 1440 Plate Sketch handoff committed for inpaint with 2 warped corners.");
    expect(payload.artifactPatch).toMatchObject({
      status: "ready",
      stale: false,
      summary: "1 plates committed as 2560 × 1440 inpaint handoff with 2 warped corners.",
      operatorId: "commit-plates",
      media: {
        kind: "image",
        url: "data:image/png;base64,fixture",
        name: "Committed Plate Sketch (1 plates)",
        mime: "image/png",
        alt: "Committed semantic-color Plate Sketch inpaint handoff",
        blob: null,
        file: null,
        canvas: null,
      },
      config: {
        plateCount: 1,
        plateFit: "contain",
        plateFeather: 0.02,
        domeGuideSemanticSplit: 0.5,
        domeGuideHorizonSplit: 0.68,
        plateEditMode: "warp",
        projectionProfile: "zenith-180",
        projectionSurface: { kind: "angular" },
        raster: carrierRasterForAspect("16:9"),
        commitWidth: 2560,
        commitHeight: 1440,
      },
      warnings: [],
    });
    expect(payload.artifactPatch.config?.placements).toEqual(payload.serializedPlacements);
    expect(payload.result).toMatchObject({
      label: "Committed Plate Sketch (1)",
      media: payload.artifactPatch.media,
      config: payload.artifactPatch.config,
      operatorId: "commit-plates",
    });
  });
});
