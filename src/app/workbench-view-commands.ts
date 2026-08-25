import { selectSceneMode, updateDomeScene, updateArtifact, workbench } from "../artifacts/artifact-store.svelte.js";
import type { DomeSceneEditorModeId } from "../lib/shared/contracts/dome-scene-editor.js";
import {
  defaultSourceGuideCarrierHorizonRadius,
  normalizeSourceGuideCarrierHorizonRadius,
  normalizeSourceInnerGuideSplit,
  sourceGuideHasCarrierHorizon,
} from "../geometry/source-guide-semantics.js";
import { projectionCarrierProfile } from "../geometry/projection-carrier-profile.js";
import type { SourceProjectionMode } from "../geometry/source-projection.js";
import { inpaintPromptForProjection, shouldReplaceWithProjectionInpaintPrompt } from "../inpaint/inpaint-prompts.js";
import { compensateDomeScenePlateLayersForProjectionGeometryChange } from "../plates/plate-projection-compensation.js";
import { plateCompositionSnapshot } from "../sequence/composition-sequence.js";
import { updateSelectedCompositionPlateDraft } from "./workbench-sequence-commands.js";
import {
  carrierRasterForAspect,
  carrierRasterForProjection,
  DEFAULT_DOUBLE_GABLE_PROJECTION_SURFACE,
  defaultProjectionSurface,
  MAX_PLANAR_ROOF_ANCHORS,
  normalizeProjectionSurfaceForMode,
  planarRoofProfile,
  projectionSpatialAnchors,
  projectionSurfaceMatchesMode,
  type BoxRoomProjectionSurface,
  type CarrierRaster,
  type CylinderProjectionSurface,
  type DoubleGableProjectionSurface,
  type GenerationAspectPreset,
  type PlanarRoofAnchor,
  type ProjectionSurface,
} from "../lib/shared/contracts/projection-authoring.js";

type WorkbenchViewerMode = typeof workbench.project.workspace.viewerMode;

export function changeProjectionProfile(profile: SourceProjectionMode): void {
  const previousProfile = workbench.project.scene.projectionMode;
  const refreshRepairPrompt = shouldReplaceWithProjectionInpaintPrompt(workbench.project.generation.prompt);
  const sameTopology =
    projectionCarrierProfile(previousProfile).topology === projectionCarrierProfile(profile).topology;
  const sameSurfaceFamily = projectionSurfaceMatchesMode(workbench.project.scene.surface, profile);
  const surface = sameSurfaceFamily
    ? normalizeProjectionSurfaceForMode(workbench.project.scene.surface, profile)
    : defaultProjectionSurface(profile);
  const raster = carrierRasterForProjection(profile, workbench.project.scene.raster);
  const guideSplit = normalizeSourceInnerGuideSplit(
    sameTopology ? workbench.project.scene.guideSplit : undefined,
    profile,
  );
  let horizonSplit = workbench.project.scene.horizonSplit;
  if (sourceGuideHasCarrierHorizon(profile)) {
    const nextHorizon =
      sourceGuideHasCarrierHorizon(previousProfile) && sameTopology
        ? horizonSplit
        : defaultSourceGuideCarrierHorizonRadius(profile, guideSplit);
    horizonSplit = normalizeSourceGuideCarrierHorizonRadius(profile, guideSplit, nextHorizon);
  } else {
    horizonSplit = defaultSourceGuideCarrierHorizonRadius(profile, guideSplit);
  }
  if (refreshRepairPrompt) {
    workbench.project.generation.prompt = inpaintPromptForProjection(profile, guideSplit, horizonSplit, {
      raster,
      surface,
    });
  }
  updateProjectionGeometry(profile, guideSplit, horizonSplit, { surface, raster });
  updateArtifact("plate-sketch", {
    operatorId: "choose-projection",
    summary: `${projectionLabel(profile)} profile selected.`,
  });
}

export function changeViewerMode(mode: WorkbenchViewerMode): void {
  workbench.project.workspace.viewerMode = mode;
}

export function changeSceneMode(mode: DomeSceneEditorModeId): void {
  selectSceneMode(mode);
}

