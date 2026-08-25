import {
  activeWorkbenchRuntime,
  clearMediaPreview,
  replaceArtifacts,
  workbench,
} from "../artifacts/artifact-store.svelte.js";
import {
  clearArtifactResultMediaHandles,
  getArtifactMediaHandle,
  getArtifactResultMediaHandle,
  getMediaPreviewHandle,
  setArtifactMediaHandle,
  setArtifactResultMediaHandle,
  setMediaPreviewHandle,
} from "../artifacts/artifact-media-handles.js";
import {
  toPortableArtifactMedia,
  toRuntimeArtifactMedia,
  type PortableMediaStore,
} from "../artifacts/artifact-runtime-media.js";
import { clearDomeScenePlateRuntimeImages, resolveDomeScenePlateImage } from "../scene/dome-scene-runtime.js";
import { parseDomeScene, type DomeScene } from "../scene/dome-scene.js";
import type { ArtifactRecord, ArtifactResult, ArtifactSlotId, ArtifactPhaseId } from "../artifacts/artifact-types.js";
import { canvasToBlob, downloadBlob } from "../media/canvas-utils.js";
import {
  parseProjectSnapshot,
  PROJECT_ARTIFACT_SLOT_IDS,
  PROJECT_SNAPSHOT_VERSION,
  ProjectSnapshotParseError,
  type ProjectArtifactMedia,
  type ProjectArtifactRecord,
  type ProjectArtifactResult,
  type ProjectSnapshot,
} from "../lib/shared/contracts/projects.js";
import {
  createProjectArchive,
  createProjectArchiveMediaStore,
  projectArchiveMediaId,
  readProjectArchiveBlob,
  type ProjectArchiveContents,
} from "./project-archive.js";
import { serializableCompositionSequence } from "../sequence/composition-source-media.js";

type ProjectArchiveRuntimeMedia = {
  blobsByObjectUrl: ReadonlyMap<string, Blob>;
  objectUrls: ReadonlySet<string>;
};

let activeProjectArchiveObjectUrls = new Set<string>();

export async function importProjectSnapshotFile(file: File): Promise<void> {
  const archive = await readProjectArchiveBlob(file);
  if (archive) {
    const portableSnapshot = parseProjectSnapshot(archive.snapshot);
    const { snapshot, runtimeMedia } = materializeProjectArchive(portableSnapshot, archive);
    try {
      applyProjectSnapshot(snapshot, runtimeMedia);
    } catch (error) {
      revokeObjectUrls(runtimeMedia.objectUrls);
      throw error;
    }
    return;
  }
  restoreProjectSnapshotText(await file.text());
}

export async function downloadProjectSnapshot(): Promise<void> {
  const mediaStore = createProjectArchiveMediaStore();
  const snapshot = await createProjectSnapshot({ storeBlob: mediaStore.add });
  const blob = await createProjectArchive(snapshot, { attachments: mediaStore.attachments() });
  downloadBlob(blob, `zenith-project-${Date.now()}.zenith`);
}

export async function createProjectSnapshot({
  createdAt = new Date().toISOString(),
  storeBlob,
}: { createdAt?: string; storeBlob?: PortableMediaStore } = {}): Promise<ProjectSnapshot> {
  const artifacts = {} as ProjectSnapshot["project"]["artifacts"];
  for (const id of PROJECT_ARTIFACT_SLOT_IDS) {
    artifacts[id] = await serializeArtifactRecord(workbench.project.artifacts[id], storeBlob);
  }
  const sequence = await serializableCompositionSequence(
    workbench.project.sequence,
    activeWorkbenchRuntime.compositionSourceMedia,
    { storeBlob },
  );
  return parseProjectSnapshot({
    version: PROJECT_SNAPSHOT_VERSION,
    createdAt,
    project: {
      scene: await serializableDomeScene(workbench.project.scene, storeBlob, sourceMediaUrls(sequence)),
      sequence,
      workspace: {
        modeId: workbench.project.workspace.modeId,
        selectedArtifactId: workbench.project.workspace.selectedArtifactId,
        viewerMode: workbench.project.workspace.viewerMode,
        selectedCompositionId: workbench.project.workspace.selectedCompositionId,
        mediaPreview: {
          ...workbench.project.workspace.mediaPreview,
          media: await toPortableArtifactMedia(
            workbench.project.workspace.mediaPreview.media,
            getMediaPreviewHandle(),
            { preferLiveHandle: true, storeBlob },
          ),
        },
      },
      artifacts,
      generation: structuredClone(workbench.project.generation),
    },
  });
}

