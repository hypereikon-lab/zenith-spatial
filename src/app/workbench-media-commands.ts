import {
  recordWorkbenchError,
  replaceArtifactMedia,
  replaceMediaPreview,
  selectArtifact,
  setMediaPreviewOpen,
  workbench,
} from "../artifacts/artifact-store.svelte.js";
import { getMediaPreviewHandle } from "../artifacts/artifact-media-handles.js";
import { artifactMediaFromFile } from "../artifacts/artifact-runtime-media.js";
import type { ArtifactSlotId } from "../artifacts/artifact-types.js";
import {
  captureSelectedFinishedImage,
  captureSelectedPlateSketch,
  selectedCompositionState,
} from "./workbench-sequence-commands.js";
import { readZenithProvenanceFromPngBlob } from "../media/png-zenith-provenance.js";
import { downloadBlob } from "../media/canvas-utils.js";
import { presentationMediaForRevision, selectedImageRevisionForComposition } from "../sequence/composition-sequence.js";

export type FinishedImageDownloadVariant = "original" | "canonical";

export async function importPlateSketchFile(file: File): Promise<void> {
  if (!file.type.startsWith("image/")) {
    recordWorkbenchError("Plate Sketch must be an image.", "plate-sketch");
    return;
  }
  const { media, handle } = artifactMediaFromFile(file, {
    kind: "image",
    alt: "Imported projection-aware Plate Sketch",
  });
  replaceArtifactMedia("plate-sketch", {
    patch: {
      status: "ready",
      stale: false,
      summary: file.name + " imported as the Plate Sketch handoff.",
      operatorId: "import-plate-sketch",
      media,
      warnings: [],
    },
    handle,
    result: { label: "Imported " + file.name, media, operatorId: "import-plate-sketch" },
  });
  await captureSelectedPlateSketch();
  selectArtifact("plate-sketch");
}

export async function importSourceFile(file: File): Promise<void> {
  if (!file.type.startsWith("image/")) {
    recordWorkbenchError("Finished spatial media must be a still image.", "finished-image");
    return;
  }
  let provenance;
  try {
    provenance = await readZenithProvenanceFromPngBlob(file);
  } catch (error) {
    recordWorkbenchError(
      error instanceof Error ? error.message : "Could not read Zenith image metadata.",
      "finished-image",
    );
    return;
  }
  const inheritedProjection =
    selectedCompositionState()?.plateDraft.projectionMode || workbench.project.scene.projectionMode;
  const { media, handle } = artifactMediaFromFile(file, { kind: "image", alt: "Imported finished spatial image" });
  replaceArtifactMedia("finished-image", {
    patch: {
      status: "ready",
      stale: false,
      summary: file.name + " imported as the finished image.",
      operatorId: "import-source",
      projectionProfile: provenance?.spatialSpec.projectionMode || inheritedProjection,
      ...(provenance ? { provenance } : {}),
      media,
      warnings: provenance ? [] : ["No Zenith metadata found; inherited the selected composition projection."],
    },
    handle,
    result: {
      label: "Imported " + file.name,
      media,
      ...(provenance ? { provenance } : {}),
      operatorId: "import-source",
    },
  });
  await captureSelectedFinishedImage();
  selectArtifact("finished-image");
}

export async function importPreviewMediaFile(file: File): Promise<void> {
  if (!file.type.startsWith("image/")) {
    recordWorkbenchError("Drop an image for projection preview.", "media-preview");
    return;
  }
  const { media, handle } = artifactMediaFromFile(file, { kind: "image", alt: "Imported image preview" });
  replaceMediaPreview(media, file.name + " loaded into projection preview.", handle);
}

export async function promotePreviewMedia(targetArtifactId: ArtifactSlotId): Promise<void> {
  const file = getMediaPreviewHandle().file;
  if (!file) {
    recordWorkbenchError("Media Preview has no file to promote.", "media-preview");
    return;
  }
  if (targetArtifactId === "plate-sketch") await importPlateSketchFile(file);
  else await importSourceFile(file);
  setMediaPreviewOpen(false);
}

export async function downloadSelectedFinishedImage(variant: FinishedImageDownloadVariant): Promise<string> {
  const composition = selectedCompositionState();
  if (!composition) throw new Error("Select a composition before downloading its image.");
  const revision = selectedImageRevisionForComposition(workbench.project.sequence, composition);
  if (!revision) throw new Error("Generate or import a finished image before downloading it.");
  const media = variant === "original" ? revision.media : presentationMediaForRevision(revision);
  if (!media.url) throw new Error("The selected image has no downloadable data.");
  const response = await fetch(media.url);
  if (!response.ok) throw new Error("Could not read the selected image for download.");
  const name = filenamePart(composition.label);
  const suffix = variant === "original" ? "original-result" : "projected-fit";
  const filename = "zenith-" + name + "-" + suffix + "." + imageExtension(media.mime, media.url);
  downloadBlob(await response.blob(), filename);
  return filename;
}

function filenamePart(value: string): string {
  return (
    value
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "") || "composition"
  );
}

function imageExtension(mime: string | undefined, url: string): string {
  const normalized = mime?.toLowerCase() || /^data:([^;,]+)/i.exec(url)?.[1]?.toLowerCase();
  if (normalized === "image/jpeg") return "jpg";
  if (normalized === "image/webp") return "webp";
  if (normalized === "image/avif") return "avif";
  return "png";
}
