import { activeWorkbenchRuntime, recordWorkbenchError, workbench } from "../artifacts/artifact-store.svelte.js";
import { getArtifactMediaHandle, setArtifactMediaHandle } from "../artifacts/artifact-media-handles.js";
import { toPortableArtifactMedia, toRuntimeArtifactMedia } from "../artifacts/artifact-runtime-media.js";
import type { ArtifactMediaHandle, ArtifactRecord, ArtifactSlotId } from "../artifacts/artifact-types.js";
import {
  ImageGenerationProvenanceV1Schema,
  ImageSpatialSpecSchema,
  defaultImageSpatialSpec,
  emptyPlateComposition,
  type Composition,
  type CompositionRevision,
  type CompositionRevisionMedia,
  type CompositionSourceAsset,
  type ImageGenerationProvenanceV1,
  type ImageSpatialSpec,
  type PlateCompositionSnapshot,
} from "../lib/shared/contracts/composition-sequence.js";
import { parseDomeScene } from "../lib/shared/contracts/dome-scene.js";
import { normalizeProjectionSurfaceForMode } from "../lib/shared/contracts/projection-authoring.js";
import {
  currentImageSpatialNormalizationConfig,
  imageSpatialNormalizationIsCurrent,
  normalizeImageRevisionMedia,
} from "../media/image-spatial-normalization.js";
import { assertExactImagePixelDimensions } from "../media/image-pixel-dimensions.js";
import { embedZenithProvenanceInRevisionMedia } from "../media/png-zenith-provenance.js";
import { loadPlateSketchSource, type PlateSketchImage } from "../plates/plate-sketch-sources.js";
import {
  addCompositionSourceAsset,
  assignCompositionSourceAsset,
  compositionSourceAssets,
  moveCompositionSourceAsset,
  removeCompositionSourceAsset,
  replaceCompositionSourceAssets,
} from "../sequence/composition-source-set.js";
import { compositionSourceMediaFromFile } from "../sequence/composition-source-media.js";
import { clearDomeScenePlateRuntimeImages } from "../scene/dome-scene-runtime.js";
import {
  addRevision,
  compositionById,
  createCompositionSequenceId,
  imageRevisionHistoryForComposition,
  plateCompositionsRenderEqual,
  plateCompositionSnapshot,
  plateSketchRevisionForComposition,
  presentationMediaForRevision,
  selectedImageRevisionForComposition,
} from "../sequence/composition-sequence.js";
import { projectionCarrierProfile } from "../geometry/projection-carrier-profile.js";
import {
  defaultSourceGuideCarrierHorizonRadius,
  normalizeSourceGuideCarrierHorizonRadius,
  normalizeSourceInnerGuideSplit,
} from "../geometry/source-guide-semantics.js";
import { repairPromptForProjectionSnapshot } from "../inpaint/inpaint-prompts.js";

const spatialSpecUpdateQueues = new Map<string, Promise<CompositionRevision | null>>();

export function selectedCompositionState(): Composition | null {
  return compositionById(workbench.project.sequence, workbench.project.workspace.selectedCompositionId);
}

export const selectedComposition = selectedCompositionState;

export function selectedCompositionSourceAssets(): CompositionSourceAsset[] {
  return compositionSourceAssets(workbench.project.sequence, selectedCompositionState());
}

type PlateSketchCaptureArtifact = Pick<ArtifactRecord, "media"> &
  Partial<Pick<ArtifactRecord, "operatorId" | "prompt" | "config">>;