export function setDomeGuideSemanticSplit(value: number | string | null | undefined): void {
  const refreshRepairPrompt = shouldReplaceWithProjectionInpaintPrompt(workbench.project.generation.prompt);
  const guideSplit = normalizeSourceInnerGuideSplit(value, workbench.project.scene.projectionMode);
  const horizonSplit = normalizeSourceGuideCarrierHorizonRadius(
    workbench.project.scene.projectionMode,
    guideSplit,
    workbench.project.scene.horizonSplit,
  );
  if (refreshRepairPrompt) {
    workbench.project.generation.prompt = inpaintPromptForProjection(
      workbench.project.scene.projectionMode,
      guideSplit,
      horizonSplit,
      { raster: workbench.project.scene.raster, surface: workbench.project.scene.surface },
    );
  }
  updateProjectionGeometry(workbench.project.scene.projectionMode, guideSplit, horizonSplit);
  updateArtifact("plate-sketch", {
    operatorId: "choose-projection",
    summary: projectionGuideSummary(),
  });
}

export function setDomeGuideHorizonSplit(value: number | string | null | undefined): void {
  const refreshRepairPrompt = shouldReplaceWithProjectionInpaintPrompt(workbench.project.generation.prompt);
  const horizonSplit = normalizeSourceGuideCarrierHorizonRadius(
    workbench.project.scene.projectionMode,
    workbench.project.scene.guideSplit,
    value,
  );
  if (refreshRepairPrompt) {
    workbench.project.generation.prompt = inpaintPromptForProjection(
      workbench.project.scene.projectionMode,
      workbench.project.scene.guideSplit,
      horizonSplit,
      { raster: workbench.project.scene.raster, surface: workbench.project.scene.surface },
    );
  }
  updateProjectionGeometry(workbench.project.scene.projectionMode, workbench.project.scene.guideSplit, horizonSplit);
  updateArtifact("plate-sketch", {
    operatorId: "choose-projection",
    summary: projectionGuideSummary(),
  });
}

export function setCarrierAspectPreset(aspectPreset: GenerationAspectPreset): void {
  const raster = carrierRasterForProjection(
    workbench.project.scene.projectionMode,
    carrierRasterForAspect(aspectPreset),
  );
  if (shouldReplaceWithProjectionInpaintPrompt(workbench.project.generation.prompt)) {
    workbench.project.generation.prompt = inpaintPromptForProjection(
      workbench.project.scene.projectionMode,
      workbench.project.scene.guideSplit,
      workbench.project.scene.horizonSplit,
      { raster, surface: workbench.project.scene.surface },
    );
  }
  updateProjectionGeometry(
    workbench.project.scene.projectionMode,
    workbench.project.scene.guideSplit,
    workbench.project.scene.horizonSplit,
    { raster },
  );
  updateArtifact("plate-sketch", {
    operatorId: "choose-projection",
    summary: `${projectionLabel(workbench.project.scene.projectionMode)} carrier set to ${raster.width} × ${raster.height} (${raster.aspectPreset}).`,
  });
}

export function setBoxRoomProjectionSurface(patch: Partial<Omit<BoxRoomProjectionSurface, "kind">>): void {
  if (workbench.project.scene.projectionMode !== "cave-270") return;
  const current = normalizeProjectionSurfaceForMode(workbench.project.scene.surface, "cave-270");
  if (current.kind !== "box-room") return;
  const width = positiveDimension(patch.width, current.width);
  const depth = positiveDimension(patch.depth, current.depth);
  const height = positiveDimension(patch.height, current.height);
  const margin = Math.min(0.01, width * 0.1, depth * 0.1, height * 0.1);
  const surface: BoxRoomProjectionSurface = {
    kind: "box-room",
    width,
    depth,
    height,
    eyeHeight: clampNumber(patch.eyeHeight, current.eyeHeight, margin, height - margin),
    eyeX: clampNumber(patch.eyeX, current.eyeX, -width * 0.5 + margin, width * 0.5 - margin),
    eyeZ: clampNumber(patch.eyeZ, current.eyeZ, -depth * 0.5 + margin, depth * 0.5 - margin),
    anchors: {
      horizonHeight: clampNumber(
        patch.anchors?.horizonHeight,
        projectionSpatialAnchors(current).horizonHeight,
        margin,
        height - margin,
      ),
    },
  };
  setProjectionSurface(surface);
}

