import { Clock, Data, Effect } from "effect";

import { createProjectArchive, projectArchiveMediaId, readProjectArchiveBlob } from "../media/project-archive.js";
import { defaultImageSpatialSpec, plateDraftFingerprint } from "../domain/project.js";
import type {
  Composition,
  ImageSpatialSpec,
  ImageTake,
  MediaAsset,
  PlateCommit,
  PlateDraft,
  ZenithDocument,
} from "../domain/schema.js";
import {
  DEFAULT_AUDIENCE_IN_SPACE,
  decodeSchemaSync,
  ImageSpatialSpecSchema,
  PlateDraftSchema,
  ZenithDocumentSchema,
} from "../domain/schema.js";
import { defaultPlateEditorCamera } from "../plates/plate-editor-view.js";
import { MediaRepository } from "./media-repository.js";
import { WorkbenchService } from "./workbench-service.js";

export class ProjectPersistenceError extends Data.TaggedError("ProjectPersistenceError")<{
  readonly operation: "save" | "load" | "migrate";
  readonly message: string;
  readonly cause?: unknown;
}> {}

export const saveProjectArchive = Effect.gen(function* () {
  const workbench = yield* WorkbenchService;
  const repository = yield* MediaRepository;
  const document = decodeSchemaSync(ZenithDocumentSchema, workbench.getSnapshot().document);
  const attachments = yield* Effect.forEach(
    Object.values(document.project.assets).filter((asset) => asset.storageRef.startsWith("media:")),
    (asset) =>
      repository.readBlob(asset).pipe(
        Effect.map((blob) => ({ id: asset.id, mime: asset.mime, blob })),
        Effect.mapError(
          (cause) =>
            new ProjectPersistenceError({
              operation: "save",
              message: `${asset.filename} is missing its media bytes.`,
              cause,
            }),
        ),
      ),
    { concurrency: 4 },
  );
  return yield* Effect.tryPromise({
    try: () => createProjectArchive(document, { attachments }),
    catch: (cause) =>
      new ProjectPersistenceError({
        operation: "save",
        message: "The Zenith project archive could not be built.",
        cause,
      }),
  });
});

export function loadProjectArchive(file: Blob) {
  return Effect.gen(function* () {
    const workbench = yield* WorkbenchService;
    const repository = yield* MediaRepository;
    const now = new Date(yield* Clock.currentTimeMillis).toISOString();
    const decoded = yield* Effect.tryPromise({
      try: async () => {
        const archive = await readProjectArchiveBlob(file);
        if (archive) {
          const current = tryDecodeCurrentDocument(archive.snapshot);
          if (current) {
            return {
              document: current,
              media: mediaForCurrentDocument(current, archive.media),
              migrated: false,
            };
          }
          const migrated = await migrateLegacyProjectSnapshot(archive.snapshot, archive.media, now);
          return { ...migrated, migrated: true };
        }
        const value = JSON.parse(await file.text()) as unknown;
        const current = tryDecodeCurrentDocument(value);
        if (current) return { document: current, media: new Map<string, Blob>(), migrated: false };
        const migrated = await migrateLegacyProjectSnapshot(value, new Map(), now);
        return { ...migrated, migrated: true };
      },
      catch: (cause) =>
        new ProjectPersistenceError({
          operation: "load",
          message: cause instanceof Error ? cause.message : "The selected project could not be read.",
          cause,
        }),
    });

    yield* repository.clear;
    yield* Effect.forEach(decoded.media, ([assetId, blob]) => repository.put(assetId, { blob }), {
      concurrency: 4,
      discard: true,
    }).pipe(
      Effect.mapError(
        (cause) =>
          new ProjectPersistenceError({
            operation: "load",
            message: "Project media could not be installed in the browser runtime.",
            cause,
          }),
      ),
    );
    yield* workbench
      .replaceDocument(decoded.document)
      .pipe(
        Effect.mapError(
          (cause) =>
            new ProjectPersistenceError({ operation: "load", message: "Project state could not be restored.", cause }),
        ),
      );
    return decoded;
  });
}

function tryDecodeCurrentDocument(value: unknown): ZenithDocument | null {
  try {
    return decodeSchemaSync(ZenithDocumentSchema, value);
  } catch {
    return null;
  }
}

function mediaForCurrentDocument(document: ZenithDocument, archiveMedia: ReadonlyMap<string, Blob>): Map<string, Blob> {
  const output = new Map<string, Blob>();
  for (const asset of Object.values(document.project.assets)) {
    if (!asset.storageRef.startsWith("media:")) continue;
    const storageId = asset.storageRef.slice("media:".length);
    const blob = archiveMedia.get(asset.id) ?? archiveMedia.get(storageId);
    if (!blob) throw new Error(`Zenith project archive is missing media ${asset.filename}.`);
    output.set(asset.id, blob);
  }
  return output;
}