export async function captureSelectedPlateSketch(source?: {
  artifact: PlateSketchCaptureArtifact;
  handle?: ArtifactMediaHandle;
}): Promise<CompositionRevision | null> {
  const composition = requireSelectedComposition();
  if (!composition) return null;
  const artifact = source?.artifact || workbench.project.artifacts["plate-sketch"];
  const media = source
    ? await portableRevisionMediaFrom(artifact.media, source.handle)
    : await portableRevisionMedia("plate-sketch");
  if (!media) return null;
  const createdAt = new Date().toISOString();
  const snapshot = plateCompositionSnapshot(workbench.project.scene);
  const revision: CompositionRevision = {
    id: createCompositionSequenceId("revision-plate-sketch"),
    kind: "plate-sketch",
    label: artifact.media.name || `${composition.label} Plate Sketch`,
    createdAt,
    media,
    normalizedMedia: media,
    parents: composition.plateSketchRevisionId
      ? [{ revisionId: composition.plateSketchRevisionId, role: "variation-source" }]
      : [],
    ...(artifact.operatorId ? { operatorId: artifact.operatorId } : {}),
    ...(artifact.prompt ? { prompt: artifact.prompt } : {}),
    ...(artifact.config ? { config: jsonClone(artifact.config) } : {}),
    projectionProfile: snapshot.projectionMode,
    spatialSpec: spatialSpecFromPlateSnapshot(snapshot),
    plateComposition: snapshot,
  };
  addRevision(workbench.project.sequence, revision);
  composition.plateSketchRevisionId = revision.id;
  composition.plateDraft = jsonClone(snapshot);
  composition.status = composition.imageRevisionId ? "stale" : "draft";
  composition.updatedAt = createdAt;
  if (composition.imageRevisionId) markAdapterStale("finished-image");
  touchLibrary();
  return revision;
}

export async function captureSelectedFinishedImage({
  artifactId = "finished-image",
  kind = "reference-image",
}: {
  artifactId?: "finished-image";
  kind?: "clean-image" | "reference-image";
} = {}): Promise<CompositionRevision | null> {
  const composition = requireSelectedComposition();
  if (!composition) return null;
  const media = await portableRevisionMedia(artifactId);
  if (!media) return null;
  const artifact = workbench.project.artifacts[artifactId];
  const createdAt = new Date().toISOString();
  const initialSpatialSpec = artifact.provenance
    ? jsonClone(artifact.provenance.spatialSpec)
    : defaultImageSpatialSpec({
        projectionMode: artifact.projectionProfile,
        surface: normalizeProjectionSurfaceForMode(composition.plateDraft.surface, artifact.projectionProfile),
        guideSplit: composition.plateDraft.guideSplit,
        horizonSplit: composition.plateDraft.horizonSplit,
        targetWidth: composition.plateDraft.raster.width,
        targetHeight: composition.plateDraft.raster.height,
      });
  const normalized = await normalizeImageRevisionMedia(media, initialSpatialSpec);
  const revision: CompositionRevision = {
    id: createCompositionSequenceId("revision-composition-image"),
    kind,
    label: artifact.media.name || `${composition.label} Image`,
    createdAt,
    media,
    normalizedMedia: normalized.media,
    parents: composition.plateSketchRevisionId
      ? [{ revisionId: composition.plateSketchRevisionId, role: "plate-sketch" }]
      : [],
    ...(artifact.operatorId ? { operatorId: artifact.operatorId } : {}),
    ...(artifact.prompt ? { prompt: artifact.prompt } : {}),
    config: currentImageSpatialNormalizationConfig(artifact.config ? jsonClone(artifact.config) : undefined),
    projectionProfile: normalized.spatialSpec.projectionMode,
    spatialSpec: normalized.spatialSpec,
  };
  addRevision(workbench.project.sequence, revision);
  composition.imageRevisionId = revision.id;
  composition.status = "ready";
  composition.updatedAt = createdAt;
  setAdapterArtifact("finished-image", revision);
  touchLibrary({ render: true });
  return revision;
}

