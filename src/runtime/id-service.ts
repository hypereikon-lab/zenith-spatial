import { Clock, Context, Effect, Layer, Random } from "effect";

export interface IdGeneratorService {
  readonly next: (prefix: string) => Effect.Effect<string>;
}

export class IdGenerator extends Context.Tag("zenith/IdGenerator")<IdGenerator, IdGeneratorService>() {
  static readonly Live = Layer.succeed(IdGenerator, {
    next: (prefix) =>
      Effect.gen(function* () {
        const timestamp = yield* Clock.currentTimeMillis;
        const random = yield* Random.nextIntBetween(0, 0x7fffffff);
        const uuid = globalThis.crypto?.randomUUID?.();
        return `${prefix}-${uuid ?? `${timestamp.toString(36)}-${random.toString(36)}`}`;
      }),
  });

  static deterministic(ids: ReadonlyArray<string>) {
    let index = 0;
    return Layer.succeed(IdGenerator, {
      next: (prefix) =>
        Effect.sync(() => {
          const id = ids[index++];
          return id ?? `${prefix}-test-${index}`;
        }),
    });
  }
}
