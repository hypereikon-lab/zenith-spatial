import { Effect } from "effect";
import { describe, expect, it } from "vitest";

import type { MediaAsset } from "../domain/schema.js";
import { MediaRepository } from "./media-repository.js";

const asset: MediaAsset = {
  id: "asset-1",
  kind: "image",
  filename: "plate.png",
  mime: "image/png",
  width: 8,
  height: 8,
  storageRef: "media:asset-1",
  createdAt: "2026-01-01T00:00:00.000Z",
};

describe("MediaRepository", () => {
  it("owns object URLs and revokes them when its Effect scope closes", async () => {
    const revoked: string[] = [];
    let created = 0;
    const layer = MediaRepository.test({
      createObjectUrl: () => `blob:zenith-${++created}`,
      revokeObjectUrl: (url) => revoked.push(url),
    });

    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const repository = yield* MediaRepository;
          yield* repository.put(asset.id, { blob: new Blob(["pixels"], { type: "image/png" }) });
          expect(yield* repository.resolveUrl(asset)).toBe("blob:zenith-1");
          expect(yield* repository.ids).toEqual([asset.id]);
        }).pipe(Effect.provide(layer)),
      ),
    );

    expect(revoked).toEqual(["blob:zenith-1"]);
  });

  it("refuses a portable media reference whose runtime bytes are missing", async () => {
    const result = await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const repository = yield* MediaRepository;
          return yield* Effect.either(repository.readBlob(asset));
        }).pipe(Effect.provide(MediaRepository.test())),
      ),
    );

    expect(result._tag).toBe("Left");
    if (result._tag === "Left") expect(result.left.operation).toBe("read");
  });
});