export async function captureFinishedImage({
  media,
  provenance,
  label,
  prompt,
}: {
  media: ArtifactRecord["media"];
  provenance: ImageGenerationProvenanceV1;
  label: string;
  prompt: string;
}): Promise<CompositionRevision> {
  const pinned = ImageGenerationProvenanceV1Schema.parse(provenance);
  const library = workbench.project.sequence;
  const composition = compositionById(library, pinned.compositionId);
  if (!composition) throw new Error("The Composition that requested this image no longer exists.");
  if (composition.plateSketchRevisionId !== pinned.sourceRevisionId) {
    throw new Error("The Composition Plate Sketch changed while the image was generating.");
  }
  const plateRevision = library.revisions[pinned.sourceRevisionId];
  if (!plateRevision?.plateComposition) throw new Error("The pinned Plate Sketch is no longer available.");

  const portable = await toPortableArtifactMedia(media, undefined, { preferLiveHandle: false });
  if (portable.kind !== "image" || !portable.url) throw new Error("The generated result has no portable image.");
  const portableImage: CompositionRevisionMedia = {
    kind: "image",
    url: portable.url,
    ...(portable.name ? { name: portable.name } : {}),
    ...(portable.mime ? { mime: portable.mime } : {}),
    ...(portable.alt ? { alt: portable.alt } : {}),
  };
  const dimensions = await assertExactImagePixelDimensions(portableImage.url, pinned.carrierRaster, "Generated result");
  const sourceWidth = dimensions?.width ?? pinned.carrierRaster.width;
  const sourceHeight = dimensions?.height ?? pinned.carrierRaster.height;
  const finalProvenance = ImageGenerationProvenanceV1Schema.parse({
    ...pinned,
    spatialSpec: { ...pinned.spatialSpec, sourceWidth, sourceHeight, sourceAspectRatio: sourceWidth / sourceHeight },
  });
  const sourceMedia = embedZenithProvenanceInRevisionMedia(portableImage, finalProvenance);
  const createdAt = new Date().toISOString();
  const revision: CompositionRevision = {
    id: createCompositionSequenceId("revision-composition-image"),
    kind: "clean-image",
    label,
    createdAt,
    media: sourceMedia,
    normalizedMedia: sourceMedia,
    parents: [{ revisionId: pinned.sourceRevisionId, role: "plate-sketch" }],
    operatorId: pinned.operatorId,
    prompt,
    config: currentImageSpatialNormalizationConfig(),
    provenance: finalProvenance,
    projectionProfile: finalProvenance.spatialSpec.projectionMode,
    spatialSpec: finalProvenance.spatialSpec,
  };
  addRevision(library, revision);
  composition.imageRevisionId = revision.id;
  composition.status = "ready";
  composition.updatedAt = createdAt;
  if (selectedCompositionState()?.id === composition.id) setAdapterArtifact("finished-image", revision);
  touchLibrary({ render: true });
  return revision;
}

export function createCompositionState({
  duplicateSelected = true,
}: { duplicateSelected?: boolean } = {}): Composition {
  const library = workbench.project.sequence;
  const source = selectedCompositionState();
  const createdAt = new Date().toISOString();
  const number = library.compositions.length + 1;
  const composition: Composition = {
    id: createCompositionSequenceId("composition"),
    label: `Composition ${String(number).padStart(2, "0")}`,
    sourceAssetIds: duplicateSelected ? [...(source?.sourceAssetIds || [])] : [],
    plateSketchRevisionId: duplicateSelected ? source?.plateSketchRevisionId || null : null,
    imageRevisionId: duplicateSelected ? source?.imageRevisionId || null : null,
    plateDraft:
      duplicateSelected && source
        ? jsonClone(source.plateDraft)
        : emptyPlateComposition({
            projectionMode: workbench.project.scene.projectionMode,
            surface: workbench.project.scene.surface,
            raster: workbench.project.scene.raster,
            guideSplit: workbench.project.scene.guideSplit,
            horizonSplit: workbench.project.scene.horizonSplit,
          }),
    status: duplicateSelected ? source?.status || "draft" : "draft",
    notes: duplicateSelected && source ? `Derived from ${source.label}.` : "",
    createdAt,
    updatedAt: createdAt,
  };
  if (duplicateSelected && source) remapForkedPlateLayerIds(composition);
  library.compositions.push(composition);
  selectComposition(composition.id);
  return composition;
}

export function deleteCompositionState(compositionId: string): void {
  const library = workbench.project.sequence;
  if (library.compositions.length <= 1) {
    recordWorkbenchError("A Zenith project must keep at least one Composition.", "composition-library");
    return;
  }
  const index = library.compositions.findIndex((composition) => composition.id === compositionId);
  if (index < 0) return;
  library.compositions.splice(index, 1);
  selectComposition(library.compositions[Math.min(index, library.compositions.length - 1)].id);
}

