import { defaultPlateEditorCamera } from "../plates/plate-editor-view.js";
import { compensateDomeScenePlateLayersForProjectionGeometryChange } from "../plates/plate-projection-compensation.js";
import { arrangePlateSketchDefaults } from "../plates/plate-sketch-arrangement.js";
import { DEFAULT_PLATE_REFERENCES } from "../plates/default-plate-profile.js";
import { createDefaultDomeScene } from "../scene/dome-scene.js";
import {
  carrierRasterForAspect,
  cloneCarrierRaster,
  cloneProjectionSurface,
  defaultProjectionSurface,
  normalizeProjectionSurfaceForMode,
  rebaseProjectionSurfaceHorizonForObserverChange,
  type CarrierRaster,
  type ProjectionSurface,
} from "../lib/shared/contracts/projection-authoring.js";
import { SOURCE_PROJECTION_DEFAULT_GUIDES } from "../lib/shared/contracts/projection-profile.js";
import {
  normalizeSourceGuideCarrierHorizonRadius,
  normalizeSourceInnerGuideSplit,
} from "../geometry/source-guide-semantics.js";
import type {
  Composition,
  ImageSpatialSpec,
  ImageTake,
  MediaAsset,
  PlateCommit,
  PlateDraft,
  Project,
  Workspace,
  ZenithDocument,
} from "./schema.js";
import { DEFAULT_AUDIENCE_IN_SPACE, decodeSchemaSync, ZenithDocumentSchema } from "./schema.js";

export type CompositionReadiness = {
  readonly sourceCount: number;
  readonly missingPlateCommit: boolean;
  readonly plateDirty: boolean;
  readonly missingImageTake: boolean;
  readonly imageTakeStale: boolean;
  readonly canCommit: boolean;
  readonly canGenerate: boolean;
  readonly canReview: boolean;
};

export type NewMediaAssetInput = Omit<MediaAsset, "id" | "createdAt"> & {
  readonly id: string;
  readonly createdAt: string;
};

export type ProjectionGeometryPatch = {
  readonly projectionMode?: PlateDraft["projectionMode"];
  readonly surface?: ProjectionSurface;
  readonly raster?: CarrierRaster;
  readonly guideSplit?: number;
  readonly horizonSplit?: number;
};

export type ProjectionGeometryUpdateOptions = {
  /** Spatial anchors are authoring overlays and do not remap plate coordinates. */
  readonly compensatePlacements?: boolean;
};

export function createInitialZenithDocument({
  now = new Date().toISOString(),
  projectId = "project-local",
  compositionId = "composition-1",
}: {
  now?: string;
  projectId?: string;
  compositionId?: string;
} = {}): ZenithDocument {
  const scene = createDefaultDomeScene();
  const assets = Object.fromEntries(
    DEFAULT_PLATE_REFERENCES.map((reference, index) => {
      const id = `source-default-${index + 1}`;
      return [
        id,
        {
          id,
          kind: "image" as const,
          filename: reference.name,
          mime: "image/png",
          width: reference.width,
          height: reference.height,
          storageRef: reference.url,
          alt: reference.name,
          createdAt: now,
        },
      ];
    }),
  );
  const plates = Object.values(assets).map((asset) => ({
    name: asset.filename,
    width: asset.width,
    height: asset.height,
    aspect: asset.width / asset.height,
    assetId: asset.id,
    sourceUrl: asset.storageRef,
    mime: asset.mime,
  }));
  const arrangement = arrangePlateSketchDefaults(plates);
  scene.frame0.plateLayers = plates.map((plate, index) => ({
    id: `plate-layer-${index + 1}-${plate.name.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}`,
    name: plate.name,
    index,
    source: {
      assetId: plate.assetId,
      name: plate.name,
      width: plate.width,
      height: plate.height,
      aspect: plate.aspect,
      url: plate.sourceUrl,
      mime: plate.mime,
    },
    placement: structuredClone(arrangement.placements[index]!),
    visible: true,
    locked: false,
  }));
  scene.frame0.activeLayerId = scene.frame0.plateLayers[arrangement.activeIndex]?.id ?? null;

  const plateDraft: PlateDraft = {
    projectionMode: scene.projectionMode,
    surface: cloneProjectionSurface(scene.surface),
    raster: cloneCarrierRaster(scene.raster),
    guideSplit: scene.guideSplit,
    horizonSplit: scene.horizonSplit,
    frame: structuredClone(scene.frame0),
  };
  const composition: Composition = {
    id: compositionId,
    label: "Composition 01",
    sourceAssetIds: Object.keys(assets),
    plateDraft,
    plateCommits: [],
    imageTakes: [],
    selectedPlateCommitId: null,
    selectedImageTakeId: null,
    generationDirection: "",
    generationStrategy: "integrated",
    notes: "",
    createdAt: now,
    updatedAt: now,
  };
  const camera = defaultPlateEditorCamera(plateDraft.projectionMode, plateDraft.surface);
  const workspace: Workspace = {
    selectedCompositionId: composition.id,
    room: "compose",
    selectedLayerId: plateDraft.frame.activeLayerId,
    viewMode: "source-map",
    viewerMode: "domemaster",
    audience: { ...DEFAULT_AUDIENCE_IN_SPACE },
    camera: {
      position: [...camera.position],
      orientation: [...camera.orientation],
      pivot: camera.pivot ? [...camera.pivot] : null,
      fovDegrees: camera.fovDegrees,
      nearMeters: camera.nearMeters ?? 0.01,
      farMeters: camera.farMeters ?? 80,
      mode: camera.mode,
    },
  };
  return decodeSchemaSync(ZenithDocumentSchema, {
    project: {
      schemaVersion: 1,
      id: projectId,
      metadata: { title: "Zenith Project", createdAt: now, updatedAt: now },
      assets,
      compositions: [composition],
    },
    workspace,
  });
}

