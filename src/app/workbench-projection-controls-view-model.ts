import { workbench } from "../artifacts/artifact-store.svelte.js";
import {
  SOURCE_PROJECTION_MODES,
  sourceProjectionLabel,
  sourceProjectionSummary,
} from "../geometry/source-projection.js";
import type { SourceProjectionMode } from "../geometry/source-projection.js";
import { sourceGuideBreakpoints, sourceGuideZones } from "../geometry/source-guide-semantics.js";
import type { SourceGuideBreakpoint, SourceGuideZone } from "../geometry/source-guide-semantics.js";
import { SOURCE_REVIEW_VIEW_MODES, sourceReviewViewModeUi } from "../scene/projection-view-contract.js";
import type { SourceReviewViewMode } from "../scene/projection-view-contract.js";
import { projectionSurfaceSummary } from "../lib/shared/contracts/projection-authoring.js";

type ProjectionSummaryView = ReturnType<typeof sourceProjectionSummary>;
type ProjectionSelectOption = {
  value: string;
  label: string;
  disabled?: boolean;
};
type ProjectionSegmentOption = {
  value: string;
  label: string;
  description?: string;
  disabled?: boolean;
};

export type WorkbenchProjectionControlsView = {
  projectionMode: SourceProjectionMode;
  viewerMode: SourceReviewViewMode;
  projectionSummary: ProjectionSummaryView;
  guideBreakpoints: SourceGuideBreakpoint[];
  guideZones: SourceGuideZone[];
  guideZoneSummary: string;
  projectionOptions: ProjectionSelectOption[];
  viewerOptions: ProjectionSegmentOption[];
  carrierSummary: string;
  rasterSummary: string;
};

const projectionOptions: ProjectionSelectOption[] = SOURCE_PROJECTION_MODES.map((mode) => ({
  value: mode,
  label: sourceProjectionLabel(mode),
}));

const viewerOptions: ProjectionSegmentOption[] = SOURCE_REVIEW_VIEW_MODES.map((mode) => ({
  value: mode,
  label: sourceReviewViewModeUi(mode).label,
  description: sourceReviewViewModeUi(mode).description,
}));

export function workbenchProjectionControlsView(): WorkbenchProjectionControlsView {
  const projectionMode = workbench.project.scene.projectionMode;
  const viewerMode = workbench.project.workspace.viewerMode;
  const guideSplit = workbench.project.scene.guideSplit;
  const horizonSplit = workbench.project.scene.horizonSplit;
  const guideZones = sourceGuideZones(projectionMode, guideSplit, horizonSplit);

  return {
    projectionMode,
    viewerMode,
    projectionSummary: sourceProjectionSummary(projectionMode, guideSplit),
    guideBreakpoints: sourceGuideBreakpoints(projectionMode, guideSplit, horizonSplit),
    guideZones,
    guideZoneSummary: guideZones.map((zone) => zone.label).join(" -> "),
    projectionOptions,
    viewerOptions,
    carrierSummary: projectionSurfaceSummary(workbench.project.scene.surface),
    rasterSummary: `${workbench.project.scene.raster.width} × ${workbench.project.scene.raster.height} · ${workbench.project.scene.raster.aspectPreset}`,
  };
}
