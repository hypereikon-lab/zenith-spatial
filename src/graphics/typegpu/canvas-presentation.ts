import type { TgpuRoot } from "typegpu";

export type CanvasPresentationOptions = {
  format: GPUTextureFormat;
  alphaMode?: GPUCanvasAlphaMode;
  usage?: GPUTextureUsageFlags;
};

export type CanvasPresentationFrame = {
  width: number;
  height: number;
  alphaMode?: GPUCanvasAlphaMode;
};

export type CanvasPresentation = {
  readonly canvas: HTMLCanvasElement;
  readonly context: GPUCanvasContext;
  configure(frame: CanvasPresentationFrame): GPUCanvasContext;
  destroy(): void;
};

/** Keeps all canvas configuration on TypeGPU's stable context API. */
export function createCanvasPresentation(
  root: TgpuRoot,
  canvas: HTMLCanvasElement,
  { format, alphaMode = "opaque", usage = GPUTextureUsage.RENDER_ATTACHMENT }: CanvasPresentationOptions,
): CanvasPresentation {
  let configuredWidth = Math.max(1, canvas.width);
  let configuredHeight = Math.max(1, canvas.height);
  let configuredAlphaMode = alphaMode;
  let destroyed = false;
  let context = root.configureContext({ canvas, format, alphaMode, usage });

  return {
    canvas,
    get context(): GPUCanvasContext {
      return context;
    },
    configure({ width, height, alphaMode: nextAlphaMode = configuredAlphaMode }): GPUCanvasContext {
      if (destroyed) throw new Error("Canvas presentation has been destroyed.");
      const safeWidth = Math.max(1, Math.round(width));
      const safeHeight = Math.max(1, Math.round(height));
      const canvasChanged = canvas.width !== safeWidth || canvas.height !== safeHeight;
      if (canvas.width !== safeWidth) canvas.width = safeWidth;
      if (canvas.height !== safeHeight) canvas.height = safeHeight;
      if (
        canvasChanged ||
        configuredWidth !== safeWidth ||
        configuredHeight !== safeHeight ||
        configuredAlphaMode !== nextAlphaMode
      ) {
        context = root.configureContext({ canvas, format, alphaMode: nextAlphaMode, usage });
        configuredWidth = safeWidth;
        configuredHeight = safeHeight;
        configuredAlphaMode = nextAlphaMode;
      }
      return context;
    },
    destroy(): void {
      if (destroyed) return;
      destroyed = true;
      context.unconfigure?.();
    },
  };
}
