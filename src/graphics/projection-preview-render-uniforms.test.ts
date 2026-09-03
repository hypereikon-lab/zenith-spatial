import { describe, expect, test } from "vitest";
import { buildProjectionPreviewRenderUniformValue } from "./projection-preview-render-uniforms.js";

describe("projection preview render uniforms", () => {
  test("builds named common render values for both source-map and plate sketch previews", () => {
    const uniforms = buildProjectionPreviewRenderUniformValue({
      targetWidth: 960,
      targetHeight: 540,
      sourceWidth: 2048,
      sourceHeight: 1024,
      sourceProjectionMode: "zenith-230",
      projectionViewMode: "dome-pov",
      projectionCamera: { position: [1, 2, 3] },
      showProjectionGuides: true,
      domeGuideSemanticSplit: 0.42,
      domeGuideHorizonSplit: 0.73,
      showCaveMask: true,
      invertCaveMask: true,
      sourceOverlayOpacity: 1,
      sourceCapDetailAvailable: true,
    });

    expect(uniforms.overlayOpacity).toBeCloseTo(0.78);
    expect(uniforms.showRings).toBe(1);
    expect(uniforms.shellShade).toBeCloseTo(0.12);
    expect(uniforms.showCaveMask).toBe(2);
    expect([uniforms.cameraPosX, uniforms.cameraPosY, uniforms.cameraPosZ]).toEqual([1, 2, 3]);
    expect(uniforms.sourceOverlay).toEqual([1, 1, 0, 0]);
    expect(uniforms.kernel.mode).toBe(1);
    expect(Array.from(uniforms.kernel.fisheyeScale)).toEqual([0.25, 0.5]);
    expect(uniforms.kernel.innerSplit).toBeCloseTo(0.42);
    expect(uniforms.kernel.horizonSplit).toBeCloseTo(0.73);
  });

  test("treats source-map view as dome-orbit for projected preview uniforms", () => {
    const uniforms = buildProjectionPreviewRenderUniformValue({
      targetWidth: 768,
      targetHeight: 768,
      sourceWidth: 768,
      sourceHeight: 768,
      sourceProjectionMode: "zenith-180",
      projectionViewMode: "source-map",
      showProjectionGuides: false,
    });

    expect(uniforms.overlayOpacity).toBeCloseTo(0.28);
    expect(uniforms.showRings).toBe(0);
    expect(uniforms.shellShade).toBeCloseTo(0.3);
    expect(uniforms.sourceOverlay).toEqual([0, 0, 0, 0]);
    expect(uniforms.kernel.mode).toBe(0);
  });

  test("encodes edge review without enabling rings or spokes", () => {
    const uniforms = buildProjectionPreviewRenderUniformValue({
      targetWidth: 768,
      targetHeight: 768,
      sourceWidth: 768,
      sourceHeight: 768,
      sourceProjectionMode: "hall-double-gable",
      projectionViewMode: "cave-room",
      guideOverlay: "edge",
    });

    expect(uniforms.showRings).toBe(0);
    expect(uniforms.showSpokes).toBe(0);
    expect(uniforms.showHorizon).toBe(0);
    expect(uniforms.showSourceCircle).toBe(1);
    expect(uniforms.overlayOpacity).toBeCloseTo(0.78);
  });

  test("disables presentation shading for color-faithful spatial tile capture", () => {
    const uniforms = buildProjectionPreviewRenderUniformValue({
      targetWidth: 512,
      targetHeight: 512,
      sourceWidth: 1920,
      sourceHeight: 1920,
      sourceProjectionMode: "zenith-180",
      projectionViewMode: "audience-space",
      captureUnshaded: true,
    });

    expect(uniforms.shellShade).toBe(0);
  });
});