export function selectedComposition(document: ZenithDocument): Composition {
  return (
    document.project.compositions.find((composition) => composition.id === document.workspace.selectedCompositionId) ??
    document.project.compositions[0]!
  );
}

export function compositionById(project: Project, compositionId: string): Composition | null {
  return project.compositions.find((composition) => composition.id === compositionId) ?? null;
}

export function selectedPlateCommit(composition: Composition): PlateCommit | null {
  if (!composition.selectedPlateCommitId) return null;
  return composition.plateCommits.find((commit) => commit.id === composition.selectedPlateCommitId) ?? null;
}

export function selectedImageTake(composition: Composition): ImageTake | null {
  if (!composition.selectedImageTakeId) return null;
  return composition.imageTakes.find((take) => take.id === composition.selectedImageTakeId) ?? null;
}

export function reviewMediaAsset(document: ZenithDocument): MediaAsset | null {
  const composition = selectedComposition(document);
  const take = selectedImageTake(composition);
  const commit = selectedPlateCommit(composition);
  const id = take?.mediaAssetId ?? commit?.mediaAssetId;
  return id ? (document.project.assets[id] ?? null) : null;
}

export function compositionReadiness(composition: Composition): CompositionReadiness {
  const commit = selectedPlateCommit(composition);
  const take = selectedImageTake(composition);
  const plateDirty = Boolean(
    commit && commit.provenance.draftFingerprint !== plateDraftFingerprint(composition.plateDraft),
  );
  const imageTakeStale = Boolean(take && commit && take.plateCommitId !== commit.id);
  return {
    sourceCount: composition.sourceAssetIds.length,
    missingPlateCommit: !commit,
    plateDirty,
    missingImageTake: !take,
    imageTakeStale,
    canCommit: composition.sourceAssetIds.length > 0 && composition.plateDraft.frame.plateLayers.length > 0,
    canGenerate: Boolean(commit && !plateDirty),
    canReview: Boolean(take || commit),
  };
}

export function plateDraftFingerprint(draft: PlateDraft): string {
  return canonicalJson({
    projectionMode: draft.projectionMode,
    surface: draft.surface,
    raster: draft.raster,
    guideSplit: draft.guideSplit,
    horizonSplit: draft.horizonSplit,
    frame: {
      plateFit: draft.frame.plateFit,
      plateFeather: draft.frame.plateFeather,
      plateLayers: draft.frame.plateLayers.map((layer) => ({
        source: {
          assetId: layer.source.assetId,
          width: layer.source.width,
          height: layer.source.height,
          aspect: layer.source.aspect,
        },
        placement: layer.placement,
        visible: layer.visible,
      })),
    },
  });
}

export function defaultImageSpatialSpec(draft: PlateDraft): ImageSpatialSpec {
  return {
    sourceWidth: null,
    sourceHeight: null,
    sourceAspectRatio: draft.raster.width / draft.raster.height,
    projectionMode: draft.projectionMode,
    surface: cloneProjectionSurface(draft.surface),
    fit: "contain",
    scale: 1,
    offsetX: 0,
    offsetY: 0,
    rotationDegrees: 0,
    guideSplit: draft.guideSplit,
    horizonSplit: draft.horizonSplit,
    safeRimRadius:
      draft.projectionMode.startsWith("cylinder-") || draft.projectionMode === "hall-double-gable" ? 1 : 0.96,
    exterior:
      draft.projectionMode === "cave-270" ||
      draft.projectionMode === "hall-double-gable" ||
      draft.projectionMode === "cylinder-wall"
        ? "preserve"
        : "black",
    targetWidth: draft.raster.width,
    targetHeight: draft.raster.height,
  };
}