export function setCylinderProjectionSurface(patch: Partial<Omit<CylinderProjectionSurface, "kind">>): void {
  if (!workbench.project.scene.projectionMode.startsWith("cylinder-")) return;
  const current = normalizeProjectionSurfaceForMode(
    workbench.project.scene.surface,
    workbench.project.scene.projectionMode,
  );
  if (current.kind !== "cylinder") return;
  const height = positiveDimension(patch.height, current.height);
  const margin = Math.min(0.01, height * 0.1);
  const surface: CylinderProjectionSurface = {
    kind: "cylinder",
    radius: positiveDimension(patch.radius, current.radius),
    height,
    eyeHeight: clampNumber(patch.eyeHeight, current.eyeHeight, margin, height - margin),
    anchors: {
      horizonHeight: clampNumber(
        patch.anchors?.horizonHeight,
        projectionSpatialAnchors(current).horizonHeight,
        margin,
        height - margin,
      ),
    },
  };
  setProjectionSurface(surface);
}

export function setDoubleGableProjectionSurface(patch: Partial<Omit<DoubleGableProjectionSurface, "kind">>): void {
  if (workbench.project.scene.projectionMode !== "hall-double-gable") return;
  const current = normalizeProjectionSurfaceForMode(workbench.project.scene.surface, "hall-double-gable");
  if (current.kind !== "double-gable-room") return;
  const length = positiveDimension(patch.length, current.length);
  const width = positiveDimension(patch.width, current.width);
  const eaveHeight = positiveDimension(patch.eaveHeight, current.eaveHeight);
  const valleyHeight = positiveDimension(patch.valleyHeight, current.valleyHeight);
  const roofMargin = Math.min(0.01, eaveHeight * 0.1, valleyHeight * 0.1);
  const ridgeHeight = Math.max(
    positiveDimension(patch.ridgeHeight, current.ridgeHeight),
    Math.max(eaveHeight, valleyHeight) + roofMargin,
  );
  const roofProfile = normalizePlanarRoofAnchors(patch.roofProfile ?? planarRoofProfile(current));
  const observerCeiling = Math.min(...roofProfile.map((anchor) => anchor.height));
  const observerMargin = Math.min(0.01, observerCeiling * 0.1, length * 0.1, width * 0.1);
  const surface: DoubleGableProjectionSurface = {
    kind: "double-gable-room",
    length,
    width,
    eaveHeight,
    ridgeHeight,
    valleyHeight,
    ridgeInset: clampNumber(
      patch.ridgeInset,
      Math.min(current.ridgeInset, width * 0.5 - observerMargin),
      observerMargin,
      width * 0.5 - observerMargin,
    ),
    roofProfile,
    eyeHeight: clampNumber(patch.eyeHeight, current.eyeHeight, observerMargin, observerCeiling - observerMargin),
    eyeX: clampNumber(patch.eyeX, current.eyeX, -length * 0.5 + observerMargin, length * 0.5 - observerMargin),
    eyeZ: clampNumber(patch.eyeZ, current.eyeZ, -width * 0.5 + observerMargin, width * 0.5 - observerMargin),
    anchors: {
      horizonHeight: clampNumber(
        patch.anchors?.horizonHeight,
        projectionSpatialAnchors(current).horizonHeight,
        observerMargin,
        observerCeiling - observerMargin,
      ),
    },
  };
  setProjectionSurface(surface);
}

/**
 * Moves the authored texture horizon without changing the observer pose, venue
 * shell, plate placement or source-raster allocation.
 */
