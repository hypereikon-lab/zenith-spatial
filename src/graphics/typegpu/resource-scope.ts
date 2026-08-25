export type GpuDestroyable = {
  destroy(): void;
};

/**
 * Owns resources whose lifetime is shorter than the shared TypeGPU root.
 *
 * TypeGPU correctly destroys everything when a root ends, but Zenith shares a
 * root across interactive renderers. A renderer therefore needs an explicit
 * scope so closing a preview cannot retain its textures and buffers until the
 * whole workbench shuts down.
 */
export type GpuResourceScope = {
  readonly label: string;
  readonly destroyed: boolean;
  own<T extends GpuDestroyable>(resource: T): T;
  defer(cleanup: () => void): () => void;
  release<T extends GpuDestroyable>(resource: T): T;
  destroy(): void;
};

export function createGpuResourceScope(label: string): GpuResourceScope {
  const resources = new Set<GpuDestroyable>();
  const cleanups = new Set<() => void>();
  let destroyed = false;

  return {
    label,
    get destroyed(): boolean {
      return destroyed;
    },
    own<T extends GpuDestroyable>(resource: T): T {
      if (destroyed) {
        resource.destroy();
        throw new Error(`GPU resource scope “${label}” has been destroyed.`);
      }
      resources.add(resource);
      return resource;
    },
    defer(cleanup: () => void): () => void {
      if (destroyed) {
        cleanup();
        throw new Error(`GPU resource scope “${label}” has been destroyed.`);
      }
      cleanups.add(cleanup);
      return cleanup;
    },
    release<T extends GpuDestroyable>(resource: T): T {
      resources.delete(resource);
      return resource;
    },
    destroy(): void {
      if (destroyed) return;
      destroyed = true;
      for (const cleanup of [...cleanups].reverse()) cleanup();
      cleanups.clear();
      for (const resource of [...resources].reverse()) resource.destroy();
      resources.clear();
    },
  };
}