export function updateDocument(document: ZenithDocument, update: (draft: ZenithDocument) => void): ZenithDocument {
  const next = structuredClone(document);
  update(next);
  return decodeSchemaSync(ZenithDocumentSchema, next);
}

export function setRoom(document: ZenithDocument, room: Workspace["room"]): ZenithDocument {
  return updateDocument(document, (next) => {
    next.workspace.room = room;
  });
}

export function selectComposition(document: ZenithDocument, compositionId: string): ZenithDocument {
  if (!compositionById(document.project, compositionId)) return document;
  return updateDocument(document, (next) => {
    next.workspace.selectedCompositionId = compositionId;
    const composition = compositionById(next.project, compositionId)!;
    next.workspace.selectedLayerId = composition.plateDraft.frame.activeLayerId;
    next.workspace.viewMode = "source-map";
    const camera = defaultPlateEditorCamera(composition.plateDraft.projectionMode, composition.plateDraft.surface);
    next.workspace.camera = {
      position: [...camera.position],
      orientation: [...camera.orientation],
      pivot: camera.pivot ? [...camera.pivot] : null,
      fovDegrees: camera.fovDegrees,
      nearMeters: camera.nearMeters ?? 0.01,
      farMeters: camera.farMeters ?? 80,
      mode: camera.mode,
    };
  });
}

export function createComposition(
  document: ZenithDocument,
  { id, now, duplicateSelected }: { id: string; now: string; duplicateSelected: boolean },
): ZenithDocument {
  return updateDocument(document, (next) => {
    const source = selectedComposition(next);
    const number = next.project.compositions.length + 1;
    const draft = duplicateSelected ? structuredClone(source.plateDraft) : blankPlateDraft(source.plateDraft);
    const composition: Composition = {
      id,
      label: `Composition ${String(number).padStart(2, "0")}`,
      sourceAssetIds: duplicateSelected ? [...source.sourceAssetIds] : [],
      plateDraft: draft,
      plateCommits: [],
      imageTakes: [],
      selectedPlateCommitId: null,
      selectedImageTakeId: null,
      generationDirection: duplicateSelected ? source.generationDirection : "",
      generationStrategy: duplicateSelected ? source.generationStrategy : "integrated",
      notes: duplicateSelected ? `Derived from ${source.label}.` : "",
      createdAt: now,
      updatedAt: now,
    };
    remapPlateLayerIds(composition);
    next.project.compositions.push(composition);
    next.workspace.selectedCompositionId = composition.id;
    next.workspace.selectedLayerId = composition.plateDraft.frame.activeLayerId;
    next.workspace.room = "compose";
  });
}

export function deleteComposition(document: ZenithDocument, compositionId: string): ZenithDocument {
  if (document.project.compositions.length <= 1) return document;
  return updateDocument(document, (next) => {
    const index = next.project.compositions.findIndex((composition) => composition.id === compositionId);
    if (index < 0) return;
    next.project.compositions.splice(index, 1);
    if (next.workspace.selectedCompositionId === compositionId) {
      const selected = next.project.compositions[Math.min(index, next.project.compositions.length - 1)]!;
      next.workspace.selectedCompositionId = selected.id;
      next.workspace.selectedLayerId = selected.plateDraft.frame.activeLayerId;
    }
    removeUnreferencedAssets(next.project);
  });
}

export function replaceSelectedCompositionDraft(
  document: ZenithDocument,
  draft: PlateDraft,
  now: string,
): ZenithDocument {
  return updateDocument(document, (next) => {
    const composition = selectedComposition(next);
    composition.plateDraft = structuredClone(draft);
    composition.sourceAssetIds = [
      ...new Set(
        draft.frame.plateLayers.flatMap((layer) =>
          layer.source.assetId && next.project.assets[layer.source.assetId] ? [layer.source.assetId] : [],
        ),
      ),
    ];
    composition.updatedAt = now;
    next.workspace.selectedLayerId = draft.frame.activeLayerId;
  });
}

