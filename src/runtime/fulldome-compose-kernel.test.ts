import { Effect } from "effect";
import { afterEach, describe, expect, test, vi } from "vitest";

import { readZenithPlateMetadataFromPngBlob } from "../media/png-zenith-provenance.js";
import type { PlateSketchPreviewInput } from "../plates/plate-sketch-preview-session.js";
import { composeFulldomePlateBundlePng } from "./fulldome-compose-kernel.js";

const PNG = new Blob(
  [
    Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
      "base64",
    ),
  ],
  { type: "image/png" },
);

describe("workbench-free fulldome compose kernel", () => {
  afterEach(() => vi.unstubAllGlobals());

  test("renders an arranged trio with direct-only deduplicated provenance and no service layer", async () => {
    const drawImage = vi.fn();
    vi.stubGlobal(
      "createImageBitmap",
      vi.fn(async () => ({ width: 1200, height: 800, close: vi.fn() }) as unknown as ImageBitmap),
    );
    vi.stubGlobal("document", {
      createElement: vi.fn(() => ({
        width: 0,
        height: 0,
        getContext: vi.fn(() => ({ drawImage })),
      })),
    });

    const files = [
      new File(["A"], "field-a.png", { type: "image/png" }),
      new File(["B"], "field-b.png", { type: "image/png" }),
      new File(["C"], "zenith-c.png", { type: "image/png" }),
    ];
    let renderedInput: PlateSketchPreviewInput | null = null;
    const canvas = {
      width: 1920,
      height: 1920,
      toBlob(callback: BlobCallback) {
        callback(PNG);
      },
    } as unknown as HTMLCanvasElement;
    const session = {
      renderHandoffCanvas: async (input: PlateSketchPreviewInput) => {
        renderedInput = input;
        return canvas;
      },
    };

    const result = await Effect.runPromise(
      composeFulldomePlateBundlePng(
        session,
        files.map((file, index) => ({
          file,
          source: `/local/${file.name}`,
          directReferences:
            index === 0
              ? [
                  { filename: "direct.jpg", sha256: "same" },
                  { filename: "duplicate.jpg", sha256: "same" },
                ]
              : [],
          generationReceipt:
            index === 0
              ? { filename: "runway-generation.json", mime: "application/json", sha256: "receipt-sha" }
              : undefined,
        })),
        {
          dominantSourceIndex: 2,
          orientation: "profile",
          projectId: "project-kernel",
          compositionId: "composition-kernel",
          createdAt: "2026-09-06T12:00:00.000Z",
          sourceCrop: "center-square",
        },
      ),
    );
    const metadata = await readZenithPlateMetadataFromPngBlob(result.blob);

    expect(renderedInput).not.toBeNull();
    expect(renderedInput!.plates.map((plate) => plate.name)).toEqual(["field-a.png", "field-b.png", "zenith-c.png"]);
    expect(result.manifest).toMatchObject({
      schema: "zenith.fulldome-compose.v2",
      layout: "upper-dominant-radial-v3",
      dominantSourceIndex: 2,
    });
    expect(result.manifest.sources.map(({ slot }) => slot)).toEqual(["front-left", "front-right", "upper-dominant"]);
    expect(result.manifest.sources[2]!.placement).toMatchObject({ azimuth: 0, scale: 2.08, spin: 0 });
    expect(result.manifest.sources[0]!.directReferences).toEqual([{ filename: "direct.jpg", sha256: "same" }]);
    expect(result.manifest.sources[0]!.source).toBe("/local/field-a.png");
    expect(result.manifest.sources[0]!.normalization).toEqual({
      mode: "center-square",
      sourceRaster: { width: 1200, height: 800 },
      crop: { x: 200, y: 0, width: 800, height: 800 },
      normalizedRaster: { width: 800, height: 800 },
    });
    expect(renderedInput!.plates.every((plate) => plate.aspect === 1)).toBe(true);
    expect(drawImage).toHaveBeenCalledWith(expect.anything(), 200, 0, 800, 800, 0, 0, 800, 800);
    expect(result.manifest.sources[0]!.generationReceipt).toEqual({
      filename: "runway-generation.json",
      mime: "application/json",
      sha256: "receipt-sha",
    });
    expect(result.manifest.output.sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(metadata).toMatchObject({
      kind: "plate-draft",
      projectId: "project-kernel",
      compositionId: "composition-kernel",
    });
  });
});
