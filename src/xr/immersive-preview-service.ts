import { Context, Data, Effect, Layer } from "effect";

import type {
  ImmersivePreviewController,
  ImmersivePreviewMode,
  ImmersivePreviewRendererInput,
  OrientationPermissionState,
} from "./immersive-preview-renderer.js";

type ImmersiveRendererModule = typeof import("./immersive-preview-renderer.js");

type DeviceOrientationConstructor = typeof DeviceOrientationEvent & {
  requestPermission?: () => Promise<"granted" | "denied">;
};

let rendererModule: ImmersiveRendererModule | null = null;
let rendererModulePromise: Promise<ImmersiveRendererModule> | null = null;

export type ImmersiveCapabilities = {
  readonly secureContext: boolean;
  readonly lookaround: true;
  readonly orientation: boolean;
  readonly vr: boolean;
  readonly ar: boolean;
};

export type ImmersivePreviewRunInput = Omit<ImmersivePreviewRendererInput, "signal"> & {
  readonly onReady: (controller: ImmersivePreviewController) => void;
};

export class ImmersivePreviewError extends Data.TaggedError("ImmersivePreviewError")<{
  readonly mode: ImmersivePreviewMode | "capabilities";
  readonly message: string;
  readonly cause?: unknown;
}> {}

export interface ImmersivePreviewServiceShape {
  readonly prepare: Effect.Effect<void, ImmersivePreviewError>;
  readonly capabilities: Effect.Effect<ImmersiveCapabilities, ImmersivePreviewError>;
  readonly run: (input: ImmersivePreviewRunInput) => Effect.Effect<void, ImmersivePreviewError>;
}

export class ImmersivePreview extends Context.Tag("zenith/ImmersivePreview")<
  ImmersivePreview,
  ImmersivePreviewServiceShape
>() {
  static readonly Live = Layer.succeed(ImmersivePreview, makeImmersivePreviewService());

  static test(capabilities: ImmersiveCapabilities) {
    return Layer.succeed(ImmersivePreview, {
      prepare: Effect.void,
      capabilities: Effect.succeed(capabilities),
      run: () => Effect.void,
    });
  }
}

export function makeImmersivePreviewService({
  detect = detectImmersiveCapabilities,
  prepare = preloadImmersivePreviewRenderer,
  start = startImmersivePreview,
}: {
  detect?: () => Promise<ImmersiveCapabilities>;
  prepare?: () => Promise<void>;
  start?: (input: ImmersivePreviewRendererInput) => Promise<ImmersivePreviewController>;
} = {}): ImmersivePreviewServiceShape {
  return {
    prepare: Effect.tryPromise({
      try: prepare,
      catch: (cause) =>
        new ImmersivePreviewError({
          mode: "capabilities",
          message: "Could not prepare the immersive renderer.",
          cause,
        }),
    }),
    capabilities: Effect.tryPromise({
      try: detect,
      catch: (cause) =>
        new ImmersivePreviewError({
          mode: "capabilities",
          message: "Could not inspect immersive browser capabilities.",
          cause,
        }),
    }),
    run: (input) =>
      Effect.scoped(
        Effect.acquireRelease(
          Effect.tryPromise({
            try: (signal) => start({ ...input, signal }),
            catch: (cause) =>
              new ImmersivePreviewError({
                mode: input.mode,
                message: immersiveFailureMessage(input.mode, cause),
                cause,
              }),
          }),
          (controller) => Effect.promise(() => controller.end()),
        ).pipe(
          Effect.tap((controller) => Effect.sync(() => input.onReady(controller))),
          Effect.flatMap((controller) =>
            Effect.tryPromise({
              try: () => controller.finished,
              catch: (cause) =>
                new ImmersivePreviewError({
                  mode: input.mode,
                  message: "The immersive preview ended unexpectedly.",
                  cause,
                }),
            }),
          ),
        ),
      ),
  };
}

function startImmersivePreview(input: ImmersivePreviewRendererInput): Promise<ImmersivePreviewController> {
  if (rendererModule) return rendererModule.startImmersivePreviewRenderer(input);
  return loadRendererModule().then((renderer) => renderer.startImmersivePreviewRenderer(input));
}

async function preloadImmersivePreviewRenderer(): Promise<void> {
  await loadRendererModule();
}

function loadRendererModule(): Promise<ImmersiveRendererModule> {
  rendererModulePromise ??= import("./immersive-preview-renderer.js").then((loaded) => {
    rendererModule = loaded;
    return loaded;
  });
  return rendererModulePromise;
}

export async function detectImmersiveCapabilities(): Promise<ImmersiveCapabilities> {
  const secureContext = globalThis.isSecureContext === true;
  const orientation = typeof globalThis.DeviceOrientationEvent !== "undefined";
  const xr = globalThis.navigator?.xr;
  if (!secureContext || !xr) {
    return { secureContext, lookaround: true, orientation, vr: false, ar: false };
  }
  const [vr, ar] = await Promise.all([
    xr.isSessionSupported("immersive-vr").catch(() => false),
    xr.isSessionSupported("immersive-ar").catch(() => false),
  ]);
  return { secureContext, lookaround: true, orientation, vr, ar };
}

/** Must be invoked directly from the activation gesture on browsers that gate orientation access. */
export function requestLookaroundOrientationPermission(): Promise<OrientationPermissionState> {
  if (typeof window === "undefined" || !("DeviceOrientationEvent" in window)) {
    return Promise.resolve("unavailable");
  }
  const constructor = window.DeviceOrientationEvent as DeviceOrientationConstructor;
  if (!constructor.requestPermission) return Promise.resolve("granted");
  return constructor.requestPermission().catch(() => "denied");
}

function immersiveFailureMessage(mode: ImmersivePreviewMode, cause: unknown): string {
  const detail = cause instanceof Error ? cause.message : String(cause);
  if (mode === "immersive-vr") return `Could not enter VR. ${detail}`;
  if (mode === "immersive-ar") return `Could not enter AR. ${detail}`;
  return `Could not open Phone Lookaround. ${detail}`;
}