export function updateCompositionState(
  compositionId: string,
  patch: Partial<Pick<Composition, "label" | "notes">>,
): void {
  const composition = compositionById(workbench.project.sequence, compositionId);
  if (!composition) return;
  if (patch.label?.trim()) composition.label = patch.label.trim();
  if (patch.notes !== undefined) composition.notes = patch.notes;
  composition.updatedAt = new Date().toISOString();
  touchLibrary();
}

export function selectCompositionState(compositionId: string): void {
  selectComposition(compositionId);
}

export async function importSelectedCompositionSourceFiles(
  files: File[],
  { replace = false }: { replace?: boolean } = {},
): Promise<CompositionSourceAsset[]> {
  const composition = requireSelectedComposition();
  if (!composition) return [];
  const imageFiles = files.filter((file) => file.type.startsWith("image/"));
  if (imageFiles.length === 0) throw new Error("Choose at least one image source.");
  const assets: CompositionSourceAsset[] = [];
  for (const file of imageFiles) {
    const runtime = compositionSourceMediaFromFile(file);
    const plate = await loadPlateSketchSource(file.name, file);
    const asset = compositionSourceAssetFromPlate(plate, runtime.media);
    addCompositionSourceAsset(workbench.project.sequence, asset);
    activeWorkbenchRuntime.compositionSourceMedia.set(asset.id, runtime.handle);
    assets.push(asset);
  }
  applySourceAssignments(
    composition,
    assets.map((asset) => asset.id),
    { replace },
  );
  return assets;
}

export async function assignSelectedCompositionSourceReferences(
  references: Array<{ name: string; url: string }>,
  { replace = false }: { replace?: boolean } = {},
): Promise<CompositionSourceAsset[]> {
  const composition = requireSelectedComposition();
  if (!composition) return [];
  const assets: CompositionSourceAsset[] = [];
  for (const reference of references) {
    const existing = Object.values(workbench.project.sequence.sourceAssets).find(
      (asset) => asset.media.url === reference.url,
    );
    if (existing) {
      assets.push(existing);
      continue;
    }
    const response = await fetch(reference.url);
    if (!response.ok) continue;
    const plate = await loadPlateSketchSource(reference.name, await response.blob());
    const asset = compositionSourceAssetFromPlate(plate, {
      kind: "image",
      url: reference.url,
      name: reference.name,
      alt: reference.name,
    });
    addCompositionSourceAsset(workbench.project.sequence, asset);
    assets.push(asset);
  }
  if (assets.length === 0) throw new Error("None of the requested Plate sources could be loaded.");
  applySourceAssignments(
    composition,
    assets.map((asset) => asset.id),
    { replace },
  );
  return assets;
}

export function assignExistingSelectedCompositionSourceAsset(assetId: string): boolean {
  const composition = requireSelectedComposition();
  if (!composition) return false;
  const changed = assignCompositionSourceAsset(workbench.project.sequence, composition, assetId);
  if (changed) finishCompositionSourceChange(composition);
  return changed;
}

export function removeSelectedCompositionSourceAsset(assetId: string): boolean {
  const composition = requireSelectedComposition();
  if (!composition) return false;
  const changed = removeCompositionSourceAsset(composition, assetId);
  if (changed) finishCompositionSourceChange(composition);
  return changed;
}

export function moveSelectedCompositionSourceAsset(assetId: string, direction: -1 | 1): boolean {
  const composition = requireSelectedComposition();
  if (!composition) return false;
  const changed = moveCompositionSourceAsset(composition, assetId, direction);
  if (changed) finishCompositionSourceChange(composition);
  return changed;
}

export function updateSelectedCompositionPlateDraft(snapshot: PlateCompositionSnapshot): void {
  const composition = selectedCompositionState();
  if (!composition || JSON.stringify(composition.plateDraft) === JSON.stringify(snapshot)) return;
  const renderChanged = !plateCompositionsRenderEqual(composition.plateDraft, snapshot);
  composition.plateDraft = jsonClone(snapshot);
  const assignedAssetIds = snapshot.frame.plateLayers.flatMap((layer) =>
    layer.source.assetId && workbench.project.sequence.sourceAssets[layer.source.assetId] ? [layer.source.assetId] : [],
  );
  if (assignedAssetIds.length === snapshot.frame.plateLayers.length)
    composition.sourceAssetIds = [...new Set(assignedAssetIds)];
  if (renderChanged) markCompositionDraftChanged(composition);
  touchLibrary();
}