type MigratedProject = {
  readonly document: ZenithDocument;
  readonly media: Map<string, Blob>;
};

async function migrateLegacyProjectSnapshot(
  value: unknown,
  archiveMedia: ReadonlyMap<string, Blob>,
  now: string,
): Promise<MigratedProject> {
  const snapshot = record(value);
  if (snapshot.version !== 17) throw new Error("Unsupported Zenith project format.");
  const oldProject = record(snapshot.project);
  const sequence = record(oldProject.sequence);
  const oldCompositions = array(sequence.compositions);
  if (oldCompositions.length === 0) throw new Error("Legacy Zenith project has no compositions.");
  const projectId = `project-migrated-${dateSlug(now)}`;
  const assets: Record<string, MediaAsset> = {};
  const media = new Map<string, Blob>();
  const oldSourceAssets = record(sequence.sourceAssets);
  for (const [assetId, candidate] of Object.entries(oldSourceAssets)) {
    const source = record(candidate);
    const sourceMedia = record(source.media);
    const migrated = await migrateMediaAsset({
      id: assetId,
      filename: stringValue(source.label) || stringValue(sourceMedia.name) || `${assetId}.png`,
      mime: stringValue(sourceMedia.mime) || "image/png",
      width: positiveInt(source.width, 1),
      height: positiveInt(source.height, 1),
      url: stringValue(sourceMedia.url),
      createdAt: stringValue(source.createdAt) || now,
      archiveMedia,
    });
    assets[assetId] = migrated.asset;
    if (migrated.blob) media.set(assetId, migrated.blob);
  }

  const revisions = record(sequence.revisions);
  const generation = record(oldProject.generation);
  const compositions: Composition[] = [];
  for (const [index, candidate] of oldCompositions.entries()) {
    const oldComposition = record(candidate);
    const compositionId = stringValue(oldComposition.id) || `composition-${index + 1}`;
    const draft = decodeSchemaSync(PlateDraftSchema, oldComposition.plateDraft);
    const plateCommits: PlateCommit[] = [];
    const imageTakes: ImageTake[] = [];
    const plateRevisionId = nullableString(oldComposition.plateSketchRevisionId);
    const imageRevisionId = nullableString(oldComposition.imageRevisionId);
    if (plateRevisionId) {
      const revision = record(revisions[plateRevisionId]);
      if (Object.keys(revision).length > 0) {
        const mediaId = `media-${plateRevisionId}`;
        const oldMedia = record(revision.normalizedMedia ?? revision.media);
        const committedDraft = decodeSchemaSync(PlateDraftSchema, revision.plateComposition ?? draft);
        const legacySpec = defaultImageSpatialSpec(committedDraft);
        const spatialSpec: ImageSpatialSpec = {
          ...legacySpec,
          sourceWidth: committedDraft.raster.width,
          sourceHeight: committedDraft.raster.height,
        };
        const migrated = await migrateMediaAsset({
          id: mediaId,
          filename: stringValue(oldMedia.name) || `${plateRevisionId}.png`,
          mime: stringValue(oldMedia.mime) || "image/png",
          width: spatialSpec.sourceWidth ?? spatialSpec.targetWidth,
          height: spatialSpec.sourceHeight ?? spatialSpec.targetHeight,
          url: stringValue(oldMedia.url),
          createdAt: stringValue(revision.createdAt) || now,
          archiveMedia,
        });
        assets[mediaId] = migrated.asset;
        if (migrated.blob) media.set(mediaId, migrated.blob);
        plateCommits.push({
          id: plateRevisionId,
          label: stringValue(revision.label) || "Migrated Plate Commit",
          createdAt: stringValue(revision.createdAt) || now,
          mediaAssetId: mediaId,
          draft: committedDraft,
          spatialSpec,
          provenance: {
            version: 1,
            projectId,
            compositionId,
            sourceAssetIds: stringArray(oldComposition.sourceAssetIds),
            draftFingerprint: plateDraftFingerprint(committedDraft),
          },
        });
      }
    }
    if (imageRevisionId) {
      const revision = record(revisions[imageRevisionId]);
      if (Object.keys(revision).length > 0) {
        const mediaId = `media-${imageRevisionId}`;
        const oldMedia = record(revision.normalizedMedia ?? revision.media);
        const spatialSpec = legacySpatialSpec(revision.spatialSpec, draft);
        const migrated = await migrateMediaAsset({
          id: mediaId,
          filename: stringValue(oldMedia.name) || `${imageRevisionId}.png`,
          mime: stringValue(oldMedia.mime) || "image/png",
          width: spatialSpec.sourceWidth ?? spatialSpec.targetWidth,
          height: spatialSpec.sourceHeight ?? spatialSpec.targetHeight,
          url: stringValue(oldMedia.url),
          createdAt: stringValue(revision.createdAt) || now,
          archiveMedia,
        });
        assets[mediaId] = migrated.asset;
        if (migrated.blob) media.set(mediaId, migrated.blob);
        imageTakes.push({
          id: imageRevisionId,
          label: stringValue(revision.label) || "Migrated Image Take",
          kind: plateCommits.length > 0 && revision.kind === "clean-image" ? "generated" : "imported",
          createdAt: stringValue(revision.createdAt) || now,
          mediaAssetId: mediaId,
          plateCommitId: plateCommits[0]?.id ?? null,
          direction: stringValue(generation.direction),
          strategy: generation.mode === "strict" ? "strict" : "integrated",
          ...(stringValue(revision.prompt) ? { prompt: stringValue(revision.prompt) } : {}),
          spatialSpec,
        });
      }
    }
    compositions.push({
      id: compositionId,
      label: stringValue(oldComposition.label) || `Composition ${String(index + 1).padStart(2, "0")}`,
      sourceAssetIds: stringArray(oldComposition.sourceAssetIds).filter((id) => Boolean(assets[id])),
      plateDraft: draft,
      plateCommits,
      imageTakes,
      selectedPlateCommitId: plateCommits.at(-1)?.id ?? null,
      selectedImageTakeId: imageTakes.at(-1)?.id ?? null,
      generationDirection: stringValue(generation.direction),
      generationStrategy: generation.mode === "strict" ? "strict" : "integrated",
      notes: stringValue(oldComposition.notes),
      createdAt: stringValue(oldComposition.createdAt) || now,
      updatedAt: stringValue(oldComposition.updatedAt) || now,
    });
  }

  const oldWorkspace = record(oldProject.workspace);
  const requestedComposition = nullableString(oldWorkspace.selectedCompositionId);
  const selected = compositions.find((composition) => composition.id === requestedComposition) ?? compositions[0]!;
  const camera = defaultPlateEditorCamera(selected.plateDraft.projectionMode, selected.plateDraft.surface);
  const legacyMode = stringValue(oldWorkspace.modeId);
  const document = decodeSchemaSync(ZenithDocumentSchema, {
    project: {
      schemaVersion: 1,
      id: projectId,
      metadata: { title: "Migrated Zenith Project", createdAt: now, updatedAt: now },
      assets,
      compositions,
    },
    workspace: {
      selectedCompositionId: selected.id,
      room: legacyMode === "inpaint" ? "generate" : legacyMode === "project" ? "review" : "compose",
      selectedLayerId: selected.plateDraft.frame.activeLayerId,
      viewMode: "source-map",
      viewerMode:
        oldWorkspace.viewerMode === "dome-check" || oldWorkspace.viewerMode === "rim-check"
          ? oldWorkspace.viewerMode
          : "domemaster",
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
    },
  });
  return { document, media };
}

