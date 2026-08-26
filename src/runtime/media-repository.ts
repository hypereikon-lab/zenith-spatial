import { Context, Data, Effect, Layer } from "effect";

import { canvasToBlob } from "../media/canvas-utils.js";
import type { MediaAsset } from "../domain/schema.js";

export type RuntimeMediaHandle = {
  readonly blob?: Blob | null;
  readonly file?: File | null;
  readonly canvas?: HTMLCanvasElement | null;
  readonly objectUrl?: string | null;
};

type OwnedMediaHandle = {
  blob: Blob | null;
  file: File | null;
  canvas: HTMLCanvasElement | null;
  objectUrl: string | null;
};

export class MediaRepositoryError extends Data.TaggedError("MediaRepositoryError")<{
  readonly operation: "put" | "read" | "resolve" | "remove";
  readonly assetId: string;
  readonly message: string;
  readonly cause?: unknown;
}> {}

export interface MediaRepositoryService {
  readonly put: (assetId: string, handle: RuntimeMediaHandle) => Effect.Effect<void, MediaRepositoryError>;
  readonly get: (assetId: string) => Effect.Effect<RuntimeMediaHandle | null>;
  readonly resolveUrl: (asset: MediaAsset) => Effect.Effect<string, MediaRepositoryError>;
  readonly readBlob: (asset: MediaAsset) => Effect.Effect<Blob, MediaRepositoryError>;
  readonly remove: (assetId: string) => Effect.Effect<void>;
  readonly clear: Effect.Effect<void>;
  readonly ids: Effect.Effect<ReadonlyArray<string>>;
}

export class MediaRepository extends Context.Tag("zenith/MediaRepository")<MediaRepository, MediaRepositoryService>() {
  static readonly Live = Layer.scoped(
    MediaRepository,
    Effect.acquireRelease(Effect.sync(makeMediaRepository), (repository) => repository.clear),
  );

  static test({
    createObjectUrl,
    revokeObjectUrl,
    fetchSource,
  }: {
    createObjectUrl?: (blob: Blob) => string;
    revokeObjectUrl?: (url: string) => void;
    fetchSource?: typeof fetch;
  } = {}) {
    return Layer.scoped(
      MediaRepository,
      Effect.acquireRelease(
        Effect.sync(() => makeMediaRepository({ createObjectUrl, revokeObjectUrl, fetchSource })),
        (repository) => repository.clear,
      ),
    );
  }
}

function makeMediaRepository({
  createObjectUrl = defaultCreateObjectUrl,
  revokeObjectUrl = defaultRevokeObjectUrl,
  fetchSource = globalThis.fetch,
}: {
  createObjectUrl?: (blob: Blob) => string;
  revokeObjectUrl?: (url: string) => void;
  fetchSource?: typeof fetch;
} = {}): MediaRepositoryService {
  const handles = new Map<string, OwnedMediaHandle>();

  const put = (assetId: string, handle: RuntimeMediaHandle) =>
    Effect.try({
      try: () => {
        const previous = handles.get(assetId);
        const blob = handle.blob ?? handle.file ?? null;
        const objectUrl = handle.objectUrl ?? (blob ? createObjectUrl(blob) : null);
        const next: OwnedMediaHandle = {
          blob,
          file: handle.file ?? null,
          canvas: handle.canvas ?? null,
          objectUrl,
        };
        releaseHandle(previous, objectUrl, revokeObjectUrl);
        handles.set(assetId, next);
      },
      catch: (cause) =>
        new MediaRepositoryError({
          operation: "put",
          assetId,
          message: `Could not retain runtime media for ${assetId}.`,
          cause,
        }),
    });

  const get = (assetId: string) =>
    Effect.sync((): RuntimeMediaHandle | null => {
      const handle = handles.get(assetId);
      return handle ? { ...handle } : null;
    });

  const resolveUrl = (asset: MediaAsset) =>
    Effect.gen(function* () {
      const handle = handles.get(asset.id);
      if (handle?.objectUrl) return handle.objectUrl;
      if (!asset.storageRef.startsWith("media:")) return asset.storageRef;
      if (handle?.blob) {
        const objectUrl = createObjectUrl(handle.blob);
        handle.objectUrl = objectUrl;
        return objectUrl;
      }
      return yield* Effect.fail(
        new MediaRepositoryError({
          operation: "resolve",
          assetId: asset.id,
          message: `${asset.filename} has no readable runtime URL.`,
        }),
      );
    });

  const readBlob = (asset: MediaAsset) =>
    Effect.gen(function* () {
      const handle = handles.get(asset.id);
      if (handle?.blob) return handle.blob;
      if (handle?.file) return handle.file;
      if (handle?.canvas) {
        return yield* Effect.tryPromise({
          try: () => canvasToBlob(handle.canvas!, asset.mime),
          catch: (cause) =>
            new MediaRepositoryError({
              operation: "read",
              assetId: asset.id,
              message: `Could not encode ${asset.filename}.`,
              cause,
            }),
        });
      }
      if (asset.storageRef.startsWith("media:")) {
        return yield* Effect.fail(
          new MediaRepositoryError({
            operation: "read",
            assetId: asset.id,
            message: `${asset.filename} is missing its runtime media bytes.`,
          }),
        );
      }
      if (!fetchSource) {
        return yield* Effect.fail(
          new MediaRepositoryError({
            operation: "read",
            assetId: asset.id,
            message: "Fetch is unavailable for portable media.",
          }),
        );
      }
      return yield* Effect.tryPromise({
        try: async (signal) => {
          const response = await fetchSource(asset.storageRef, { signal });
          if (!response.ok) throw new Error(`HTTP ${response.status}`);
          return response.blob();
        },
        catch: (cause) =>
          new MediaRepositoryError({
            operation: "read",
            assetId: asset.id,
            message: `Could not read ${asset.filename}.`,
            cause,
          }),
      });
    });

  const remove = (assetId: string) =>
    Effect.sync(() => {
      releaseHandle(handles.get(assetId), null, revokeObjectUrl);
      handles.delete(assetId);
    });

  const clear = Effect.sync(() => {
    for (const handle of handles.values()) releaseHandle(handle, null, revokeObjectUrl);
    handles.clear();
  });

  return {
    put,
    get,
    resolveUrl,
    readBlob,
    remove,
    clear,
    ids: Effect.sync(() => [...handles.keys()]),
  };
}

function releaseHandle(
  handle: OwnedMediaHandle | undefined,
  replacementUrl: string | null,
  revokeObjectUrl: (url: string) => void,
): void {
  if (!handle) return;
  if (handle.objectUrl?.startsWith("blob:") && handle.objectUrl !== replacementUrl) {
    revokeObjectUrl(handle.objectUrl);
  }
  if (handle.canvas) {
    handle.canvas.width = 0;
    handle.canvas.height = 0;
  }
}

function defaultCreateObjectUrl(blob: Blob): string {
  if (typeof URL === "undefined" || typeof URL.createObjectURL !== "function") {
    throw new Error("Object URLs are unavailable in this runtime.");
  }
  return URL.createObjectURL(blob);
}

function defaultRevokeObjectUrl(url: string): void {
  if (typeof URL !== "undefined" && typeof URL.revokeObjectURL === "function") URL.revokeObjectURL(url);
}