export function updateSelectedImageSpatialSpec(patch: Partial<ImageSpatialSpec>): Promise<CompositionRevision | null> {
  const selected = requireSelectedComposition();
  if (!selected) return Promise.resolve(null);
  return queueImageSpatialSpecUpdate(selected.id, patch, false);
}

export function ensureSelectedImageSpatialNormalization(): Promise<CompositionRevision | null> {
  const selected = requireSelectedComposition();
  if (!selected) return Promise.resolve(null);
  const revision = selectedImageRevisionForComposition(workbench.project.sequence, selected);
  if (!revision) return Promise.resolve(null);
  if (projectionCarrierProfile(revision.spatialSpec.projectionMode).topology !== "gabled-shell")
    return Promise.resolve(revision);
  if (imageSpatialNormalizationIsCurrent(revision)) return Promise.resolve(revision);
  return queueImageSpatialSpecUpdate(selected.id, {}, true);
}

export function selectSelectedCompositionImageRevision(revisionId: string): boolean {
  const library = workbench.project.sequence;
  const composition = selectedCompositionState();
  if (!composition || composition.imageRevisionId === revisionId) return Boolean(composition);
  const revision = imageRevisionHistoryForComposition(library, composition).find(
    (candidate) => candidate.id === revisionId,
  );
  if (!revision) return false;
  composition.imageRevisionId = revision.id;
  composition.status = imageRevisionMatchesPlate(library, composition, revision) ? "ready" : "stale";
  composition.updatedAt = new Date().toISOString();
  setAdapterArtifact("finished-image", revision);
  touchLibrary({ render: true });
  return true;
}

function selectComposition(compositionId: string): void {
  const composition = compositionById(workbench.project.sequence, compositionId);
  if (!composition) return;
  workbench.project.workspace.selectedCompositionId = composition.id;
  loadCompositionIntoWorkspace(composition);
  touchLibrary({ render: true });
}

function loadCompositionIntoWorkspace(composition: Composition): void {
  clearDomeScenePlateRuntimeImages();
  const plateRevision = plateSketchRevisionForComposition(workbench.project.sequence, composition);
  const imageRevision = selectedImageRevisionForComposition(workbench.project.sequence, composition);
  setAdapterArtifact("plate-sketch", plateRevision);
  setAdapterArtifact("finished-image", imageRevision);
  workbench.project.artifacts["plate-sketch"].stale = composition.status === "stale";
  workbench.project.artifacts["finished-image"].stale = composition.status === "stale" && Boolean(imageRevision);
  const draft = composition.plateDraft;
  workbench.project.generation.prompt = repairPromptForProjectionSnapshot(workbench.project.generation.prompt, draft);
  workbench.project.scene = parseDomeScene({
    ...jsonClone(workbench.project.scene),
    projectionMode: draft.projectionMode,
    surface: jsonClone(draft.surface),
    raster: jsonClone(draft.raster),
    guideSplit: draft.guideSplit,
    horizonSplit: draft.horizonSplit,
    frame0: jsonClone(draft.frame),
  });
}

function queueImageSpatialSpecUpdate(
  compositionId: string,
  patch: Partial<ImageSpatialSpec>,
  forceNormalization: boolean,
): Promise<CompositionRevision | null> {
  const previous = spatialSpecUpdateQueues.get(compositionId) ?? Promise.resolve(null);
  const queued: Promise<CompositionRevision | null> = previous
    .catch((): null => null)
    .then(() => applyImageSpatialSpecUpdate(compositionId, patch, forceNormalization));
  spatialSpecUpdateQueues.set(compositionId, queued);
  return queued.finally(() => {
    if (spatialSpecUpdateQueues.get(compositionId) === queued) spatialSpecUpdateQueues.delete(compositionId);
  });
}