function legacySpatialSpec(value: unknown, draft: PlateDraft): ImageSpatialSpec {
  try {
    return decodeSchemaSync(ImageSpatialSpecSchema, value);
  } catch {
    return defaultImageSpatialSpec(draft);
  }
}

async function migrateMediaAsset({
  id,
  filename,
  mime,
  width,
  height,
  url,
  createdAt,
  archiveMedia,
}: {
  id: string;
  filename: string;
  mime: string;
  width: number;
  height: number;
  url: string;
  createdAt: string;
  archiveMedia: ReadonlyMap<string, Blob>;
}): Promise<{ asset: MediaAsset; blob: Blob | null }> {
  const archiveId = projectArchiveMediaId(url);
  let blob = archiveId ? (archiveMedia.get(archiveId) ?? null) : null;
  if (!blob && url.startsWith("data:")) {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Could not decode legacy media ${filename}.`);
    blob = await response.blob();
  }
  if (archiveId && !blob) throw new Error(`Legacy archive is missing media ${filename}.`);
  return {
    asset: {
      id,
      kind: "image",
      filename,
      mime: blob?.type || mime,
      width,
      height,
      storageRef: blob ? `media:${id}` : url,
      alt: filename,
      createdAt,
    },
    blob,
  };
}

function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function array(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function nullableString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function positiveInt(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : fallback;
}

function dateSlug(value: string): string {
  return value.replace(/[^0-9]/g, "").slice(0, 14) || "local";
}
