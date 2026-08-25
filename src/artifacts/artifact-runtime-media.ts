import type { ArtifactMedia, ArtifactMediaHandle, ArtifactRecord } from "./artifact-types.js";
import type { ProjectArtifactMedia } from "../lib/shared/contracts/projects.js";
import { canvasToBlob } from "../media/canvas-utils.js";

export type PortableMediaStore = (blob: Blob, mime?: string) => string;

export type RuntimeMediaFileOptions = {
  kind: Exclude<ArtifactMedia["kind"], "none" | "canvas">;
  name: string;
  mime?: string;
  alt: string;
};

export function artifactMediaFromFile(
  file: File,
  { kind, alt }: Omit<RuntimeMediaFileOptions, "name" | "mime">,
): {
  media: ArtifactMedia;
  handle: ArtifactMediaHandle;
} {
  return {
    media: {
      kind,
      url: URL.createObjectURL(file),
      name: file.name,
      mime: file.type,
      alt,
      blob: null,
      file: null,
      canvas: null,
    },
    handle: { blob: file, file, canvas: null },
  };
}

export async function readArtifactMediaAsDataUrl(
  artifact: Pick<ArtifactRecord, "label" | "media">,
  handle: ArtifactMediaHandle | undefined,
): Promise<string> {
  const { media } = artifact;
  if (media.kind === "none") throw new Error("Artifact has no media.");
  if (media.url?.startsWith("data:")) return media.url;
  if (handle?.canvas) return handle.canvas.toDataURL("image/png");
  if (handle?.blob) return blobToDataUrl(handle.blob);
  if (media.canvas) return media.canvas.toDataURL("image/png");
  if (media.blob) return blobToDataUrl(media.blob);
  if (!media.url) throw new Error(`${artifact.label} has no readable media.`);
  const response = await fetch(media.url);
  if (!response.ok) throw new Error(`Could not read artifact media: ${media.name || media.url}`);
  return blobToDataUrl(await response.blob());
}

export async function toPortableArtifactMedia(
  media: ArtifactMedia,
  handle: ArtifactMediaHandle | undefined,
  {
    preferLiveHandle,
    storeBlob,
  }: {
    preferLiveHandle: boolean;
    storeBlob?: PortableMediaStore;
  },
): Promise<ProjectArtifactMedia> {
  const cleanMedia = toPortableMediaDescriptor(media);
  if (media.kind === "none") return cleanMedia;
  if (media.url?.startsWith("data:")) return cleanMedia;

  if (preferLiveHandle && handle?.canvas) {
    return {
      ...cleanMedia,
      kind: "image",
      url: storeBlob
        ? storeBlob(await canvasToBlob(handle.canvas, "image/png"), "image/png")
        : handle.canvas.toDataURL("image/png"),
      mime: "image/png",
    };
  }
  if (preferLiveHandle && handle?.blob) {
    return {
      ...cleanMedia,
      url: storeBlob ? storeBlob(handle.blob, handle.blob.type) : await blobToDataUrl(handle.blob),
      mime: handle.blob.type || cleanMedia.mime,
    };
  }
  if (media.canvas) {
    return {
      ...cleanMedia,
      kind: "image",
      url: storeBlob
        ? storeBlob(await canvasToBlob(media.canvas, "image/png"), "image/png")
        : media.canvas.toDataURL("image/png"),
      mime: "image/png",
    };
  }
  if (media.blob) {
    return {
      ...cleanMedia,
      url: storeBlob ? storeBlob(media.blob, media.blob.type) : await blobToDataUrl(media.blob),
      mime: media.blob.type || cleanMedia.mime,
    };
  }
  if (!media.url) return cleanMedia;

  try {
    const response = await fetch(media.url);
    if (!response.ok) return withoutRuntimeObjectUrl(cleanMedia);
    const blob = await response.blob();
    return {
      ...cleanMedia,
      url: storeBlob ? storeBlob(blob, blob.type) : await blobToDataUrl(blob),
      mime: blob.type || cleanMedia.mime,
    };
  } catch {
    return withoutRuntimeObjectUrl(cleanMedia);
  }
}

export function toRuntimeArtifactMedia(media: ProjectArtifactMedia): ArtifactMedia {
  return {
    ...media,
    blob: null,
    file: null,
    canvas: null,
  } as ArtifactMedia;
}

export function collectArtifactObjectUrls(artifact: ArtifactRecord): string[] {
  const urls = new Set<string>();
  addObjectUrl(urls, artifact.media.url);
  for (const result of artifact.results) {
    addObjectUrl(urls, result.media.url);
  }
  return [...urls];
}

export function collectObjectUrlsFromArtifacts(
  artifacts: Iterable<ArtifactRecord>,
  extraMedia: Iterable<ArtifactMedia> = [],
): string[] {
  const urls = new Set<string>();
  for (const artifact of artifacts) {
    for (const url of collectArtifactObjectUrls(artifact)) {
      urls.add(url);
    }
  }
  for (const media of extraMedia) {
    addObjectUrl(urls, media.url);
  }
  return [...urls];
}

export function revokeObjectUrls(urls: Iterable<string>): void {
  if (typeof URL === "undefined" || typeof URL.revokeObjectURL !== "function") return;
  for (const url of urls) {
    URL.revokeObjectURL(url);
  }
}

export function blobToDataUrl(blob: Blob): Promise<string> {
  if (typeof FileReader === "undefined") {
    return blob.arrayBuffer().then((arrayBuffer) => {
      const base64 = Buffer.from(arrayBuffer).toString("base64");
      return `data:${blob.type || "application/octet-stream"};base64,${base64}`;
    });
  }

  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error || new Error("Could not read blob."));
    reader.readAsDataURL(blob);
  });
}

function toPortableMediaDescriptor(media: ArtifactMedia): ProjectArtifactMedia {
  const kind = media.kind === "canvas" ? "image" : media.kind;
  return compactOptional({
    kind,
    url: media.url,
    name: media.name,
    mime: media.mime,
    alt: media.alt,
  });
}

function withoutRuntimeObjectUrl(media: ProjectArtifactMedia): ProjectArtifactMedia {
  if (!media.url?.startsWith("blob:")) return media;
  const { url: _url, ...rest } = media;
  return rest;
}

function addObjectUrl(urls: Set<string>, url: string | undefined): void {
  if (url?.startsWith("blob:")) {
    urls.add(url);
  }
}

function compactOptional<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined)) as T;
}