export function setProjectionSurfacePhysicalHorizon(height: number | string | null | undefined): void {
  const surface = workbench.project.scene.surface;
  const rawNumeric = Number(height);
  if (!Number.isFinite(rawNumeric)) return;
  const numeric = Math.round(rawNumeric * 1000) / 1000;
  if (surface.kind === "box-room") {
    const margin = Math.min(0.01, surface.height * 0.1);
    setProjectionSurface(
      {
        ...surface,
        anchors: {
          horizonHeight: clampNumber(
            numeric,
            projectionSpatialAnchors(surface).horizonHeight,
            margin,
            surface.height - margin,
          ),
        },
      },
      { compensatePlacements: false },
    );
  } else if (surface.kind === "double-gable-room") {
    const ceiling = Math.min(...planarRoofProfile(surface).map((anchor) => anchor.height));
    const margin = Math.min(0.01, ceiling * 0.1);
    setProjectionSurface(
      {
        ...surface,
        anchors: {
          horizonHeight: clampNumber(
            numeric,
            projectionSpatialAnchors(surface).horizonHeight,
            margin,
            ceiling - margin,
          ),
        },
      },
      { compensatePlacements: false },
    );
  } else if (surface.kind === "cylinder") {
    const margin = Math.min(0.01, surface.height * 0.1);
    setProjectionSurface(
      {
        ...surface,
        anchors: {
          horizonHeight: clampNumber(
            numeric,
            projectionSpatialAnchors(surface).horizonHeight,
            margin,
            surface.height - margin,
          ),
        },
      },
      { compensatePlacements: false },
    );
  }
}

export function setAngularProjectionSpatialAnchor(
  id: "semantic" | "horizon",
  elevationDegrees: number | string | null | undefined,
): void {
  const surface = workbench.project.scene.surface;
  if (surface.kind !== "angular") return;
  const rawNumeric = Number(elevationDegrees);
  if (!Number.isFinite(rawNumeric)) return;
  const numeric = Math.round(rawNumeric * 10) / 10;
  const anchors = projectionSpatialAnchors(surface);
  const zenithOrdered = workbench.project.scene.projectionMode !== "nadir-180";
  const domainMinimum =
    workbench.project.scene.projectionMode === "nadir-180"
      ? -89.5
      : workbench.project.scene.projectionMode === "zenith-230"
        ? -25
        : 0;
  const domainMaximum = workbench.project.scene.projectionMode === "nadir-180" ? 0 : 89.5;
  const gap = 0.5;
  const next = { ...anchors };
  if (id === "semantic") {
    next.semanticElevationDegrees = zenithOrdered
      ? clampNumber(numeric, anchors.semanticElevationDegrees, anchors.horizonElevationDegrees + gap, domainMaximum)
      : clampNumber(numeric, anchors.semanticElevationDegrees, domainMinimum, anchors.horizonElevationDegrees - gap);
  } else {
    next.horizonElevationDegrees = zenithOrdered
      ? clampNumber(numeric, anchors.horizonElevationDegrees, domainMinimum, anchors.semanticElevationDegrees - gap)
      : clampNumber(numeric, anchors.horizonElevationDegrees, anchors.semanticElevationDegrees + gap, domainMaximum);
  }
  setProjectionSurface({ kind: "angular", anchors: next }, { compensatePlacements: false });
}

export function setPlanarHallRoofProfile(anchors: PlanarRoofAnchor[]): void {
  if (workbench.project.scene.projectionMode !== "hall-double-gable") return;
  const current = normalizeProjectionSurfaceForMode(workbench.project.scene.surface, "hall-double-gable");
  if (current.kind !== "double-gable-room") return;
  const roofProfile = normalizePlanarRoofAnchors(anchors);
  const minimumHeight = Math.min(...roofProfile.map((anchor) => anchor.height));
  const observerMargin = Math.min(0.01, minimumHeight * 0.1);
  setProjectionSurface({
    ...current,
    roofProfile,
    eyeHeight: clampNumber(current.eyeHeight, current.eyeHeight, observerMargin, minimumHeight - observerMargin),
  });
}

function setProjectionSurface(
  surface: ProjectionSurface,
  { compensatePlacements = true }: { compensatePlacements?: boolean } = {},
): void {
  if (shouldReplaceWithProjectionInpaintPrompt(workbench.project.generation.prompt)) {
    workbench.project.generation.prompt = inpaintPromptForProjection(
      workbench.project.scene.projectionMode,
      workbench.project.scene.guideSplit,
      workbench.project.scene.horizonSplit,
      { raster: workbench.project.scene.raster, surface },
    );
  }
  updateProjectionGeometry(
    workbench.project.scene.projectionMode,
    workbench.project.scene.guideSplit,
    workbench.project.scene.horizonSplit,
    { surface, compensatePlacements },
  );
  updateArtifact("plate-sketch", {
    operatorId: "choose-projection",
    summary: `${projectionLabel(workbench.project.scene.projectionMode)} measured carrier geometry updated.`,
  });
}

