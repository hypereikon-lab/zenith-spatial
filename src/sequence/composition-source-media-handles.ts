export type CompositionSourceMediaHandle = {
  blob: Blob | null;
  file: File | null;
  objectUrl: string | null;
};

export type CompositionSourceMediaRegistry = ReturnType<typeof createCompositionSourceMediaRegistry>;

export function createCompositionSourceMediaRegistry() {
  const handles = new Map<string, CompositionSourceMediaHandle>();

  return {
    set(assetId: string, handle: CompositionSourceMediaHandle): void {
      revokeReplacedHandle(handles.get(assetId), handle.objectUrl);
      handles.set(assetId, { ...handle });
    },

    get(assetId: string): CompositionSourceMediaHandle | undefined {
      return handles.get(assetId);
    },

    delete(assetId: string): void {
      revokeHandle(handles.get(assetId));
      handles.delete(assetId);
    },

    clear(): void {
      for (const handle of handles.values()) revokeHandle(handle);
      handles.clear();
    },

    ids(): string[] {
      return [...handles.keys()];
    },

    size(): number {
      return handles.size;
    },
  };
}

function revokeReplacedHandle(previous: CompositionSourceMediaHandle | undefined, replacementUrl: string | null): void {
  if (previous && previous.objectUrl !== replacementUrl) revokeHandle(previous);
}

function revokeHandle(handle: CompositionSourceMediaHandle | undefined): void {
  const url = handle?.objectUrl;
  if (url?.startsWith("blob:") && typeof URL !== "undefined" && typeof URL.revokeObjectURL === "function") {
    URL.revokeObjectURL(url);
  }
}
