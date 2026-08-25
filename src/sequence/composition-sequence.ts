import type {
  Composition,
  CompositionRevision,
  CompositionRevisionMedia,
  CompositionSequence,
  ImageSpatialSpec,
  PlateCompositionSnapshot,
} from "../lib/shared/contracts/composition-sequence.js";
import { COMPOSITION_SEQUENCE_VERSION, defaultImageSpatialSpec } from "../lib/shared/contracts/composition-sequence.js";
import { DomeSceneFrame0Schema, type DomeScene } from "../lib/shared/contracts/dome-scene.js";
import {
  cloneCarrierRaster,
  cloneProjectionSurface,
  planarRoofProfile,
  type ProjectionSurface,
} from "../lib/shared/contracts/projection-authoring.js";

let localIdCounter = 0;

export function createCompositionSequenceId(prefix: string): string {
  const uuid = globalThis.crypto?.randomUUID?.();
  if (uuid) return `${prefix}-${uuid}`;
  localIdCounter += 1;
  return `${prefix}-${Date.now().toString(36)}-${localIdCounter.toString(36)}`;
}

export function createInitialCompositionSequence({
  plateSketch,
  scene,
  createdAt = new Date().toISOString(),
}: {
  plateSketch: CompositionRevisionMedia;
  scene: DomeScene;
  createdAt?: string;
}): CompositionSequence {
  const revisionId = "revision-initial-plate-sketch";
  const compositionId = "composition-1";
  const draft = plateCompositionSnapshot(scene);
  return {
    version: COMPOSITION_SEQUENCE_VERSION,
    revisionOrder: [revisionId],
    revisions: {
      [revisionId]: {
        id: revisionId,
        kind: "plate-sketch",
        label: plateSketch.name || "Initial Plate Sketch",
        createdAt,
        media: structuredClone(plateSketch),
        normalizedMedia: structuredClone(plateSketch),
        parents: [],
        operatorId: "initial-plate-sketch",
        projectionProfile: scene.projectionMode,
        spatialSpec: defaultImageSpatialSpec({
          projectionMode: scene.projectionMode,
          surface: scene.surface,
          guideSplit: scene.guideSplit,
          horizonSplit: scene.horizonSplit,
          targetWidth: scene.raster.width,
          targetHeight: scene.raster.height,
        }),
        plateComposition: draft,
      },
    },
    sourceAssetOrder: [],
    sourceAssets: {},
    compositions: [
      {
        id: compositionId,
        label: "Composition 01",
        sourceAssetIds: [],
        plateSketchRevisionId: revisionId,
        imageRevisionId: null,
        plateDraft: structuredClone(draft),
        status: "draft",
        notes: "",
        createdAt,
        updatedAt: createdAt,
      },
    ],
  };
}

export function plateCompositionSnapshot(scene: DomeScene): PlateCompositionSnapshot {
  return {
    projectionMode: scene.projectionMode,
    surface: cloneProjectionSurface(scene.surface),
    raster: cloneCarrierRaster(scene.raster),
    guideSplit: scene.guideSplit,
    horizonSplit: scene.horizonSplit,
    frame: DomeSceneFrame0Schema.parse(scene.frame0),
  };
}

export function presentationMediaForRevision(revision: CompositionRevision): CompositionRevisionMedia {
  if (revision.spatialSpec.projectionMode === "cylinder-wall") return revision.media;
  return revision.normalizedMedia || revision.media;
}

export function selectedImageRevisionForComposition(
  library: CompositionSequence,
  composition: Composition | null | undefined,
): CompositionRevision | null {
  if (!composition?.imageRevisionId) return null;
  return library.revisions[composition.imageRevisionId] || null;
}

export function imageRevisionHistoryForComposition(
  library: CompositionSequence,
  composition: Composition | null | undefined,
): CompositionRevision[] {
  if (!composition) return [];
  const currentId = composition.imageRevisionId;
  const plateId = composition.plateSketchRevisionId;
  return [...library.revisionOrder]
    .reverse()
    .map((revisionId) => library.revisions[revisionId])
    .filter(
      (revision): revision is CompositionRevision =>
        Boolean(revision) &&
        (revision.kind === "clean-image" || revision.kind === "reference-image") &&
        (revision.id === currentId || Boolean(plateId && revisionDependsOn(library, revision, plateId))),
    );
}

export function presentationRevisionForComposition(
  library: CompositionSequence,
  composition: Composition | null | undefined,
): CompositionRevision | null {
  return (
    selectedImageRevisionForComposition(library, composition) || plateSketchRevisionForComposition(library, composition)
  );
}

export function plateSketchRevisionForComposition(
  library: CompositionSequence,
  composition: Composition | null | undefined,
): CompositionRevision | null {
  if (!composition?.plateSketchRevisionId) return null;
  return library.revisions[composition.plateSketchRevisionId] || null;
}

