import { Context, Data, Effect, Layer } from "effect";

import type {
  ImmersivePreviewController,
  ImmersivePreviewMode,
  ImmersivePreviewRendererInput,
} from "./immersive-preview-renderer.js";

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
      capabilities: Effect.succeed(capabilities),
      run: () => Effect.void,
    });
  }
}

export function makeImmersivePreviewService({
  detect = detectImmersiveCapabilities,
  start = startImmersivePreview,
}: {
  detect?: () => Promise<ImmersiveCapabilities>;
  start?: (input: ImmersivePreviewRendererInput) => Promise<ImmersivePreviewController>;
} = {}): ImmersivePreviewServiceShape {
  return {
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

async function startImmersivePreview(input: ImmersivePreviewRendererInput): Promise<ImmersivePreviewController> {
  const { startImmersivePreviewRenderer } = await import("./immersive-preview-renderer.js");
  return startImmersivePreviewRenderer(input);
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

function immersiveFailureMessage(mode: ImmersivePreviewMode, cause: unknown): string {
  const detail = cause instanceof Error ? cause.message : String(cause);
  if (mode === "immersive-vr") return `Could not enter VR. ${detail}`;
  if (mode === "immersive-ar") return `Could not enter AR. ${detail}`;
  return `Could not open Phone Lookaround. ${detail}`;
}
