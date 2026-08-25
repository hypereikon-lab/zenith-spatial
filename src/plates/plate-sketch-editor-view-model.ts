import { visiblePlateUvBounds } from "../geometry/flat-domemaster.js";
import { projectPlateScreenControls } from "../geometry/plate-screen-controls.js";
import { preparePlatePlacement } from "./plate-placement.js";
import type { Point2D } from "../projection.js";
import type { SourceProjectionMode } from "../geometry/source-projection.js";
import type { ProjectionSurface } from "../lib/shared/contracts/projection-authoring.js";
import type { PlateEditorHitHandle } from "./plate-drag-math.js";
import type { PlateEditorProjectionAdapter } from "./plate-editor-projection-adapter.js";
import type { NormalizedPlatePlacement, PlateLike } from "./plate-placement.js";

export type PlateSketchEditorHandle = PlateEditorHitHandle;

export type PlateSketchEditorGeometry = {
  index: number;
  center: Point2D;
  outline: Point2D[];
  outlineSegments: Point2D[][];
  outlineClosed: boolean;
  rotateAnchor: Point2D | null;
  rotateHandle: Point2D | null;
  handles: PlateSketchEditorHandle[];
};

export type PlateSketchEditorViewModel = {
  geometries: PlateSketchEditorGeometry[];
  activeGeometry: PlateSketchEditorGeometry | null;
};

export type PlateSketchEditorViewModelInput = {
  placements: NormalizedPlatePlacement[];
  plates: PlateLike[];
  activeIndex: number;
  sourceProjectionMode: SourceProjectionMode;
  innerGuideSplit?: number | string | null;
  carrierHorizonRadius?: number | string | null;
  projectionSurface?: ProjectionSurface | null;
  plateFit: string;
  adapter: PlateEditorProjectionAdapter;
};

export function buildPlateSketchEditorViewModel(input: PlateSketchEditorViewModelInput): PlateSketchEditorViewModel {
  const count = Math.min(input.plates.length, input.placements.length);
  const geometries: PlateSketchEditorGeometry[] = [];
  for (let index = 0; index < count; index += 1) {
    const geometry = buildPlateSketchEditorGeometry({
      ...input,
      index,
      placement: input.placements[index],
      plate: input.plates[index],
    });
    if (geometry) geometries.push(geometry);
  }
  return {
    geometries,
    activeGeometry: geometries.find((geometry) => geometry.index === input.activeIndex) || null,
  };
}

export function buildPlateSketchEditorGeometry({
  index,
  placement,
  plate,
  sourceProjectionMode,
  innerGuideSplit,
  carrierHorizonRadius,
  projectionSurface,
  plateFit,
  adapter,
}: PlateSketchEditorViewModelInput & {
  index: number;
  placement: NormalizedPlatePlacement | null | undefined;
  plate: PlateLike | null | undefined;
}): PlateSketchEditorGeometry | null {
  if (!placement || !plate) return null;
  const prepared = preparePlatePlacement(
    placement,
    plate,
    sourceProjectionMode,
    innerGuideSplit,
    carrierHorizonRadius,
    projectionSurface,
  );
  const bounds = visiblePlateUvBounds(prepared, plateFit);
  const controls = projectPlateScreenControls(prepared, bounds, {
    projectSourceDirection: adapter.projectSourceDirection,
    projectPlateUv: adapter.projectPlateUv,
  });
  if (!controls) return null;
  return {
    index,
    center: controls.center,
    outline: controls.outline,
    outlineSegments: controls.outlineSegments,
    outlineClosed: controls.outlineClosed,
    rotateAnchor: controls.rotateAnchor,
    rotateHandle: controls.rotateHandle,
    handles: [
      ...controls.scaleHandles.map((handle) => ({ ...handle, action: "scale" as const })),
      controls.rotateHandle ? { ...controls.rotateHandle, action: "rotate" as const } : null,
    ].filter((handle): handle is PlateSketchEditorHandle => Boolean(handle)),
  };
}
