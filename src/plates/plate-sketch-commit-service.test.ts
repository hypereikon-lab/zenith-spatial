import { afterEach, describe, expect, test, vi } from "vitest";
import { normalizePlatePlacement } from "./plate-placement.js";
import {
  clearLastPlateSketchPreviewInput,
  clearActivePlateSketchCommitSource,
  commitActivePlateSketchSource,
  getActivePlateSketchCommitSource,
  getLastPlateSketchPreviewInput,
  hasActivePlateSketchCommitSource,
  setActivePlateSketchCommitSource,
  type ActivePlateSketchCommitSource,
} from "./plate-sketch-commit-service.js";
import type { PlateSketchPreviewInput, PlateSketchPreviewSession } from "./plate-sketch-preview-session.js";
import type { PlateSketchImage } from "./plate-sketch-sources.js";

describe("plate sketch commit service", () => {
  afterEach(() => {
    clearActivePlateSketchCommitSource();
    clearLastPlateSketchPreviewInput();
  });

  test("tracks an explicit active browser commit source", () => {
    const source = commitSource();

    setActivePlateSketchCommitSource(source);

    expect(hasActivePlateSketchCommitSource()).toBe(true);
    expect(getActivePlateSketchCommitSource()).toBe(source);

    clearActivePlateSketchCommitSource(source);

    expect(hasActivePlateSketchCommitSource()).toBe(false);
  });

  test("does not clear a newer active source from an older cleanup", () => {
    const first = commitSource();
    const second = commitSource();

    setActivePlateSketchCommitSource(first);
    setActivePlateSketchCommitSource(second);
    clearActivePlateSketchCommitSource(first);

    expect(getActivePlateSketchCommitSource()).toBe(second);
  });

  test("keeps the last loaded preview input available after active editor cleanup", () => {
    const source = commitSource();

    setActivePlateSketchCommitSource(source);
    clearActivePlateSketchCommitSource(source);

    expect(hasActivePlateSketchCommitSource()).toBe(false);
    expect(getLastPlateSketchPreviewInput()).toBe(source.previewInput);
  });

  test("renders commit payloads and reports status through the active source", async () => {
    const handoffCanvas = fakeCanvas("data:image/png;base64,service");
    const setStatus = vi.fn();
    const source = commitSource({
      session: fakeSession(handoffCanvas),
      setStatus,
    });
    setActivePlateSketchCommitSource(source);

    const result = await commitActivePlateSketchSource();

    expect(result?.handoff).toBe(handoffCanvas);
    expect(result?.commit.artifactPatch.media.url).toBe("data:image/png;base64,service");
    expect(setStatus).toHaveBeenCalledWith("Committing 2048 square inpaint handoff...");
  });

  test("returns null and reports not-ready status when the active source cannot commit", async () => {
    const setStatus = vi.fn();
    setActivePlateSketchCommitSource(commitSource({ canCommit: false, setStatus }));

    await expect(commitActivePlateSketchSource()).resolves.toBeNull();

    expect(setStatus).toHaveBeenCalledWith("Load at least one plate before committing.");
  });
});

function commitSource(patch: Partial<ActivePlateSketchCommitSource> = {}): ActivePlateSketchCommitSource {
  const preview = previewInput();
  return {
    session: fakeSession(fakeCanvas("data:image/png;base64,handoff")),
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
      raster: { aspectPreset: "1:1", width: 2048, height: 2048, domainFit: "full-frame" },
      commitWidth: 2048,
      commitHeight: 2048,
    },
    canCommit: true,
    notReadyStatus: "Load at least one plate before committing.",
    committingStatus: "Committing 2048 square inpaint handoff...",
    ...patch,
  };
}

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

function fakeCanvas(dataUrl: string): HTMLCanvasElement {
  return {
    width: 2048,
    height: 2048,
    toDataURL: vi.fn(() => dataUrl),
  } as unknown as HTMLCanvasElement;
}
