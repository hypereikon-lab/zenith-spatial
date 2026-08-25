import { describe, expect, test, vi } from "vitest";
import { createPlateSketchCommitHandoff, createPlateSketchDownloadHandoff } from "./plate-sketch-handoff.js";
import { normalizePlatePlacement } from "./plate-placement.js";
import type { PlateSketchPreviewInput, PlateSketchPreviewSession } from "./plate-sketch-preview-session.js";
import type { PlateSketchImage } from "./plate-sketch-sources.js";

describe("plate sketch handoff actions", () => {
  test("renders a full-scale handoff and builds the commit payload outside the Svelte component", async () => {
    const handoffCanvas = fakeCanvas("data:image/png;base64,handoff", 2560, 1440);
    const session = fakeSession(handoffCanvas);
    const preview = previewInput();

    const result = await createPlateSketchCommitHandoff({
      session,
      previewInput: preview,
      commitInput: {
        plateCount: 1,
        placements: preview.placements,
        plateFit: "contain",
        plateFeather: 0.02,
        domeGuideSemanticSplit: 0.5,
        domeGuideHorizonSplit: 0.68,
        plateEditMode: "warp",
        projectionProfile: "zenith-180",
        projectionSurface: { kind: "angular" },
        raster: { aspectPreset: "16:9", width: 2560, height: 1440, domainFit: "full-frame" },
        commitWidth: 2560,
        commitHeight: 1440,
      },
    });

    expect(session.renderHandoffCanvas).toHaveBeenCalledWith(preview, { width: 2560, height: 1440 });
    expect(result.handoff).toBe(handoffCanvas);
    expect(handoffCanvas.toDataURL).toHaveBeenCalledWith("image/png");
    expect(result.commit.artifactPatch).toMatchObject({
      status: "ready",
      stale: false,
      operatorId: "commit-plates",
      media: {
        kind: "image",
        url: "data:image/png;base64,handoff",
        mime: "image/png",
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
        raster: { aspectPreset: "16:9", width: 2560, height: 1440, domainFit: "full-frame" },
        commitWidth: 2560,
        commitHeight: 1440,
      },
    });
  });

  test("renders a downloadable PNG handoff with deterministic filename and status", async () => {
    const handoffCanvas = fakeCanvas("data:image/png;base64,download", 2560, 1440);
    const session = fakeSession(handoffCanvas);
    const preview = previewInput();

    const result = await createPlateSketchDownloadHandoff({
      session,
      previewInput: preview,
      width: 2560,
      height: 1440,
      now: () => 12345,
    });

    expect(session.renderHandoffCanvas).toHaveBeenCalledWith(preview, { width: 2560, height: 1440 });
    expect(result.handoff).toBe(handoffCanvas);
    expect(handoffCanvas.toBlob).toHaveBeenCalledWith(expect.any(Function), "image/png", undefined);
    expect(result.blob.type).toBe("image/png");
    expect(result.filename).toBe("zenith-plate-sketch-2560x1440-12345.png");
    expect(result.status).toBe("2560 × 1440 Plate Sketch PNG downloaded.");
  });

  test("rejects a renderer canvas that does not match the requested carrier pixels", async () => {
    const preview = previewInput();
    await expect(
      createPlateSketchCommitHandoff({
        session: fakeSession(fakeCanvas("data:image/png;base64,wrong", 1280, 720)),
        previewInput: preview,
        commitInput: {
          plateCount: 1,
          placements: preview.placements,
          plateFit: "contain",
          plateFeather: 0.02,
          domeGuideSemanticSplit: 0.5,
          domeGuideHorizonSplit: 0.68,
          plateEditMode: "warp",
          projectionProfile: "cylinder-wall",
          projectionSurface: { kind: "cylinder", radius: 3, height: 4, eyeHeight: 1.6 },
          raster: { aspectPreset: "21:9", width: 2912, height: 1248, domainFit: "full-frame" },
          commitWidth: 2912,
          commitHeight: 1248,
        },
      }),
    ).rejects.toThrow("renderer returned 1280×720; expected the exact 2912×1248 carrier raster");
  });
});

function previewInput(): PlateSketchPreviewInput {
  return {
    plates: [fakePlate()],
    placements: [normalizePlatePlacement({ scale: 0.7 }, { aspect: 1 })],
    canvasWidth: 768,
    plateFit: "contain",
    plateFeather: 0.02,
    domeGuideSemanticSplit: 0.5,
    domeGuideHorizonSplit: 0.68,
    sourceProjectionMode: "zenith-180",
    viewerMode: "dome-check",
    projectionViewMode: "dome-orbit",
    projectionCamera: {},
    showCaveMask: false,
    invertCaveMask: false,
  };
}

function fakePlate(): PlateSketchImage {
  return {
    name: "plate.png",
    width: 100,
    height: 100,
    aspect: 1,
    canvas: {} as HTMLCanvasElement,
  };
}

function fakeSession(handoffCanvas: HTMLCanvasElement): Pick<PlateSketchPreviewSession, "renderHandoffCanvas"> {
  return {
    renderHandoffCanvas: vi.fn(async () => handoffCanvas),
  };
}

function fakeCanvas(dataUrl: string, width: number, height: number): HTMLCanvasElement {
  return {
    width,
    height,
    toDataURL: vi.fn(() => dataUrl),
    toBlob: vi.fn((callback: BlobCallback, type?: string) => {
      callback(new Blob(["png"], { type: type || "image/png" }));
    }),
  } as unknown as HTMLCanvasElement;
}
