import { describe, expect, test } from "vitest";
import { createPlateEditorProjectionAdapter } from "./plate-editor-projection-adapter.js";
import { defaultPlateEditorCamera } from "./plate-editor-view.js";
import { normalizePlatePlacement } from "./plate-placement.js";
import {
  beginPlateSketchEditorDrag,
  hitTestPlateSketchEditor,
  updatePlateSketchEditorDrag,
} from "./plate-sketch-editor-controller.js";
import { buildPlateSketchEditorViewModel } from "./plate-sketch-editor-view-model.js";
import type { Point2D } from "../projection.js";
import type { NormalizedPlatePlacement } from "./plate-placement.js";

const rect = { x: 0, y: 0, width: 768, height: 768 };
const plate = { aspect: 1 };
const editorOptions = {
  sourceProjectionMode: "zenith-180" as const,
  plateFit: "contain",
  handleRadius: 28,
  hitLocalPad: 0.012,
};

describe("plate sketch editor controller", () => {
  test("prioritizes active handles before topmost plate body hits", () => {
    const state = editorState(
      [
        normalizePlatePlacement({ azimuth: 0, radius: 0.35, scale: 0.45 }, plate),
        normalizePlatePlacement({ azimuth: 0, radius: 0.35, scale: 0.3 }, plate),
      ],
      0,
    );
    const handle = state.viewModel.activeGeometry?.handles.find((candidate) => candidate.action === "scale");
    if (!handle) throw new Error("Expected scale handle");

    expect(
      hitTestPlateSketchEditor({
        point: handle,
        direction: state.adapter.sourceDirectionAt(handle),
        activeIndex: 0,
        geometries: state.viewModel.geometries,
        placements: state.placements,
        plates: [plate, plate],
        ...editorOptions,
      }),
    ).toEqual({ index: 0, handle });

    const center = state.viewModel.geometries[0].center;
    expect(
      hitTestPlateSketchEditor({
        point: center,
        direction: state.adapter.sourceDirectionAt(center),
        activeIndex: 0,
        geometries: state.viewModel.geometries,
        placements: state.placements,
        plates: [plate, plate],
        ...editorOptions,
      }),
    ).toEqual({ index: 1, handle: { action: "move" } });

    expect(
      hitTestPlateSketchEditor({
        point: center,
        direction: state.adapter.sourceDirectionAt(center),
        activeIndex: 0,
        geometries: state.viewModel.geometries,
        placements: state.placements,
        plates: [plate, plate],
        ...editorOptions,
        preferActiveBody: true,
      }),
    ).toEqual({ index: 0, handle: { action: "move" } });
  });

  test("starts scale, warp, rotate, and move drags as JSON-safe pure state", () => {
    const state = editorState([normalizePlatePlacement({ azimuth: 0, radius: 0.35, scale: 0.45 }, plate)], 0);
    const geometry = state.viewModel.activeGeometry;
    if (!geometry) throw new Error("Expected geometry");
    const scaleHandle = geometry.handles.find((handle) => handle.action === "scale");
    const rotateHandle = geometry.handles.find((handle) => handle.action === "rotate");
    if (!scaleHandle || !rotateHandle) throw new Error("Expected scale and rotate handles");

    const scaleDrag = beginDrag(state, scaleHandle, { index: 0, handle: scaleHandle });
    const warpDrag = beginDrag(state, scaleHandle, { index: 0, handle: scaleHandle }, { shiftKey: true });
    const rotateDrag = beginDrag(state, rotateHandle, { index: 0, handle: rotateHandle });
    const moveDrag = beginDrag(state, geometry.center, { index: 0, handle: { action: "move" } });

    expect(scaleDrag?.action).toBe("scale");
    expect(warpDrag?.action).toBe("warp");
    expect(rotateDrag?.action).toBe("rotate");
    expect(moveDrag?.action).toBe("move");
    expect(JSON.parse(JSON.stringify([scaleDrag, warpDrag, rotateDrag, moveDrag]))).toEqual([
      scaleDrag,
      warpDrag,
      rotateDrag,
      moveDrag,
    ]);
  });

  test("updates source-map move drags through projection-aware source directions", () => {
    const state = editorState([normalizePlatePlacement({ azimuth: 0, radius: 0.35, scale: 0.45 }, plate)], 0);
    const geometry = state.viewModel.activeGeometry;
    if (!geometry) throw new Error("Expected geometry");
    const drag = beginDrag(state, geometry.center, { index: 0, handle: { action: "move" } });
    if (!drag) throw new Error("Expected drag");

    const update = updatePlateSketchEditorDrag({
      drag,
      pointerId: 1,
      point: { x: geometry.center.x + 80, y: geometry.center.y },
      placement: state.placements[0],
      plate,
      adapter: state.adapter,
      sourceProjectionMode: "zenith-180",
      minScale: 0.08,
      maxScale: 2.2,
    });

    expect(update.kind).toBe("updated");
    if (update.kind !== "updated") throw new Error("Expected update");
    expect(update.drag.action).toBe("move");
    expect(update.changed).toBe(true);
    expect(update.placement.azimuth).not.toBeCloseTo(state.placements[0].azimuth, 5);
  });

  test("keeps source-map move drags continuous across the top-left rim", () => {
    const state = editorState(
      [normalizePlatePlacement({ azimuth: 47, radius: 0.93, scale: 0.68, spin: 16 }, plate)],
      0,
    );
    const geometry = state.viewModel.activeGeometry;
    if (!geometry) throw new Error("Expected geometry");
    const drag = beginDrag(state, geometry.center, { index: 0, handle: { action: "move" } });
    if (!drag) throw new Error("Expected drag");

    const update = updatePlateSketchEditorDrag({
      drag,
      pointerId: 1,
      point: { x: rect.width * 0.14, y: rect.height * 0.14 },
      placement: state.placements[0],
      plate,
      adapter: state.adapter,
      sourceProjectionMode: "zenith-180",
      minScale: 0.08,
      maxScale: 2.2,
    });

    expect(update.kind).toBe("updated");
    if (update.kind !== "updated") throw new Error("Expected update");
    expect(update.changed).toBe(true);
    expect(update.placement.radius).toBeCloseTo(1, 8);
    expect(update.placement.azimuth).toBeCloseTo(-45, 8);
  });

  test("updates scale and warp drags from projected source-local coordinates", () => {
    const state = editorState([normalizePlatePlacement({ azimuth: 0, radius: 0.35, scale: 0.45 }, plate)], 0);
    const geometry = state.viewModel.activeGeometry;
    const scaleHandle = geometry?.handles.find((handle) => handle.action === "scale");
    if (!geometry || !scaleHandle) throw new Error("Expected geometry and scale handle");
    const outward = pointAwayFromCenter(geometry.center, scaleHandle, 1.25);

    const scaleDrag = beginDrag(state, scaleHandle, { index: 0, handle: scaleHandle });
    if (!scaleDrag) throw new Error("Expected scale drag");
    const scaleUpdate = updatePlateSketchEditorDrag({
      drag: scaleDrag,
      pointerId: 1,
      point: outward,
      placement: state.placements[0],
      plate,
      adapter: state.adapter,
      sourceProjectionMode: "zenith-180",
      minScale: 0.08,
      maxScale: 2.2,
    });
    expect(scaleUpdate.kind).toBe("updated");
    if (scaleUpdate.kind !== "updated") throw new Error("Expected scale update");
    expect(scaleUpdate.placement.scale).toBeGreaterThan(state.placements[0].scale);

    const warpDrag = beginDrag(state, scaleHandle, { index: 0, handle: scaleHandle }, { shiftKey: true });
    if (!warpDrag || warpDrag.action !== "warp") throw new Error("Expected warp drag");
    const warpUpdate = updatePlateSketchEditorDrag({
      drag: warpDrag,
      pointerId: 1,
      point: outward,
      placement: state.placements[0],
      plate,
      adapter: state.adapter,
      sourceProjectionMode: "zenith-180",
      minScale: 0.08,
      maxScale: 2.2,
    });
    expect(warpUpdate.kind).toBe("updated");
    if (warpUpdate.kind !== "updated") throw new Error("Expected warp update");
    expect(warpUpdate.placement.cornerOffsets[warpDrag.corner]).not.toEqual(
      state.placements[0].cornerOffsets[warpDrag.corner],
    );
  });
});