export function committedPlateSketchMatchesDraft(
  library: CompositionSequence,
  composition: Composition | null | undefined,
): boolean {
  if (!composition) return false;
  const revision = plateSketchRevisionForComposition(library, composition);
  return Boolean(
    revision?.plateComposition && plateCompositionsRenderEqual(revision.plateComposition, composition.plateDraft),
  );
}

export function plateCompositionsRenderEqual(left: PlateCompositionSnapshot, right: PlateCompositionSnapshot): boolean {
  return (
    JSON.stringify(plateCompositionRenderFingerprint(left)) === JSON.stringify(plateCompositionRenderFingerprint(right))
  );
}

export function compositionById(
  library: CompositionSequence,
  compositionId: string | null | undefined,
): Composition | null {
  if (!compositionId) return null;
  return library.compositions.find((composition) => composition.id === compositionId) || null;
}

export function addRevision(library: CompositionSequence, revision: CompositionRevision): void {
  library.revisions[revision.id] = revision;
  if (!library.revisionOrder.includes(revision.id)) library.revisionOrder.push(revision.id);
}

export function spatialSpecsCompatible(
  left: ImageSpatialSpec,
  right: ImageSpatialSpec,
): { compatible: boolean; issues: string[] } {
  const issues: string[] = [];
  if (left.projectionMode !== right.projectionMode) issues.push("projection profile differs");
  if (!projectionSurfacesCompatible(left.surface, right.surface)) issues.push("measured projection surface differs");
  if (left.targetWidth !== right.targetWidth || left.targetHeight !== right.targetHeight)
    issues.push("output size differs");
  if (Math.abs(left.rotationDegrees - right.rotationDegrees) > 0.001) issues.push("orientation differs");
  if (Math.abs(left.guideSplit - right.guideSplit) > 0.001) issues.push("guide split differs");
  if (Math.abs(left.horizonSplit - right.horizonSplit) > 0.001) issues.push("horizon differs");
  return { compatible: issues.length === 0, issues };
}

function revisionDependsOn(
  library: CompositionSequence,
  revision: CompositionRevision,
  ancestorRevisionId: string,
): boolean {
  const pending = revision.parents.map(({ revisionId }) => revisionId);
  const visited = new Set<string>();
  while (pending.length > 0) {
    const revisionId = pending.shift();
    if (!revisionId || visited.has(revisionId)) continue;
    if (revisionId === ancestorRevisionId) return true;
    visited.add(revisionId);
    const parent = library.revisions[revisionId];
    if (parent) pending.push(...parent.parents.map(({ revisionId: id }) => id));
  }
  return false;
}

function plateCompositionRenderFingerprint(snapshot: PlateCompositionSnapshot) {
  return {
    projectionMode: snapshot.projectionMode,
    surface: snapshot.surface,
    raster: snapshot.raster,
    guideSplit: snapshot.guideSplit,
    horizonSplit: snapshot.horizonSplit,
    frame: {
      plateFit: snapshot.frame.plateFit,
      plateFeather: snapshot.frame.plateFeather,
      plateLayers: snapshot.frame.plateLayers.map((layer) => ({
        source: layer.source.assetId
          ? {
              assetId: layer.source.assetId,
              width: layer.source.width,
              height: layer.source.height,
              aspect: layer.source.aspect,
            }
          : layer.source,
        placement: layer.placement,
        visible: layer.visible !== false,
      })),
    },
  };
}

function projectionSurfacesCompatible(left: ProjectionSurface, right: ProjectionSurface): boolean {
  if (left.kind !== right.kind) return false;
  if (left.kind === "angular" || right.kind === "angular") return left.kind === right.kind;
  if (left.kind === "box-room" && right.kind === "box-room") {
    return ["width", "depth", "height", "eyeHeight", "eyeX", "eyeZ"].every((key) =>
      nearlyEqual(left[key as keyof typeof left] as number, right[key as keyof typeof right] as number),
    );
  }
  if (left.kind === "double-gable-room" && right.kind === "double-gable-room") {
    const leftProfile = planarRoofProfile(left);
    const rightProfile = planarRoofProfile(right);
    return (
      nearlyEqual(left.length, right.length) &&
      nearlyEqual(left.width, right.width) &&
      leftProfile.length === rightProfile.length &&
      leftProfile.every(
        (anchor, index) =>
          nearlyEqual(anchor.position, rightProfile[index].position) &&
          nearlyEqual(anchor.height, rightProfile[index].height),
      )
    );
  }
  if (left.kind === "cylinder" && right.kind === "cylinder") {
    return (
      nearlyEqual(left.radius, right.radius) &&
      nearlyEqual(left.height, right.height) &&
      nearlyEqual(left.eyeHeight, right.eyeHeight)
    );
  }
  return false;
}

function nearlyEqual(left: number, right: number, epsilon = 0.000_001): boolean {
  return Math.abs(left - right) <= epsilon;
}
