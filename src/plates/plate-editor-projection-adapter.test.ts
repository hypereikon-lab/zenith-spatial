import { describe, expect, test } from "vitest";
import { angularDistance, normalize } from "../projection.js";
import { domePointFromSourceDirection } from "../geometry/dome-view.js";
import { sourceDirectionToMapPoint } from "../geometry/source-projection.js";
import { createPlateEditorProjectionAdapter } from "./plate-editor-projection-adapter.js";
import { defaultPlateEditorCamera } from "./plate-editor-view.js";
import { quaternionFromLookAt } from "../geometry/camera-rig.js";
import { directionToPlateLocal, preparePlatePlacement } from "./plate-placement.js";
import type { SourceProjectionMode } from "../geometry/source-projection.js";
import type { Vec3 } from "../projection.js";
import type { PlateEditorViewMode } from "./plate-editor-view.js";

const rect = { x: 0, y: 0, width: 768, height: 768 };

describe("plate editor projection adapter", () => {
  const domePovDirection = normalize([-0.58, 0.48, -0.66]);
  const caveDirection = normalize([0, 0, 1]);

  test.each([
    ["source-map", "zenith-180", normalize([0.18, 0.9, 0.4])],
    ["dome-orbit", "zenith-180", normalize([0.18, 0.9, 0.4])],
    ["dome-pov", "zenith-180", domePovDirection],
    ["cave-room", "cave-270", caveDirection],
  ] satisfies Array<[PlateEditorViewMode, SourceProjectionMode, Vec3]>)(
    "round-trips source directions in %s / %s",
    (mode, sourceProjectionMode, direction) => {
      let camera = defaultPlateEditorCamera(sourceProjectionMode);
      if (mode === "dome-pov") {
        camera = {
          ...camera,
          position: [0, 0, 0],
          orientation: quaternionFromLookAt([0, 0, 0], direction),
        };
      }
      const adapter = createPlateEditorProjectionAdapter({
        mode,
        sourceProjectionMode,
        camera,
        rect,
      });

      const screen = adapter.projectSourceDirection(direction);
      expect(screen).not.toBeNull();
      const roundTrip = adapter.sourceDirectionAt(screen!);

      expect(roundTrip).not.toBeNull();
      expect(angularDistance(roundTrip!, direction)).toBeLessThan(0.002);
    },
  );

  test.each([
    ["source-map", "zenith-180"],
    ["dome-orbit", "zenith-180"],
    ["dome-pov", "zenith-180"],
    ["cave-room", "cave-270"],
  ] satisfies Array<[PlateEditorViewMode, SourceProjectionMode]>)(
    "round-trips projected plate uv handles through source local coordinates in %s",
    (mode, sourceProjectionMode) => {
      let camera = defaultPlateEditorCamera(sourceProjectionMode);
      if (mode === "dome-pov") {
        camera = {
          ...camera,
          position: [0, 0, 0],
          orientation: quaternionFromLookAt([0, 0, 0], domePovDirection),
        };
      }
      const adapter = createPlateEditorProjectionAdapter({
        mode,
        sourceProjectionMode,
        camera,
        rect,
        domeGuideSemanticSplit: 0.5,
      });
      const sourcePoint =
        mode === "dome-pov"
          ? domePointFromSourceDirection(domePovDirection, sourceProjectionMode)
          : mode === "cave-room"
            ? sourceDirectionToMapPoint(caveDirection, sourceProjectionMode, rect.width, rect.height, 1, 0.5)
            : null;
      const placement = preparePlatePlacement(
        {
          azimuth: sourcePoint?.azimuth || 0,
          radius: sourcePoint?.radius || 0.28,
          scale: 0.18,
          spin: 0,
        },
        { aspect: 1 },
        sourceProjectionMode,
        0.5,
      );
      const screen = adapter.projectPlateUv(placement, 0.5, mode === "cave-room" ? 0.5 : 0);
      expect(screen).not.toBeNull();
      const direction = adapter.sourceDirectionAt(screen!);
      const local = directionToPlateLocal(direction!, placement);

      expect(local).not.toBeNull();
      expect(local!.x).toBeCloseTo(0, 4);
      if (mode === "cave-room") {
        expect(Math.hypot(local!.x, local!.y)).toBeLessThan(0.001);
      } else {
        expect(local!.y).toBeLessThan(0);
      }
    },
  );

  test("reports CAVE source-map source points in square carrier space", () => {
    const adapter = createPlateEditorProjectionAdapter({
      mode: "source-map",
      sourceProjectionMode: "cave-270",
      camera: defaultPlateEditorCamera("cave-270"),
      rect,
      domeGuideSemanticSplit: 0.5,
    });

    const sourcePoint = adapter.sourcePointAt({ x: rect.x + rect.width, y: rect.y });

    expect(sourcePoint).not.toBeNull();
    expect(sourcePoint!.radius).toBeCloseTo(1, 8);
    expect(sourcePoint!.azimuth).toBeCloseTo(45, 8);
  });

  test("clamps Zenith source-map source points to the circular rim", () => {
    const adapter = createPlateEditorProjectionAdapter({
      mode: "source-map",
      sourceProjectionMode: "zenith-180",
      camera: defaultPlateEditorCamera("zenith-180"),
      rect,
    });

    const sourcePoint = adapter.sourcePointAt({ x: rect.x, y: rect.y });

    expect(sourcePoint).not.toBeNull();
    expect(sourcePoint!.radius).toBeCloseTo(1, 8);
    expect(sourcePoint!.azimuth).toBeCloseTo(315, 8);
  });

  test("maps non-square angular source points through the short-edge pixel circle", () => {
    const wideRect = { x: 20, y: 30, width: 700, height: 300 };
    const adapter = createPlateEditorProjectionAdapter({
      mode: "source-map",
      sourceProjectionMode: "zenith-180",
      camera: defaultPlateEditorCamera("zenith-180"),
      rect: wideRect,
    });

    const rightRim = adapter.sourcePointAt({
      x: wideRect.x + wideRect.width * 0.5 + wideRect.height * 0.5,
      y: wideRect.y + wideRect.height * 0.5,
    });
    expect(rightRim).not.toBeNull();
    expect(rightRim!.radius).toBeCloseTo(1, 8);
    expect(rightRim!.azimuth).toBeCloseTo(90, 8);

    const outside = adapter.sourcePointAt({ x: wideRect.x + wideRect.width, y: wideRect.y + wideRect.height * 0.5 });
    expect(outside).toMatchObject({ radius: 1, azimuth: expect.closeTo(90, 8) });
  });

  test("rejects Volume Room adapters for non-surface projection profiles", () => {
    expect(() =>
      createPlateEditorProjectionAdapter({
        mode: "cave-room",
        sourceProjectionMode: "zenith-180",
        camera: defaultPlateEditorCamera("zenith-180"),
        rect,
      }),
    ).toThrow("Volume Room is available for CAVE and cylinder surface carriers.");

    expect(() =>
      createPlateEditorProjectionAdapter({
        mode: "cave-room",
        sourceProjectionMode: "cylinder-nadir",
        camera: defaultPlateEditorCamera("cylinder-nadir"),
        rect,
      }),
    ).not.toThrow();
  });
});