async function applyImageSpatialSpecUpdate(
  compositionId: string,
  patch: Partial<ImageSpatialSpec>,
  forceNormalization: boolean,
): Promise<CompositionRevision | null> {
  const library = workbench.project.sequence;
  const composition = compositionById(library, compositionId);
  const source = selectedImageRevisionForComposition(library, composition);
  if (!composition || !source) return null;
  const projectionMode = patch.projectionMode ?? source.spatialSpec.projectionMode;
  const sameTopology =
    projectionCarrierProfile(source.spatialSpec.projectionMode).topology ===
    projectionCarrierProfile(projectionMode).topology;
  const guideSplit = normalizeSourceInnerGuideSplit(
    patch.guideSplit ?? (sameTopology ? source.spatialSpec.guideSplit : undefined),
    projectionMode,
  );
  const horizonSplit = normalizeSourceGuideCarrierHorizonRadius(
    projectionMode,
    guideSplit,
    patch.horizonSplit ??
      (sameTopology
        ? source.spatialSpec.horizonSplit
        : defaultSourceGuideCarrierHorizonRadius(projectionMode, guideSplit)),
  );
  const parsed = ImageSpatialSpecSchema.safeParse({
    ...source.spatialSpec,
    ...patch,
    projectionMode,
    surface: normalizeProjectionSurfaceForMode(
      patch.surface ?? (sameTopology ? source.spatialSpec.surface : undefined),
      projectionMode,
    ),
    guideSplit,
    horizonSplit,
  });
  if (!parsed.success) return null;
  if (!forceNormalization && JSON.stringify(parsed.data) === JSON.stringify(source.spatialSpec)) return source;
  const normalized = await normalizeImageRevisionMedia(source.media, parsed.data);
  if (composition.imageRevisionId !== source.id) return null;
  const createdAt = new Date().toISOString();
  const revision: CompositionRevision = {
    ...jsonClone(source),
    id: createCompositionSequenceId("revision-spatial-fit"),
    label: `${source.label} · spatial fit`,
    createdAt,
    parents: [{ revisionId: source.id, role: "variation-source" }],
    config: currentImageSpatialNormalizationConfig(source.config ? jsonClone(source.config) : undefined),
    projectionProfile: normalized.spatialSpec.projectionMode,
    spatialSpec: normalized.spatialSpec,
    normalizedMedia: normalized.media,
  };
  addRevision(library, revision);
  composition.imageRevisionId = revision.id;
  composition.updatedAt = createdAt;
  if (selectedCompositionState()?.id === composition.id) setAdapterArtifact("finished-image", revision);
  touchLibrary({ render: true });
  return revision;
}

function setAdapterArtifact(artifactId: ArtifactSlotId, revision: CompositionRevision | null | undefined): void {
  const artifact = workbench.project.artifacts[artifactId];
  if (!revision) {
    artifact.media = { kind: "none", blob: null, file: null, canvas: null };
    artifact.status = "missing";
    artifact.stale = false;
    artifact.provenance = undefined;
    setArtifactMediaHandle(artifactId, { blob: null, file: null, canvas: null });
    return;
  }
  artifact.media = toRuntimeArtifactMedia(presentationMediaForRevision(revision));
  artifact.status = "ready";
  artifact.stale = false;
  artifact.operatorId = revision.operatorId;
  artifact.prompt = revision.prompt;
  artifact.config = revision.config as ArtifactRecord["config"];
  artifact.projectionProfile = revision.projectionProfile;
  artifact.provenance = revision.provenance;
  artifact.updatedAt = revision.createdAt;
  setArtifactMediaHandle(artifactId, { blob: null, file: null, canvas: null });
}

async function portableRevisionMedia(artifactId: ArtifactSlotId): Promise<CompositionRevisionMedia | null> {
  const artifact = workbench.project.artifacts[artifactId];
  return portableRevisionMediaFrom(artifact.media, getArtifactMediaHandle(artifactId));
}

async function portableRevisionMediaFrom(
  artifactMedia: ArtifactRecord["media"],
  handle?: ArtifactMediaHandle,
): Promise<CompositionRevisionMedia | null> {
  const media = await toPortableArtifactMedia(artifactMedia, handle, {
    preferLiveHandle: true,
  });
  if (media.kind !== "image" || !media.url) return null;
  return {
    kind: "image",
    url: media.url,
    ...(media.name ? { name: media.name } : {}),
    ...(media.mime ? { mime: media.mime } : {}),
    ...(media.alt ? { alt: media.alt } : {}),
  };
}