export function addSourceAssets(
  document: ZenithDocument,
  assets: readonly MediaAsset[],
  layers: PlateDraft["frame"]["plateLayers"],
  now: string,
  { replace = false }: { replace?: boolean } = {},
): ZenithDocument {
  return updateDocument(document, (next) => {
    const composition = selectedComposition(next);
    for (const asset of assets) next.project.assets[asset.id] = structuredClone(asset);
    if (replace) {
      composition.sourceAssetIds = assets.map((asset) => asset.id);
      composition.plateDraft.frame.plateLayers = structuredClone(layers);
    } else {
      composition.sourceAssetIds.push(...assets.map((asset) => asset.id));
      composition.sourceAssetIds = [...new Set(composition.sourceAssetIds)];
      composition.plateDraft.frame.plateLayers.push(...structuredClone(layers));
    }
    composition.plateDraft.frame.plateLayers.forEach((layer, index) => {
      layer.index = index;
    });
    composition.plateDraft.frame.activeLayerId =
      layers.at(-1)?.id ?? composition.plateDraft.frame.plateLayers[0]?.id ?? null;
    next.workspace.selectedLayerId = composition.plateDraft.frame.activeLayerId;
    composition.updatedAt = now;
  });
}

export function removeSourceAsset(document: ZenithDocument, assetId: string, now: string): ZenithDocument {
  return updateDocument(document, (next) => {
    const composition = selectedComposition(next);
    composition.sourceAssetIds = composition.sourceAssetIds.filter((id) => id !== assetId);
    composition.plateDraft.frame.plateLayers = composition.plateDraft.frame.plateLayers.filter(
      (layer) => layer.source.assetId !== assetId,
    );
    composition.plateDraft.frame.plateLayers.forEach((layer, index) => {
      layer.index = index;
    });
    const activeStillExists = composition.plateDraft.frame.plateLayers.some(
      (layer) => layer.id === composition.plateDraft.frame.activeLayerId,
    );
    if (!activeStillExists) {
      composition.plateDraft.frame.activeLayerId = composition.plateDraft.frame.plateLayers[0]?.id ?? null;
    }
    next.workspace.selectedLayerId = composition.plateDraft.frame.activeLayerId;
    composition.updatedAt = now;
    removeUnreferencedAssets(next.project);
  });
}

export function addPlateCommit(
  document: ZenithDocument,
  media: MediaAsset,
  commit: PlateCommit,
  now: string,
): ZenithDocument {
  return updateDocument(document, (next) => {
    const composition = selectedComposition(next);
    next.project.assets[media.id] = structuredClone(media);
    composition.plateCommits.push(structuredClone(commit));
    composition.selectedPlateCommitId = commit.id;
    composition.updatedAt = now;
    next.workspace.room = "generate";
  });
}

export function addImageTake(
  document: ZenithDocument,
  media: MediaAsset,
  take: ImageTake,
  now: string,
): ZenithDocument {
  return updateDocument(document, (next) => {
    const composition = selectedComposition(next);
    next.project.assets[media.id] = structuredClone(media);
    composition.imageTakes.push(structuredClone(take));
    composition.selectedImageTakeId = take.id;
    composition.updatedAt = now;
    next.workspace.room = "review";
  });
}

export function selectPlateCommit(document: ZenithDocument, commitId: string): ZenithDocument {
  const composition = selectedComposition(document);
  if (!composition.plateCommits.some((commit) => commit.id === commitId)) return document;
  return updateDocument(document, (next) => {
    selectedComposition(next).selectedPlateCommitId = commitId;
  });
}

export function selectImageTake(document: ZenithDocument, takeId: string): ZenithDocument {
  const composition = selectedComposition(document);
  if (!composition.imageTakes.some((take) => take.id === takeId)) return document;
  return updateDocument(document, (next) => {
    selectedComposition(next).selectedImageTakeId = takeId;
  });
}

export function setGenerationDirection(
  document: ZenithDocument,
  direction: string,
  strategy: Composition["generationStrategy"],
): ZenithDocument {
  return updateDocument(document, (next) => {
    const composition = selectedComposition(next);
    composition.generationDirection = direction;
    composition.generationStrategy = strategy;
  });
}

export function setProjection(
  document: ZenithDocument,
  projectionMode: PlateDraft["projectionMode"],
  raster: CarrierRaster,
  now: string,
): ZenithDocument {
  return updateProjectionGeometry(document, { projectionMode, raster }, now);
}

/**
 * Changes the authored carrier while preserving every plate's physical
 * direction. UI controls must use this transition for all projection geometry
 * edits instead of mutating PlateDraft fields independently.
 */