function projectionLabel(profile: SourceProjectionMode): string {
  return profile
    .split("-")
    .map((part) => part[0].toUpperCase() + part.slice(1))
    .join(" ");
}

function normalizePlanarRoofAnchors(anchors: PlanarRoofAnchor[]): PlanarRoofAnchor[] {
  const source = anchors.length >= 3 ? anchors : planarRoofProfile(DEFAULT_DOUBLE_GABLE_PROJECTION_SURFACE);
  const normalized = source
    .slice(0, MAX_PLANAR_ROOF_ANCHORS)
    .map((anchor, index) => ({
      id: String(anchor.id || `roof-anchor-${index + 1}`),
      position: clampNumber(anchor.position, index / Math.max(source.length - 1, 1), 0, 1),
      height: positiveDimension(anchor.height, 0.05),
      role: anchor.role,
    }))
    .sort((left, right) => left.position - right.position);
  normalized[0].position = 0;
  normalized[normalized.length - 1].position = 1;
  for (let index = 1; index < normalized.length - 1; index += 1) {
    normalized[index].position = clampNumber(
      normalized[index].position,
      normalized[index].position,
      normalized[index - 1].position + 0.001,
      1 - (normalized.length - 1 - index) * 0.001,
    );
  }
  return normalized.map((anchor, index) => {
    if (index === 0 || index === normalized.length - 1) return { ...anchor, role: "eave" };
    const leftHeight = normalized[index - 1].height;
    const rightHeight = normalized[index + 1].height;
    if (anchor.height > leftHeight && anchor.height > rightHeight) return { ...anchor, role: "ridge" };
    if (anchor.height < leftHeight && anchor.height < rightHeight) return { ...anchor, role: "valley" };
    return { ...anchor, role: "break" };
  });
}

function updateProjectionGeometry(
  projectionMode: SourceProjectionMode,
  guideSplit: number,
  horizonSplit: number,
  {
    surface = normalizeProjectionSurfaceForMode(workbench.project.scene.surface, projectionMode),
    raster = workbench.project.scene.raster,
    compensatePlacements = true,
  }: { surface?: ProjectionSurface; raster?: CarrierRaster; compensatePlacements?: boolean } = {},
): void {
  const previousScene = workbench.project.scene;
  const previousGeometry = {
    mode: previousScene.projectionMode,
    guideSplit: previousScene.guideSplit,
    horizonSplit: previousScene.horizonSplit,
    surface: previousScene.surface,
    raster: previousScene.raster,
  };
  const nextGeometry = { mode: projectionMode, guideSplit, horizonSplit, surface, raster };
  updateDomeScene({
    ...previousScene,
    projectionMode,
    surface,
    raster,
    guideSplit,
    horizonSplit,
    frame0: {
      ...previousScene.frame0,
      plateLayers: compensatePlacements
        ? compensateDomeScenePlateLayersForProjectionGeometryChange(
            previousScene.frame0.plateLayers,
            previousGeometry,
            nextGeometry,
          )
        : previousScene.frame0.plateLayers,
    },
  });
  updateSelectedCompositionPlateDraft(plateCompositionSnapshot(workbench.project.scene));
}

function positiveDimension(value: unknown, fallback: number): number {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.max(0.05, numeric) : fallback;
}

function clampNumber(value: unknown, fallback: number, min: number, max: number): number {
  const numeric = Number(value);
  return Math.min(max, Math.max(min, Number.isFinite(numeric) ? numeric : fallback));
}

function projectionGuideSummary(): string {
  const inner = Math.round(workbench.project.scene.guideSplit * 100);
  if (!sourceGuideHasCarrierHorizon(workbench.project.scene.projectionMode)) {
    return `${projectionLabel(workbench.project.scene.projectionMode)} profile selected with ${inner}% semantic guide split.`;
  }
  const horizon = Math.round(workbench.project.scene.horizonSplit * 100);
  return `${projectionLabel(workbench.project.scene.projectionMode)} profile selected with ${inner}% inner split and ${horizon}% horizon carrier.`;
}
