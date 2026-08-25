import type { ArtifactMediaHandle, ArtifactSlotId } from "./artifact-types.js";

export type ArtifactMediaRegistry = ReturnType<typeof createArtifactMediaRegistry>;

export function createArtifactMediaRegistry() {
  const artifactMediaHandles = new Map<ArtifactSlotId, ArtifactMediaHandle>();
  const artifactResultMediaHandles = new Map<string, ArtifactMediaHandle>();
  let mediaPreviewHandle: ArtifactMediaHandle = emptyMediaHandle();

  return {
    setArtifact(artifactId: ArtifactSlotId, handle: ArtifactMediaHandle): void {
      artifactMediaHandles.set(artifactId, cloneMediaHandle(handle));
    },

    getArtifact(artifactId: ArtifactSlotId): ArtifactMediaHandle | undefined {
      return artifactMediaHandles.get(artifactId);
    },

    setResult(artifactId: ArtifactSlotId, resultId: string, handle: ArtifactMediaHandle): void {
      artifactResultMediaHandles.set(artifactResultMediaHandleKey(artifactId, resultId), cloneMediaHandle(handle));
    },

    getResult(artifactId: ArtifactSlotId, resultId: string): ArtifactMediaHandle | undefined {
      return artifactResultMediaHandles.get(artifactResultMediaHandleKey(artifactId, resultId));
    },

    clearResults(): void {
      artifactResultMediaHandles.clear();
    },

    setPreview(handle: ArtifactMediaHandle): void {
      mediaPreviewHandle = cloneMediaHandle(handle);
    },

    getPreview(): ArtifactMediaHandle {
      return mediaPreviewHandle;
    },

    clear(): void {
      artifactMediaHandles.clear();
      artifactResultMediaHandles.clear();
      mediaPreviewHandle = emptyMediaHandle();
    },
  };
}

export const activeArtifactMediaRegistry = createArtifactMediaRegistry();

export function setArtifactMediaHandle(artifactId: ArtifactSlotId, handle: ArtifactMediaHandle): void {
  activeArtifactMediaRegistry.setArtifact(artifactId, handle);
}

export function getArtifactMediaHandle(artifactId: ArtifactSlotId): ArtifactMediaHandle | undefined {
  return activeArtifactMediaRegistry.getArtifact(artifactId);
}

export function setArtifactResultMediaHandle(
  artifactId: ArtifactSlotId,
  resultId: string,
  handle: ArtifactMediaHandle,
): void {
  activeArtifactMediaRegistry.setResult(artifactId, resultId, handle);
}

export function getArtifactResultMediaHandle(
  artifactId: ArtifactSlotId,
  resultId: string,
): ArtifactMediaHandle | undefined {
  return activeArtifactMediaRegistry.getResult(artifactId, resultId);
}

export function clearArtifactResultMediaHandles(): void {
  activeArtifactMediaRegistry.clearResults();
}

export function setMediaPreviewHandle(handle: ArtifactMediaHandle): void {
  activeArtifactMediaRegistry.setPreview(handle);
}

export function getMediaPreviewHandle(): ArtifactMediaHandle {
  return activeArtifactMediaRegistry.getPreview();
}

export function cloneMediaHandle(handle: ArtifactMediaHandle): ArtifactMediaHandle {
  return {
    blob: handle.blob || null,
    file: handle.file || null,
    canvas: handle.canvas || null,
  };
}

export function emptyMediaHandle(): ArtifactMediaHandle {
  return { blob: null, file: null, canvas: null };
}

function artifactResultMediaHandleKey(artifactId: ArtifactSlotId, resultId: string): string {
  return `${artifactId}:${resultId}`;
}