function editorState(placements: NormalizedPlatePlacement[], activeIndex: number) {
  const adapter = createPlateEditorProjectionAdapter({
    mode: "source-map",
    sourceProjectionMode: "zenith-180",
    camera: defaultPlateEditorCamera("zenith-180"),
    rect,
  });
  const plates = placements.map(() => plate);
  return {
    adapter,
    plates,
    placements,
    viewModel: buildPlateSketchEditorViewModel({
      placements,
      plates,
      activeIndex,
      sourceProjectionMode: "zenith-180",
      plateFit: "contain",
      adapter,
    }),
  };
}

function beginDrag(
  state: ReturnType<typeof editorState>,
  point: Point2D,
  hit: Parameters<typeof beginPlateSketchEditorDrag>[0]["hit"],
  modifiers: { shiftKey?: boolean; altKey?: boolean } = {},
) {
  return beginPlateSketchEditorDrag({
    pointerId: 1,
    point,
    hit,
    geometry: state.viewModel.geometries.find((geometry) => geometry.index === hit.index) || null,
    placement: state.placements[hit.index],
    plate,
    adapter: state.adapter,
    sourceProjectionMode: "zenith-180",
    plateEditMode: "scale",
    ...modifiers,
  });
}

function pointAwayFromCenter(center: Point2D, point: Point2D, factor: number): Point2D {
  return {
    x: center.x + (point.x - center.x) * factor,
    y: center.y + (point.y - center.y) * factor,
  };
}
