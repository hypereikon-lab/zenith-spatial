import { describe, expect, test } from "vitest";
import { defaultPlateEditorCamera } from "./plate-editor-view.js";
import { createPlateEditorProjectionAdapter } from "./plate-editor-projection-adapter.js";
import {
  buildProjectedSpatialAnchorGuides,
  buildSourceMapHorizonOverlayGuide,
  projectedSpatialAnchorHandleHit,
} from "./projected-physical-horizon.js";

describe("projected spatial anchors", () => {
  const viewport = { x: 0, y: 0, width: 800, height: 600 };
  const surface = {
    kind: "box-room" as const,
    width: 6,
    depth: 4,
    height: 3.5,
    eyeHeight: 1.4,
    eyeX: 0,
    eyeZ: 0,
    anchors: { horizonHeight: 2.2 },
  };

  test("projects a fixed venue-space plane independently from raster allocation and observer pose", () => {
    const guides = [0.22, 0.79].map((carrierHorizonRadius) => {
      const adapter = createPlateEditorProjectionAdapter({
        mode: "cave-room",
        sourceProjectionMode: "cave-270",
        camera: defaultPlateEditorCamera("cave-270", surface),
        rect: viewport,
        domeGuideSemanticSplit: 0.36,
        domeGuideHorizonSplit: carrierHorizonRadius,
        projectionSurface: surface,
      });
      return buildProjectedSpatialAnchorGuides({
        surface,
        mode: "cave-270",
        viewport,
        projectPhysicalDirection: adapter.projectPhysicalDirection,
        projectPhysicalSurfacePoint: adapter.projectPhysicalSurfacePoint,
        editPhysicalHorizon: true,
      })[0];
    });

    expect(guides[0].segments.length).toBeGreaterThan(0);
    expect(guides[0].handle).not.toBeNull();
    expect(guides[0].segments).toEqual(guides[1].segments);
    expect(guides[0].handle).toEqual(guides[1].handle);
    expect(projectedSpatialAnchorHandleHit(guides[0].handle, guides)?.id).toBe("horizon");
  });

  test("renders the derived guide without exposing a normal editing hit target", () => {
    const adapter = createPlateEditorProjectionAdapter({
      mode: "cave-room",
      sourceProjectionMode: "cave-270",
      camera: defaultPlateEditorCamera("cave-270", surface),
      rect: viewport,
      projectionSurface: surface,
    });
    const guide = buildProjectedSpatialAnchorGuides({
      surface,
      mode: "cave-270",
      viewport,
      projectPhysicalDirection: adapter.projectPhysicalDirection,
      projectPhysicalSurfacePoint: adapter.projectPhysicalSurfacePoint,
    })[0];

    expect(guide.editable).toBe(false);
    expect(guide.handle).not.toBeNull();
    expect(projectedSpatialAnchorHandleHit(guide.handle, [guide])).toBeNull();
  });

  test("resolves projected volume dragging back to absolute venue height", () => {
    const adapter = createPlateEditorProjectionAdapter({
      mode: "cave-room",
      sourceProjectionMode: "cave-270",
      camera: defaultPlateEditorCamera("cave-270", surface),
      rect: viewport,
      projectionSurface: surface,
    });
    const guide = buildProjectedSpatialAnchorGuides({
      surface,
      mode: "cave-270",
      viewport,
      projectPhysicalDirection: adapter.projectPhysicalDirection,
      projectPhysicalSurfacePoint: adapter.projectPhysicalSurfacePoint,
    })[0];

    const hit = adapter.physicalSurfacePointAt(guide.handle!);
    expect(hit).not.toBeNull();
    expect(surface.eyeHeight + hit![1]).toBeCloseTo(surface.anchors.horizonHeight, 4);
  });

  test("exposes semantic and horizon latitude rings on an angular dome", () => {
    const angular = {
      kind: "angular" as const,
      anchors: { semanticElevationDegrees: 52, horizonElevationDegrees: 8 },
    };
    const adapter = createPlateEditorProjectionAdapter({
      mode: "dome-orbit",
      sourceProjectionMode: "zenith-180",
      camera: defaultPlateEditorCamera("zenith-180", angular),
      rect: viewport,
      projectionSurface: angular,
    });
    const guides = buildProjectedSpatialAnchorGuides({
      surface: angular,
      mode: "zenith-180",
      viewport,
      projectPhysicalDirection: adapter.projectPhysicalDirection,
      projectPhysicalSurfacePoint: adapter.projectPhysicalSurfacePoint,
    });

    expect(guides.map((guide) => [guide.id, guide.value])).toEqual([
      ["semantic", 52],
      ["horizon", 8],
    ]);
    expect(guides.every((guide) => guide.segments.length > 0 && guide.handle)).toBe(true);
    const direction = adapter.physicalDirectionAt(guides[1].handle!);
    expect((Math.asin(direction![1]) * 180) / Math.PI).toBeCloseTo(8, 3);
  });

  test("maps the read-only Plate Map horizon overlay to the same 45-degree dome latitude", () => {
    const angular = {
      kind: "angular" as const,
      anchors: { semanticElevationDegrees: 45, horizonElevationDegrees: 0 },
    };
    const adapter = createPlateEditorProjectionAdapter({
      mode: "source-map",
      sourceProjectionMode: "zenith-180",
      camera: defaultPlateEditorCamera("zenith-180", angular),
      rect: viewport,
      domeGuideSemanticSplit: 1 / 3,
      domeGuideHorizonSplit: 1,
      projectionSurface: angular,
    });
    const guide = buildSourceMapHorizonOverlayGuide({
      surface: angular,
      mode: "zenith-180",
      viewport,
      projectPhysicalDirection: adapter.projectPhysicalDirection,
    });

    expect(guide).toMatchObject({
      id: "semantic",
      label: "Horizon guide",
      editable: false,
      value: 45,
      unit: "degrees",
    });
    expect(guide!.segments.length).toBeGreaterThan(0);
    const point = guide!.segments.flat().at(0)!;
    expect(Math.hypot(point.x - viewport.width / 2, point.y - viewport.height / 2)).toBeCloseTo(100, 3);
    expect(projectedSpatialAnchorHandleHit(guide!.handle, [guide!])).toBeNull();
  });

  test.each([
    {
      mode: "hall-double-gable" as const,
      surface: {
        kind: "double-gable-room" as const,
        length: 22.55,
        width: 23.143,
        eaveHeight: 9.39,
        ridgeHeight: 12.93,
        valleyHeight: 9.39,
        ridgeInset: 23.143 / 4,
        eyeHeight: 1.65,
        eyeX: 0,
        eyeZ: 0,
        anchors: { horizonHeight: 3.1 },
      },
    },
    {
      mode: "cylinder-nadir" as const,
      surface: {
        kind: "cylinder" as const,
        radius: 3.2,
        height: 6.4,
        eyeHeight: 1.7,
        anchors: { horizonHeight: 2.8 },
      },
    },
    {
      mode: "cylinder-wall" as const,
      surface: {
        kind: "cylinder" as const,
        radius: 3.2,
        height: 6.4,
        eyeHeight: 1.7,
        anchors: { horizonHeight: 2.8 },
      },
    },
  ])("projects and resolves the fixed texture plane on $mode", ({ mode, surface }) => {
    const adapter = createPlateEditorProjectionAdapter({
      mode: "cave-room",
      sourceProjectionMode: mode,
      camera: defaultPlateEditorCamera(mode, surface),
      rect: viewport,
      projectionSurface: surface,
    });
    const guide = buildProjectedSpatialAnchorGuides({
      surface,
      mode,
      viewport,
      projectPhysicalDirection: adapter.projectPhysicalDirection,
      projectPhysicalSurfacePoint: adapter.projectPhysicalSurfacePoint,
    })[0];

    expect(guide.segments.length).toBeGreaterThan(0);
    expect(guide.handle).not.toBeNull();
    const hit = adapter.physicalSurfacePointAt(guide.handle!);
    expect(hit).not.toBeNull();
    expect(surface.eyeHeight + hit![1]).toBeCloseTo(surface.anchors.horizonHeight, 3);
  });
});