export function parseProjectSnapshotText(text: string): ProjectSnapshot {
  try {
    return parseProjectSnapshot(JSON.parse(text) as unknown);
  } catch (error) {
    if (error instanceof SyntaxError) throw new ProjectSnapshotParseError("Project snapshot contains invalid JSON.");
    throw error;
  }
}

export function restoreProjectSnapshotText(text: string): void {
  applyProjectSnapshot(parseProjectSnapshotText(text));
}

export function restoreProjectSnapshot(snapshot: unknown): void {
  applyProjectSnapshot(parseProjectSnapshot(snapshot));
}

function applyProjectSnapshot(snapshot: ProjectSnapshot, archiveMedia?: ProjectArchiveRuntimeMedia): void {
  const project = snapshot.project;
  const restored = {} as Record<ArtifactSlotId, ArtifactRecord>;
  for (const id of PROJECT_ARTIFACT_SLOT_IDS) restored[id] = toRuntimeArtifactRecord(project.artifacts[id]);

  for (const id of PROJECT_ARTIFACT_SLOT_IDS) setArtifactMediaHandle(id, { blob: null, file: null, canvas: null });
  clearArtifactResultMediaHandles();
  clearMediaPreview();
  clearDomeScenePlateRuntimeImages();
  activeWorkbenchRuntime.compositionSourceMedia.clear();
  revokeObjectUrls(activeProjectArchiveObjectUrls);
  activeProjectArchiveObjectUrls = new Set(archiveMedia?.objectUrls || []);
  replaceArtifacts(restored);
  workbench.project.scene = parseDomeScene(structuredClone(project.scene));
  workbench.project.sequence = structuredClone(project.sequence);
  workbench.project.generation = structuredClone(project.generation);
  workbench.project.workspace = {
    ...structuredClone(project.workspace),
    mediaPreview: {
      ...project.workspace.mediaPreview,
      media: toRuntimeArtifactMedia(project.workspace.mediaPreview.media),
    },
  };
  installArchiveMediaHandles(project, archiveMedia);
  activeWorkbenchRuntime.touch({ render: true });
}

function materializeProjectArchive(
  snapshot: ProjectSnapshot,
  archive: ProjectArchiveContents,
): { snapshot: ProjectSnapshot; runtimeMedia: ProjectArchiveRuntimeMedia } {
  const objectUrlById = new Map<string, string>();
  const blobsByObjectUrl = new Map<string, Blob>();
  const runtimeSnapshot = hydrateArchiveValue(snapshot, (portableUrl) => {
    const id = projectArchiveMediaId(portableUrl);
    if (!id) return portableUrl;
    const blob = archive.media.get(id);
    if (!blob) throw new Error(`Zenith project archive is missing media ${id}.`);
    const existing = objectUrlById.get(id);
    if (existing) return existing;
    const objectUrl = URL.createObjectURL(blob);
    objectUrlById.set(id, objectUrl);
    blobsByObjectUrl.set(objectUrl, blob);
    return objectUrl;
  });
  return {
    snapshot: runtimeSnapshot,
    runtimeMedia: { blobsByObjectUrl, objectUrls: new Set(objectUrlById.values()) },
  };
}

function installArchiveMediaHandles(
  project: ProjectSnapshot["project"],
  archiveMedia: ProjectArchiveRuntimeMedia | undefined,
): void {
  const blobFor = (media: ProjectArtifactMedia): Blob | null =>
    media.url ? archiveMedia?.blobsByObjectUrl.get(media.url) || null : null;
  for (const id of PROJECT_ARTIFACT_SLOT_IDS) {
    const artifact = project.artifacts[id];
    setArtifactMediaHandle(id, { blob: blobFor(artifact.media), file: null, canvas: null });
    for (const result of artifact.results) {
      setArtifactResultMediaHandle(id, result.id, { blob: blobFor(result.media), file: null, canvas: null });
    }
  }
  setMediaPreviewHandle({ blob: blobFor(project.workspace.mediaPreview.media), file: null, canvas: null });
  for (const asset of Object.values(project.sequence.sourceAssets)) {
    const objectUrl = asset.media.url;
    const blob = archiveMedia?.blobsByObjectUrl.get(objectUrl) || null;
    if (blob) activeWorkbenchRuntime.compositionSourceMedia.set(asset.id, { blob, file: null, objectUrl });
  }
}