export function updateProjectionGeometry(
  document: ZenithDocument,
  patch: ProjectionGeometryPatch,
  now: string,
  { compensatePlacements = true }: ProjectionGeometryUpdateOptions = {},
): ZenithDocument {
  return updateDocument(document, (next) => {
    const composition = selectedComposition(next);
    const draft = composition.plateDraft;
    const previousGeometry = {
      mode: draft.projectionMode,
      surface: draft.surface,
      raster: draft.raster,
      guideSplit: draft.guideSplit,
      horizonSplit: draft.horizonSplit,
    };
    const projectionMode = patch.projectionMode ?? draft.projectionMode;
    const modeChanged = projectionMode !== draft.projectionMode;
    const defaults = SOURCE_PROJECTION_DEFAULT_GUIDES[projectionMode];
    const guideSplit = normalizeSourceInnerGuideSplit(
      patch.guideSplit ?? (modeChanged ? defaults.innerSplit : draft.guideSplit),
      projectionMode,
    );
    const horizonSplit = normalizeSourceGuideCarrierHorizonRadius(
      projectionMode,
      guideSplit,
      patch.horizonSplit ?? (modeChanged ? defaults.horizonSplit : draft.horizonSplit),
    );
    const crossesAngularPole = modeChanged && (projectionMode === "nadir-180" || draft.projectionMode === "nadir-180");
    const requestedSurface =
      patch.surface ?? (crossesAngularPole ? defaultProjectionSurface(projectionMode) : draft.surface);
    const surface = normalizeProjectionSurfaceForMode(
      patch.surface && !modeChanged
        ? rebaseProjectionSurfaceHorizonForObserverChange(draft.surface, requestedSurface)
        : requestedSurface,
      projectionMode,
    );
    const raster = cloneCarrierRaster(patch.raster ?? draft.raster);
    const nextGeometry = {
      mode: projectionMode,
      surface,
      raster,
      guideSplit,
      horizonSplit,
    };

    if (compensatePlacements) {
      draft.frame.plateLayers = compensateDomeScenePlateLayersForProjectionGeometryChange(
        draft.frame.plateLayers,
        previousGeometry,
        nextGeometry,
      );
    }
    draft.projectionMode = projectionMode;
    draft.surface = surface;
    draft.raster = raster;
    draft.guideSplit = guideSplit;
    draft.horizonSplit = horizonSplit;
    composition.updatedAt = now;
    if (modeChanged) {
      const camera = defaultPlateEditorCamera(projectionMode, surface);
      next.workspace.camera = {
        position: [...camera.position],
        orientation: [...camera.orientation],
        pivot: camera.pivot ? [...camera.pivot] : null,
        fovDegrees: camera.fovDegrees,
        nearMeters: camera.nearMeters ?? 0.01,
        farMeters: camera.farMeters ?? 80,
        mode: camera.mode,
      };
      next.workspace.viewMode = "source-map";
    }
  });
}

export function validateZenithDocument(value: unknown): ZenithDocument {
  return decodeSchemaSync(ZenithDocumentSchema, value);
}

function blankPlateDraft(source: PlateDraft): PlateDraft {
  return {
    projectionMode: source.projectionMode,
    surface: cloneProjectionSurface(source.surface),
    raster: cloneCarrierRaster(source.raster),
    guideSplit: source.guideSplit,
    horizonSplit: source.horizonSplit,
    frame: {
      plateFit: source.frame.plateFit,
      plateFeather: source.frame.plateFeather,
      activeLayerId: null,
      plateLayers: [],
    },
  };
}

function remapPlateLayerIds(composition: Composition): void {
  const activeId = composition.plateDraft.frame.activeLayerId;
  let nextActive: string | null = null;
  composition.plateDraft.frame.plateLayers.forEach((layer, index) => {
    const oldId = layer.id;
    layer.id = `plate-layer:${composition.id}:${layer.source.assetId ?? index + 1}`;
    layer.index = index;
    if (oldId === activeId) nextActive = layer.id;
  });
  composition.plateDraft.frame.activeLayerId = nextActive ?? composition.plateDraft.frame.plateLayers[0]?.id ?? null;
}

function removeUnreferencedAssets(project: Project): void {
  const referenced = new Set<string>();
  for (const composition of project.compositions) {
    for (const id of composition.sourceAssetIds) referenced.add(id);
    for (const commit of composition.plateCommits) referenced.add(commit.mediaAssetId);
    for (const take of composition.imageTakes) referenced.add(take.mediaAssetId);
  }
  for (const assetId of Object.keys(project.assets)) {
    if (!referenced.has(assetId)) delete project.assets[assetId];
  }
}

function canonicalJson(value: unknown): string {
  if (value === null) return "null";
  if (typeof value === "string" || typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("Plate Draft contains a non-finite number.");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`)
      .join(",")}}`;
  }
  throw new Error("Plate Draft contains a non-JSON value.");
}

export function defaultCarrierRaster(): CarrierRaster {
  return carrierRasterForAspect("1:1");
}