function requireSelectedComposition(): Composition | null {
  const composition = selectedCompositionState();
  if (!composition) recordWorkbenchError("Select a Composition first.", "composition-library");
  return composition;
}

function spatialSpecFromPlateSnapshot(snapshot: PlateCompositionSnapshot): ImageSpatialSpec {
  return defaultImageSpatialSpec({
    projectionMode: snapshot.projectionMode,
    surface: snapshot.surface,
    guideSplit: snapshot.guideSplit,
    horizonSplit: snapshot.horizonSplit,
    targetWidth: snapshot.raster.width,
    targetHeight: snapshot.raster.height,
  });
}

function compositionSourceAssetFromPlate(
  plate: PlateSketchImage,
  media: CompositionSourceAsset["media"],
): CompositionSourceAsset {
  return {
    id: createCompositionSequenceId("composition-source"),
    label: plate.name,
    media,
    width: Math.max(1, Math.round(plate.width)),
    height: Math.max(1, Math.round(plate.height)),
    aspect: plate.aspect || plate.width / Math.max(plate.height, 1),
    createdAt: new Date().toISOString(),
  };
}

function applySourceAssignments(composition: Composition, assetIds: string[], { replace }: { replace: boolean }): void {
  if (replace) replaceCompositionSourceAssets(workbench.project.sequence, composition, assetIds);
  else for (const assetId of assetIds) assignCompositionSourceAsset(workbench.project.sequence, composition, assetId);
  finishCompositionSourceChange(composition);
}

function finishCompositionSourceChange(composition: Composition): void {
  markCompositionDraftChanged(composition);
  if (selectedCompositionState()?.id === composition.id) loadCompositionIntoWorkspace(composition);
  touchLibrary({ render: true });
}

function markCompositionDraftChanged(composition: Composition): void {
  composition.status = composition.plateSketchRevisionId || composition.imageRevisionId ? "stale" : "draft";
  composition.updatedAt = new Date().toISOString();
  if (selectedCompositionState()?.id === composition.id) {
    if (composition.plateSketchRevisionId) markAdapterStale("plate-sketch");
    if (composition.imageRevisionId) markAdapterStale("finished-image");
  }
}

function markAdapterStale(artifactId: ArtifactSlotId): void {
  const artifact = workbench.project.artifacts[artifactId];
  if (artifact.media.kind === "none") return;
  artifact.stale = true;
  artifact.status = "stale";
}

function imageRevisionMatchesPlate(
  library: typeof workbench.project.sequence,
  composition: Composition,
  revision: CompositionRevision,
): boolean {
  const plateId = composition.plateSketchRevisionId;
  if (!plateId) return false;
  const pending = revision.parents.map((parent) => parent.revisionId);
  const visited = new Set<string>();
  while (pending.length) {
    const revisionId = pending.shift();
    if (!revisionId || visited.has(revisionId)) continue;
    if (revisionId === plateId) return true;
    visited.add(revisionId);
    const parent = library.revisions[revisionId];
    if (parent) pending.push(...parent.parents.map((item) => item.revisionId));
  }
  return false;
}

function remapForkedPlateLayerIds(composition: Composition): void {
  const activeLayerId = composition.plateDraft.frame.activeLayerId;
  let nextActiveLayerId: string | null = null;
  composition.plateDraft.frame.plateLayers = composition.plateDraft.frame.plateLayers.map((layer, index) => {
    const nextId = `plate-layer:${composition.id}:${layer.source.assetId || index + 1}`;
    if (layer.id === activeLayerId) nextActiveLayerId = nextId;
    return { ...layer, id: nextId, index };
  });
  composition.plateDraft.frame.activeLayerId =
    nextActiveLayerId || composition.plateDraft.frame.plateLayers[0]?.id || null;
}

function touchLibrary({ render = false }: { render?: boolean } = {}): void {
  activeWorkbenchRuntime.touch({ render });
}

function jsonClone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}