export async function serializableDomeScene(
  scene: DomeScene,
  storeBlob?: PortableMediaStore,
  sourceUrlByAssetId: ReadonlyMap<string, { url: string; mime?: string }> = new Map(),
): Promise<DomeScene> {
  // Svelte deep-state objects are proxies and cannot cross structuredClone.
  // DomeScene is a JSON-only contract; clone through JSON before resolving its
  // runtime plate URLs, then validate the completed portable value below.
  const next = JSON.parse(JSON.stringify(scene)) as DomeScene;
  await Promise.all(
    next.frame0.plateLayers.map(async (layer) => {
      const sourceAsset = layer.source.assetId ? sourceUrlByAssetId.get(layer.source.assetId) : null;
      if (sourceAsset) {
        layer.source.url = sourceAsset.url;
        layer.source.mime = sourceAsset.mime;
        return;
      }
      if (layer.source.url && !layer.source.url.startsWith("blob:")) return;
      const image = await resolveDomeScenePlateImage(layer);
      if (!image?.canvas) return;
      layer.source.url = storeBlob
        ? storeBlob(await canvasToBlob(image.canvas, "image/png"), "image/png")
        : image.canvas.toDataURL("image/png");
      layer.source.mime = "image/png";
    }),
  );
  return parseDomeScene(next);
}

async function serializeArtifactRecord(
  artifact: ArtifactRecord,
  storeBlob?: PortableMediaStore,
): Promise<ProjectArtifactRecord> {
  const results = await Promise.all(
    artifact.results.map(async (result) =>
      compactOptional({
        id: result.id,
        label: result.label,
        createdAt: result.createdAt,
        media: await toPortableArtifactMedia(result.media, getArtifactResultMediaHandle(artifact.id, result.id), {
          preferLiveHandle: true,
          storeBlob,
        }),
        prompt: result.prompt,
        config: result.config ? structuredClone(result.config) : undefined,
        provenance: result.provenance ? structuredClone(result.provenance) : undefined,
        operatorId: result.operatorId,
        selected: result.selected,
      }),
    ),
  );
  return compactOptional({
    id: artifact.id,
    type: artifact.type,
    phase: artifact.phase,
    label: artifact.label,
    summary: artifact.summary,
    status: artifact.status,
    inputs: [...artifact.inputs],
    operatorId: artifact.operatorId,
    projectionProfile: artifact.projectionProfile,
    provenance: artifact.provenance ? structuredClone(artifact.provenance) : undefined,
    prompt: artifact.prompt,
    config: artifact.config ? structuredClone(artifact.config) : undefined,
    media: await toPortableArtifactMedia(artifact.media, getArtifactMediaHandle(artifact.id), {
      preferLiveHandle: true,
      storeBlob,
    }),
    results,
    createdAt: artifact.createdAt,
    updatedAt: artifact.updatedAt,
    warnings: [...artifact.warnings],
    qcNotes: [...artifact.qcNotes],
    stale: artifact.stale,
  });
}

function sourceMediaUrls(
  sequence: ProjectSnapshot["project"]["sequence"],
): Map<string, { url: string; mime?: string }> {
  return new Map(
    Object.values(sequence.sourceAssets).map((asset) => [
      asset.id,
      { url: asset.media.url, ...(asset.media.mime ? { mime: asset.media.mime } : {}) },
    ]),
  );
}

function toRuntimeArtifactRecord(artifact: ProjectArtifactRecord): ArtifactRecord {
  return {
    ...artifact,
    id: artifact.id as ArtifactSlotId,
    type: artifact.type as ArtifactSlotId,
    phase: artifact.phase as ArtifactPhaseId,
    inputs: artifact.inputs as ArtifactSlotId[],
    config: artifact.config,
    media: toRuntimeArtifactMedia(artifact.media),
    results: artifact.results.map(toRuntimeArtifactResult),
    warnings: [...artifact.warnings],
    qcNotes: [...artifact.qcNotes],
  };
}

function toRuntimeArtifactResult(result: ProjectArtifactResult): ArtifactResult {
  return { ...result, media: toRuntimeArtifactMedia(result.media), config: result.config };
}

function hydrateArchiveValue<T>(value: T, hydrateUrl: (url: string) => string): T {
  if (typeof value === "string") return hydrateUrl(value) as T;
  if (Array.isArray(value)) return value.map((item) => hydrateArchiveValue(item, hydrateUrl)) as T;
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [key, hydrateArchiveValue(item, hydrateUrl)]),
  ) as T;
}

function revokeObjectUrls(urls: Iterable<string>): void {
  if (typeof URL === "undefined" || typeof URL.revokeObjectURL !== "function") return;
  for (const url of urls) URL.revokeObjectURL(url);
}

function compactOptional<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined)) as T;
}
