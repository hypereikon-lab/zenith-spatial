import { describe, expect, test } from "vitest";
import { eulerDegreesFromQuaternion, quaternionFromEulerDegrees } from "../geometry/camera-rig.js";
import {
  PLATE_EDITOR_VIEW_MODES,
  defaultPlateEditorCamera,
  normalizePlateEditorCamera,
  plateEditorCaveProjection,
  plateEditorDomeProjection,
  plateEditorOrthographicViewHeight,
  plateEditorProjectionMatrix,
  plateEditorViewDisabledReason,
  plateEditorViewLabel,
  plateEditorViewMatrix,
  plateEditorViewUsesSurfaceGeometry,
} from "./plate-editor-view.js";

describe("plate editor projection views", () => {
  test("defines production editing view labels", () => {
    expect(PLATE_EDITOR_VIEW_MODES).toEqual(["source-map", "dome-orbit", "dome-pov", "cave-room", "audience-space"]);
    expect(plateEditorViewLabel("source-map")).toBe("Plate Map");
    expect(plateEditorViewLabel("dome-orbit")).toBe("Dome Stage");
    expect(plateEditorViewLabel("dome-pov")).toBe("Audience POV");
    expect(plateEditorViewLabel("cave-room")).toBe("Volume Room");
    expect(plateEditorViewLabel("audience-space")).toBe("Audience in Space");
  });

  test("creates finite matrices for dome and CAVE views", () => {
    const camera = defaultPlateEditorCamera("zenith-230");
    for (const mode of ["dome-orbit", "dome-pov"] as const) {
      const matrix = plateEditorViewMatrix(mode, camera, "zenith-230");
      expect(Array.from(matrix).every(Number.isFinite)).toBe(true);
    }
    const caveMatrix = plateEditorViewMatrix("cave-room", defaultPlateEditorCamera("cave-270"), "cave-270");
    expect(Array.from(caveMatrix).every(Number.isFinite)).toBe(true);
  });

  test("limits Volume Room editing to physical surface carriers", () => {
    expect(plateEditorViewDisabledReason("cave-room", "cave-270")).toBeNull();
    expect(plateEditorViewDisabledReason("cave-room", "cylinder-nadir")).toBeNull();
    expect(plateEditorViewDisabledReason("cave-room", "cylinder-zenith")).toBeNull();
    expect(plateEditorViewDisabledReason("cave-room", "nadir-180")).toBe(
      "Volume Room is available for CAVE and cylinder surface carriers.",
    );
    expect(plateEditorViewDisabledReason("cave-room", "zenith-230")).toBe(
      "Volume Room is available for CAVE and cylinder surface carriers.",
    );
    expect(plateEditorViewDisabledReason("dome-orbit", "zenith-230")).toBeNull();
    expect(plateEditorViewDisabledReason("dome-orbit", "cylinder-nadir")).toBe(
      "Cylinder carriers are inspected in Plate Map or Volume Room.",
    );
    expect(plateEditorViewDisabledReason("audience-space", "zenith-230")).toBeNull();
    expect(plateEditorViewDisabledReason("audience-space", "cylinder-nadir")).toBeNull();
    expect(plateEditorViewUsesSurfaceGeometry("audience-space", "cylinder-nadir")).toBe(true);
    expect(plateEditorViewUsesSurfaceGeometry("audience-space", "zenith-230")).toBe(false);
  });

  test("normalizes camera values into a useful 6DoF editor pose", () => {
    const camera = normalizePlateEditorCamera({
      position: [999, -999, 4],
      orientation: quaternionFromEulerDegrees(30, 12, 6),
      fovDegrees: 999,
    });
    expect(camera.position[0]).toBe(120);
    expect(camera.position[1]).toBe(-120);
    expect(camera.orientation).toHaveLength(4);
    expect(eulerDegreesFromQuaternion(camera.orientation).yawDegrees).toBeCloseTo(30, 5);
    expect(camera.fovDegrees).toBe(170);
  });

  test("builds projection descriptors from workbench camera state", () => {
    const rect = { x: 0, y: 0, width: 768, height: 768 };
    const camera = defaultPlateEditorCamera("cave-270");
    const dome = plateEditorDomeProjection("dome-orbit", camera, "cave-270", rect);
    const cave = plateEditorCaveProjection(camera, "cave-270", rect);

    expect(dome.sourceProjectionMode).toBe("cave-270");
    expect(cave.sourceProjectionMode).toBe("cave-270");
    expect(dome.fovDegrees).toBe(camera.fovDegrees);
    expect(dome.projectionMode).toBe("orthographic");
    expect(dome.orthographicViewHeight).toBeCloseTo(plateEditorOrthographicViewHeight(camera, "cave-270"), 6);
    expect(Array.from(plateEditorProjectionMatrix(camera, "cave-270")).every(Number.isFinite)).toBe(true);
    expect(cave.rect).toEqual(rect);
    expect(cave.projectionMode).toBe("orthographic");
  });

  test("uses perspective projection for meter-aware audience inspection", () => {
    const rect = { x: 0, y: 0, width: 960, height: 540 };
    const camera = {
      ...defaultPlateEditorCamera("cave-270"),
      position: [0, -0.35, 0] as [number, number, number],
      pivot: null,
      mode: "inside" as const,
    };
    const projection = plateEditorCaveProjection(camera, "cave-270", rect, false, undefined, "audience-space");
    const matrix = plateEditorProjectionMatrix(camera, "cave-270", rect.width / rect.height, "audience-space");

    expect(projection.projectionMode).toBe("perspective");
    expect(projection.orthographicViewHeight).toBeUndefined();
    expect(matrix[11]).toBe(1);
    expect(matrix[15]).toBe(0);
  });

  test("frames measured rooms instead of clipping them at the default camera distance", () => {
    const measuredBox = {
      kind: "box-room" as const,
      width: 40,
      depth: 6,
      height: 5,
      eyeHeight: 2,
      eyeX: -10,
      eyeZ: 0,
    };
    const camera = defaultPlateEditorCamera("cave-270", measuredBox);
    const distance = Math.hypot(
      camera.position[0] - camera.pivot![0],
      camera.position[1] - camera.pivot![1],
      camera.position[2] - camera.pivot![2],
    );

    expect(distance).toBeGreaterThan(38);
    expect(camera.farMeters).toBeGreaterThan(150);
    expect(
      plateEditorCaveProjection(camera, "cave-270", { x: 0, y: 0, width: 900, height: 600 }, true, measuredBox)
        .projectionSurface,
    ).toEqual(measuredBox);

    const cylinderCamera = defaultPlateEditorCamera("cylinder-nadir", {
      kind: "cylinder",
      radius: 16,
      height: 8,
      eyeHeight: 2,
    });
    expect(Math.hypot(...cylinderCamera.position)).toBeGreaterThan(20);
  });

  test("preserves horizontal physical-room coverage for portrait projection targets", () => {
    const camera = defaultPlateEditorCamera("cave-270", {
      kind: "box-room",
      width: 12,
      depth: 5,
      height: 4,
      eyeHeight: 1.6,
      eyeX: 2,
      eyeZ: -0.5,
    });
    const portraitAspect = 9 / 16;
    const squareHeight = plateEditorOrthographicViewHeight(camera, "cave-270", 1);
    const portraitHeight = plateEditorOrthographicViewHeight(camera, "cave-270", portraitAspect);
    const squareMatrix = plateEditorProjectionMatrix(camera, "cave-270", 1);
    const portraitMatrix = plateEditorProjectionMatrix(camera, "cave-270", portraitAspect);

    expect(portraitHeight).toBeCloseTo(squareHeight / portraitAspect, 8);
    expect(portraitMatrix[0]).toBeCloseTo(squareMatrix[0], 8);
    expect(portraitMatrix[5]).toBeCloseTo(squareMatrix[5] * portraitAspect, 8);

    const portraitRect = { x: 0, y: 0, width: 900, height: 1600 };
    expect(plateEditorCaveProjection(camera, "cave-270", portraitRect).orthographicViewHeight).toBeCloseTo(
      portraitHeight,
      8,
    );
    expect(
      plateEditorDomeProjection("dome-orbit", camera, "zenith-180", portraitRect).orthographicViewHeight,
    ).toBeCloseTo(plateEditorOrthographicViewHeight(camera, "zenith-180", portraitAspect), 8);
  });
});
