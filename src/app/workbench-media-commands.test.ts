import { beforeEach, describe, expect, test, vi } from "vitest";
import { workbench } from "../artifacts/artifact-store.svelte.js";
import { createInitialWorkbenchState } from "../artifacts/workbench-defaults.js";
import { defaultImageSpatialSpec, type CompositionRevision } from "../lib/shared/contracts/composition-sequence.js";
import { downloadBlob } from "../media/canvas-utils.js";
import { downloadSelectedFinishedImage } from "./workbench-media-commands.js";

vi.mock("../media/canvas-utils.js", () => ({
  downloadBlob: vi.fn(),
}));

describe("workbench state-image media commands", () => {
  beforeEach(() => {
    const initial = createInitialWorkbenchState();
    workbench.project = initial.project;
    workbench.errors = [];
    vi.clearAllMocks();
    vi.stubGlobal("fetch", vi.fn());
  });

  test("downloads the immutable returned image separately from its projected fit", async () => {
    attachImageRevision();
    const originalBlob = new Blob(["original"], { type: "image/png" });
    const canonicalBlob = new Blob(["canonical"], { type: "image/png" });
    vi.mocked(fetch)
      .mockResolvedValueOnce(new Response(originalBlob))
      .mockResolvedValueOnce(new Response(canonicalBlob));

    await expect(downloadSelectedFinishedImage("original")).resolves.toBe("zenith-composition-01-original-result.png");
    expect(fetch).toHaveBeenNthCalledWith(1, "data:image/png;base64,ORIGINAL");
    expect(downloadBlob).toHaveBeenNthCalledWith(1, originalBlob, "zenith-composition-01-original-result.png");

    await expect(downloadSelectedFinishedImage("canonical")).resolves.toBe("zenith-composition-01-projected-fit.png");
    expect(fetch).toHaveBeenNthCalledWith(2, "data:image/png;base64,CANONICAL");
    expect(downloadBlob).toHaveBeenNthCalledWith(2, canonicalBlob, "zenith-composition-01-projected-fit.png");
  });

  test("fails clearly when the selected Composition has no returned image", async () => {
    await expect(downloadSelectedFinishedImage("original")).rejects.toThrow(
      "Generate or import a finished image before downloading it.",
    );
    expect(fetch).not.toHaveBeenCalled();
    expect(downloadBlob).not.toHaveBeenCalled();
  });
});

function attachImageRevision(): CompositionRevision {
  const sequence = workbench.project.sequence;
  const composition = sequence.compositions[0];
  const revision: CompositionRevision = {
    id: "revision-clean-image-download-test",
    kind: "clean-image",
    label: "Provider Result",
    createdAt: "2026-07-16T12:00:00.000Z",
    media: {
      kind: "image",
      url: "data:image/png;base64,ORIGINAL",
      name: "provider-result.png",
      mime: "image/png",
      alt: "Original returned image",
    },
    normalizedMedia: {
      kind: "image",
      url: "data:image/png;base64,CANONICAL",
      name: "provider-result-canonical.png",
      mime: "image/png",
      alt: "Projected fit",
    },
    parents: [],
    projectionProfile: "zenith-180",
    spatialSpec: defaultImageSpatialSpec({ projectionMode: "zenith-180" }),
  };
  sequence.revisions[revision.id] = revision;
  sequence.revisionOrder.push(revision.id);
  composition.imageRevisionId = revision.id;
  composition.status = "ready";
  return revision;
}
