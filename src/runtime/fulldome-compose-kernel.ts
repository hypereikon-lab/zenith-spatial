import { Data, Effect } from "effect";

import { createInitialZenithDocument, defaultImageSpatialSpec, selectedComposition } from "../domain/project.js";
import type { PlateDraft } from "../domain/schema.js";
import { canvasToBlob } from "../media/canvas-utils.js";
import { embedZenithPlateMetadataInPngBlob } from "../media/png-zenith-provenance.js";
import {
  arrangeFulldomeBundle,
  isFulldomeBundleSize,
  type FulldomeBundleOrientation,
  type FulldomeBundleSlot,
} from "../plates/fulldome-bundle-arrangement.js";
import type { PlateSketchPreviewInput, PlateSketchPreviewSession } from "../plates/plate-sketch-preview-session.js";
import { loadPlateSketchSource, type PlateSketchImage } from "../plates/plate-sketch-sources.js";

export type FulldomeDirectReference = {
  readonly filename: string;
  readonly mime?: string;
  readonly sha256?: string;
  /** Local-only locator retained in the external manifest, never embedded into the PNG. */
  readonly source?: string;
};

export type FulldomeComposeSource = {
  readonly file: File;
  /** One provenance edge only: references used directly to create this source. */
  readonly directReferences?: ReadonlyArray<FulldomeDirectReference>;
};

export type FulldomeComposeOptions = {
  readonly zenithSourceIndex?: number;
  readonly orientation?: FulldomeBundleOrientation;
  readonly projectId?: string;
  readonly compositionId?: string;
  readonly createdAt?: string;
};

export type FulldomeComposeManifest = {
  readonly schema: "zenith.fulldome-compose.v1";
  readonly createdAt: string;
  readonly projectId: string;
  readonly compositionId: string;
  readonly orientation: FulldomeBundleOrientation;
  readonly zenithSourceIndex: number;
  readonly raster: { readonly width: number; readonly height: number };
  readonly sources: ReadonlyArray<{
    readonly index: number;
    readonly slot: FulldomeBundleSlot;
    readonly filename: string;
    readonly mime: string;
    readonly width: number;
    readonly height: number;
    readonly sha256: string;
    readonly directReferences: ReadonlyArray<FulldomeDirectReference>;
  }>;
  readonly output: {
    readonly filename: string;
    readonly mime: "image/png";
    readonly width: number;
    readonly height: number;
    readonly sha256: string;
  };
};

export type FulldomeComposeResult = {
  readonly blob: Blob;
  readonly filename: string;
  readonly width: number;
  readonly height: number;
  readonly draft: PlateDraft;
  readonly previewInput: PlateSketchPreviewInput;
  readonly manifest: FulldomeComposeManifest;
};

export class FulldomeComposeError extends Data.TaggedError("FulldomeComposeError")<{
  readonly operation: "validate" | "decode" | "render" | "encode";
  readonly message: string;
  readonly cause?: unknown;
}> {}

/**
 * Workbench-free fulldome composition boundary.
 *
 * The caller supplies ordinary browser Files and a renderer session. No React,
 * WorkbenchService, MediaRepository, selected project, or UI lifecycle is read.
 */
