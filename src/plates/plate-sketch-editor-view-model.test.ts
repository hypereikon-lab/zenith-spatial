import { describe, expect, test } from "vitest";
import { createPlateEditorProjectionAdapter } from "./plate-editor-projection-adapter.js";
import { defaultPlateEditorCamera } from "./plate-editor-view.js";
import { normalizePlatePlacement } from "./plate-placement.js";
import { buildPlateSketchEditorViewModel } from "./plate-sketch-editor-view-model.js";

const rect = { x: 0, y: 0, width: 768, height: 768 };
const plate = { aspect: 1 };

describe("plate sketch editor view model", () => {
  test("builds JSON-safe projected overlay geometry for every visible plate", () => {
    const adapter = createPlateEditorProjectionAdapter({
      mode: "source-map",
      sourceProjectionMode: "zenith-180",
      camera: defaultPlateEditorCamera("zenith-180"),
      rect,
    });
    const viewModel = buildPlateSketchEditorViewModel({
      placements: [
        normalizePlatePlacement({ azimuth: 0, radius: 0.32, scale: 0.42 }, plate),
        normalizePlatePlacement({ azimuth: 45, radius: 0.55, scale: 0.3 }, plate),
      ],
      plates: [plate, plate],
      activeIndex: 1,
      sourceProjectionMode: "zenith-180",
      plateFit: "contain",
      adapter,
    });

    expect(viewModel.geometries).toHaveLength(2);
    expect(viewModel.activeGeometry?.index).toBe(1);
    expect(viewModel.geometries[0].outline.length).toBeGreaterThan(0);
    expect(viewModel.geometries[0].outlineSegments.length).toBeGreaterThan(0);
    expect(viewModel.geometries[0].outlineClosed).toBe(true);
    expect(viewModel.geometries[0].handles.some((handle) => handle.action === "scale")).toBe(true);
    expect(JSON.parse(JSON.stringify(viewModel))).toEqual(viewModel);
  });

  test("omits geometry when a projected view cannot see the plate center", () => {
    const adapter = createPlateEditorProjectionAdapter({
      mode: "source-map",
      sourceProjectionMode: "zenith-180",
      camera: defaultPlateEditorCamera("zenith-180"),
      rect,
    });
    const viewModel = buildPlateSketchEditorViewModel({
      placements: [normalizePlatePlacement({ azimuth: 0, radius: 0.32, scale: 0.42 }, plate)],
      plates: [],
      activeIndex: 0,
      sourceProjectionMode: "zenith-180",
      plateFit: "contain",
      adapter,
    });

    expect(viewModel.geometries).toEqual([]);
    expect(viewModel.activeGeometry).toBeNull();
  });
});
