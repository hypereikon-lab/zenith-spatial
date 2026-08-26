import { afterEach, describe, expect, test, vi } from "vitest";
import { createInitialZenithDocument, defaultImageSpatialSpec, selectedComposition } from "../domain/project.js";
import { imageSpatialDrawPlan, normalizeImageRevisionMedia } from "./image-spatial-normalization.js";

function spatialSpec(projectionMode?: Parameters<typeof defaultImageSpatialSpec>[0]["projectionMode"]) {
  const draft = structuredClone(selectedComposition(createInitialZenithDocument()).plateDraft);
  if (projectionMode) {
    draft.projectionMode = projectionMode;
    // These tests exercise raster normalization and do not consume the physical surface.
  }
  return defaultImageSpatialSpec(draft);
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("image spatial normalization", () => {
  test("contains a wide source inside the canonical square", () => {
    const plan = imageSpatialDrawPlan(1920, 1080, spatialSpec());
    expect(plan).toMatchObject({ targetWidth: 1920, targetHeight: 1920, drawWidth: 1920, centerX: 960 });
    expect(plan.drawHeight).toBeCloseTo(1080, 5);
    expect(plan.clipRadius).toBeCloseTo(921.6, 5);
    expect(plan.clip).toMatchObject({ kind: "circle" });
    if (plan.clip?.kind === "circle") expect(plan.clip.radius).toBeCloseTo(921.6, 5);
  });

  test("keeps an angular fisheye circular on a non-square carrier", () => {
    const plan = imageSpatialDrawPlan(2560, 1440, {
      ...spatialSpec(),
      targetWidth: 2560,
      targetHeight: 1440,
    });

    expect(plan.clip?.kind).toBe("circle");
    if (plan.clip?.kind === "circle") expect(plan.clip.radius).toBeCloseTo(691.2, 5);
    expect(plan.clipRadius).toBeCloseTo(691.2, 5);
  });

  test.each(["cylinder-nadir", "cylinder-zenith"] as const)(
    "uses the full normalized UV ellipse for a non-square %s carrier",
    (projectionMode) => {
      const plan = imageSpatialDrawPlan(2560, 1440, {
        ...spatialSpec(projectionMode),
        targetWidth: 2560,
        targetHeight: 1440,
      });

      expect(plan.clip?.kind).toBe("ellipse");
      if (plan.clip?.kind === "ellipse") {
        expect(plan.clip.radiusX).toBeCloseTo(1280, 5);
        expect(plan.clip.radiusY).toBeCloseTo(720, 5);
      }
      expect(plan.clipRadius).toBeNull();
    },
  );

  test("conforms raster aspect by topology without falsifying angular geometry", () => {
    const angular = imageSpatialDrawPlan(1920, 1920, {
      ...spatialSpec("zenith-180"),
      fit: "projection-aware",
      targetWidth: 2560,
      targetHeight: 1440,
    });
    const cylinder = imageSpatialDrawPlan(1920, 1920, {
      ...spatialSpec("cylinder-nadir"),
      fit: "projection-aware",
      targetWidth: 2560,
      targetHeight: 1440,
    });
    const cave = imageSpatialDrawPlan(1920, 1920, {
      ...spatialSpec("cave-270"),
      fit: "projection-aware",
      targetWidth: 2560,
      targetHeight: 1440,
    });
    const cylinderWall = imageSpatialDrawPlan(1920, 1920, {
      ...spatialSpec("cylinder-wall"),
      fit: "projection-aware",
      targetWidth: 2560,
      targetHeight: 1440,
    });
    const doubleGable = imageSpatialDrawPlan(2912, 1248, {
      ...spatialSpec("hall-double-gable"),
      fit: "projection-aware",
      targetWidth: 2912,
      targetHeight: 1248,
    });

    expect(angular).toMatchObject({ drawWidth: 1440, drawHeight: 1440 });
    expect(cylinder).toMatchObject({ drawWidth: 2560, drawHeight: 1440 });
    expect(cave).toMatchObject({ drawWidth: 2560, drawHeight: 1440 });
    expect(cylinderWall).toMatchObject({ drawWidth: 2560, drawHeight: 1440, clip: null });
    expect(doubleGable).toMatchObject({ drawWidth: 2912, drawHeight: 1248, clip: null });
  });

  test("applies the cylinder ellipse when rendering canonical non-square media", async () => {
    const context = {
      fillStyle: "",
      fillRect: vi.fn(),
      clearRect: vi.fn(),
      save: vi.fn(),
      beginPath: vi.fn(),
      arc: vi.fn(),
      ellipse: vi.fn(),
      clip: vi.fn(),
      translate: vi.fn(),
      rotate: vi.fn(),
      drawImage: vi.fn(),
      restore: vi.fn(),
    };
    const canvas = {
      width: 0,
      height: 0,
      getContext: vi.fn(() => context),
      toDataURL: vi.fn(() => "data:image/png;base64,normalized"),
    };
    class FakeImage {
      naturalWidth = 2560;
      naturalHeight = 1440;
      decoding = "auto";
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;

      set src(_value: string) {
        this.onload?.();
      }
    }
    vi.stubGlobal("document", { createElement: vi.fn(() => canvas) });
    vi.stubGlobal("Image", FakeImage);

    await normalizeImageRevisionMedia(
      { url: "data:image/png;base64,source" },
      {
        ...spatialSpec("cylinder-nadir"),
        targetWidth: 2560,
        targetHeight: 1440,
      },
    );

    expect(context.ellipse).toHaveBeenCalledOnce();
    expect(context.ellipse).toHaveBeenCalledWith(1280, 720, 1280, 720, 0, 0, Math.PI * 2);
    expect(context.arc).not.toHaveBeenCalled();
  });

  test("covers and offsets a portrait source without changing canonical dimensions", () => {
    const plan = imageSpatialDrawPlan(1080, 1920, {
      ...spatialSpec(),
      fit: "cover",
      offsetX: 0.25,
      offsetY: -0.5,
      scale: 1.1,
    });
    expect(plan.targetWidth).toBe(1920);
    expect(plan.drawWidth).toBeCloseTo(2112, 5);
    expect(plan.drawHeight).toBeGreaterThan(plan.targetHeight);
    expect(plan.centerX).toBe(1200);
    expect(plan.centerY).toBe(480);
  });

  test("keeps CAVE carriers rectangular and falls back safely outside a browser", async () => {
    const spec = { ...spatialSpec("cave-270"), exterior: "preserve" as const };
    expect(imageSpatialDrawPlan(2048, 2048, spec).clipRadius).toBeNull();
    expect(imageSpatialDrawPlan(2048, 2048, spec).clip).toBeNull();
    const media = { url: "data:image/png;base64,AAAA" };
    await expect(normalizeImageRevisionMedia(media, spec)).resolves.toEqual({ media, spatialSpec: spec });
  });

  test("does not apply a fisheye circle to the rectangular double-gable shell carrier", async () => {
    const context = {
      fillStyle: "",
      fillRect: vi.fn(),
      clearRect: vi.fn(),
      save: vi.fn(),
      beginPath: vi.fn(),
      arc: vi.fn(),
      ellipse: vi.fn(),
      clip: vi.fn(),
      translate: vi.fn(),
      rotate: vi.fn(),
      drawImage: vi.fn(),
      restore: vi.fn(),
    };
    const canvas = {
      width: 0,
      height: 0,
      getContext: vi.fn(() => context),
      toDataURL: vi.fn(() => "data:image/png;base64,normalized"),
    };
    class FakeImage {
      naturalWidth = 2912;
      naturalHeight = 1248;
      decoding = "auto";
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;

      set src(_value: string) {
        this.onload?.();
      }
    }
    vi.stubGlobal("document", { createElement: vi.fn(() => canvas) });
    vi.stubGlobal("Image", FakeImage);

    await normalizeImageRevisionMedia(
      { url: "data:image/png;base64,source" },
      {
        ...spatialSpec("hall-double-gable"),
        targetWidth: 2912,
        targetHeight: 1248,
      },
    );

    expect(context.drawImage).toHaveBeenCalledWith(expect.any(FakeImage), -1456, -624, 2912, 1248);
    expect(context.arc).not.toHaveBeenCalled();
    expect(context.ellipse).not.toHaveBeenCalled();
    expect(context.clip).not.toHaveBeenCalled();
  });
});