export function composeFulldomePlateBundlePng(
  session: Pick<PlateSketchPreviewSession, "renderHandoffCanvas">,
  sources: ReadonlyArray<FulldomeComposeSource>,
  {
    zenithSourceIndex = sources.length - 1,
    orientation = "profile",
    projectId = "project-headless",
    compositionId = "composition-headless",
    createdAt = new Date().toISOString(),
  }: FulldomeComposeOptions = {},
) {
  return Effect.gen(function* () {
    const files = sources.map(({ file }) => file);
    if (!isFulldomeBundleSize(files.length)) {
      return yield* Effect.fail(
        new FulldomeComposeError({
          operation: "validate",
          message: `Fulldome composition requires exactly 2 or 3 sources; received ${files.length}.`,
        }),
      );
    }
    if (files.some((file) => !file.type.startsWith("image/"))) {
      return yield* Effect.fail(
        new FulldomeComposeError({ operation: "validate", message: "Every fulldome source must be an image." }),
      );
    }
    if (!Number.isInteger(zenithSourceIndex) || zenithSourceIndex < 0 || zenithSourceIndex >= files.length) {
      return yield* Effect.fail(
        new FulldomeComposeError({
          operation: "validate",
          message: `Zenith source index ${zenithSourceIndex} is outside this ${files.length}-source bundle.`,
        }),
      );
    }

    const plates = yield* Effect.forEach(
      files,
      (file) =>
        Effect.tryPromise({
          try: () => loadPlateSketchSource(file.name, file),
          catch: (cause) =>
            new FulldomeComposeError({
              operation: "decode",
              message: `Could not decode ${file.name}.`,
              cause,
            }),
        }),
      { concurrency: 3 },
    );
    const arrangement = yield* Effect.try({
      try: () => arrangeFulldomeBundle(plates, { zenithIndex: zenithSourceIndex, orientation }),
      catch: (cause) =>
        new FulldomeComposeError({
          operation: "validate",
          message: cause instanceof Error ? cause.message : "The fulldome bundle could not be arranged.",
          cause,
        }),
    });
    const draft = standaloneDraft(plates, files, arrangement.placements, arrangement.activeIndex, {
      projectId,
      compositionId,
      createdAt,
    });
    const previewInput = standalonePreviewInput(draft, plates);
    const { width, height } = draft.raster;
    const canvas = yield* Effect.tryPromise({
      try: () => session.renderHandoffCanvas(previewInput, { width, height }),
      catch: (cause) =>
        new FulldomeComposeError({
          operation: "render",
          message: "The headless WebGPU compositor could not render the Plate Sketch.",
          cause,
        }),
    });
    if (canvas.width !== width || canvas.height !== height) {
      return yield* Effect.fail(
        new FulldomeComposeError({
          operation: "render",
          message: `Renderer returned ${canvas.width}×${canvas.height}; expected ${width}×${height}.`,
        }),
      );
    }

    const encoded = yield* Effect.tryPromise({
      try: () => canvasToBlob(canvas, "image/png"),
      catch: (cause) =>
        new FulldomeComposeError({ operation: "encode", message: "Plate Sketch PNG encoding failed.", cause }),
    });
    const spatialSpec = {
      ...defaultImageSpatialSpec(draft),
      sourceWidth: width,
      sourceHeight: height,
      sourceAspectRatio: width / height,
    };
    const blob = yield* Effect.tryPromise({
      try: () =>
        embedZenithPlateMetadataInPngBlob(encoded, {
          version: 1,
          kind: "plate-draft",
          projectId,
          compositionId,
          plateCommitId: null,
          createdAt,
          draft,
          spatialSpec,
          provenance: null,
        }),
      catch: (cause) =>
        new FulldomeComposeError({
          operation: "encode",
          message: "Plate Sketch spatial metadata could not be embedded.",
          cause,
        }),
    });
    const sourceHashes = yield* Effect.forEach(files, (file) => Effect.promise(() => sha256Blob(file)), {
      concurrency: 3,
    });
    const outputHash = yield* Effect.promise(() => sha256Blob(blob));
    const filename = `zenith-plate-sketch-${width}x${height}.png`;
    const manifest: FulldomeComposeManifest = {
      schema: "zenith.fulldome-compose.v1",
      createdAt,
      projectId,
      compositionId,
      orientation: arrangement.orientation,
      zenithSourceIndex,
      raster: { width, height },
      sources: files.map((file, index) => ({
        index,
        slot: arrangement.slots[index]!,
        filename: file.name,
        mime: file.type,
        width: plates[index]!.width,
        height: plates[index]!.height,
        sha256: sourceHashes[index]!,
        directReferences: deduplicateDirectReferences(sources[index]!.directReferences ?? []),
      })),
      output: { filename, mime: "image/png", width, height, sha256: outputHash },
    };

    return { blob, filename, width, height, draft, previewInput, manifest } satisfies FulldomeComposeResult;
  });
}

function standaloneDraft(
  plates: ReadonlyArray<PlateSketchImage>,
  files: ReadonlyArray<File>,
  placements: ReturnType<typeof arrangeFulldomeBundle>["placements"],
  activeIndex: number,
  {
    projectId,
    compositionId,
    createdAt,
  }: Required<Pick<FulldomeComposeOptions, "projectId" | "compositionId" | "createdAt">>,
): PlateDraft {
  const document = createInitialZenithDocument({ now: createdAt, projectId, compositionId });
  const draft = structuredClone(selectedComposition(document).plateDraft);
  draft.frame.plateLayers = plates.map((plate, index) => ({
    id: `headless-layer-${index + 1}`,
    name: files[index]!.name,
    index,
    source: {
      assetId: `headless-source-${index + 1}`,
      name: files[index]!.name,
      width: plate.width,
      height: plate.height,
      aspect: plate.aspect,
      mime: files[index]!.type,
    },
    placement: structuredClone(placements[index]!),
    visible: true,
    locked: false,
  }));
  draft.frame.activeLayerId = draft.frame.plateLayers[activeIndex]!.id;
  return draft;
}

function standalonePreviewInput(draft: PlateDraft, plates: ReadonlyArray<PlateSketchImage>): PlateSketchPreviewInput {
  return {
    plates: [...plates],
    placements: draft.frame.plateLayers.map((layer) => structuredClone(layer.placement)),
    canvasWidth: draft.raster.width,
    canvasHeight: draft.raster.height,
    plateFit: draft.frame.plateFit,
    plateFeather: draft.frame.plateFeather,
    domeGuideSemanticSplit: draft.guideSplit,
    domeGuideHorizonSplit: draft.horizonSplit,
    sourceProjectionMode: draft.projectionMode,
    projectionSurface: draft.surface,
    viewerMode: "domemaster",
    projectionViewMode: "source-map",
    projectionCamera: {},
    showCaveMask: false,
    invertCaveMask: false,
  };
}

function deduplicateDirectReferences(
  references: ReadonlyArray<FulldomeDirectReference>,
): ReadonlyArray<FulldomeDirectReference> {
  const seen = new Set<string>();
  return references.filter((reference) => {
    const key = reference.sha256 || `${reference.filename}\u0000${reference.source ?? ""}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

async function sha256Blob(blob: Blob): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", await blob.arrayBuffer());
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}
