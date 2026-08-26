import { Clock, Context, Effect, Layer, Ref } from "effect";

import type { PaidConfirmationGrant } from "../src/domain/schema.js";
import { IdGenerator } from "../src/runtime/id-service.js";
import { confirmationRejected } from "./errors.js";

const GRANT_TTL_MS = 5 * 60 * 1_000;
const MAX_GRANTS = 256;

type GrantRecord = {
  readonly projectId: string;
  readonly inputDigest: string;
  readonly expiresAt: number;
};

export interface PaidConfirmationServiceShape {
  readonly issue: (projectId: string, inputDigest: string) => Effect.Effect<PaidConfirmationGrant>;
  readonly consume: (
    projectId: string,
    inputDigest: string,
    grant: string,
  ) => Effect.Effect<void, ReturnType<typeof confirmationRejected>>;
}

export class PaidConfirmationService extends Context.Tag("zenith/server/PaidConfirmation")<
  PaidConfirmationService,
  PaidConfirmationServiceShape
>() {
  static readonly Live = Layer.effect(
    PaidConfirmationService,
    Effect.gen(function* () {
      const grants = yield* Ref.make(new Map<string, GrantRecord>());
      const ids = yield* IdGenerator;

      const prune = (now: number) =>
        Ref.update(grants, (current) => {
          const next = new Map(current);
          for (const [token, record] of next) if (record.expiresAt <= now) next.delete(token);
          while (next.size >= MAX_GRANTS) {
            const oldest = next.keys().next().value as string | undefined;
            if (!oldest) break;
            next.delete(oldest);
          }
          return next;
        });

      return {
        issue: (projectId, inputDigest) =>
          Effect.gen(function* () {
            const now = yield* Clock.currentTimeMillis;
            yield* prune(now);
            const first = yield* ids.next("grant");
            const second = yield* ids.next("nonce");
            const grant = `${first}.${second}`;
            const expiresAt = now + GRANT_TTL_MS;
            yield* Ref.update(grants, (current) => new Map(current).set(grant, { projectId, inputDigest, expiresAt }));
            return { grant, inputDigest, expiresAt: new Date(expiresAt).toISOString() };
          }),
        consume: (projectId, inputDigest, grant) =>
          Effect.gen(function* () {
            const now = yield* Clock.currentTimeMillis;
            yield* prune(now);
            const accepted = yield* Ref.modify(grants, (current) => {
              const record = current.get(grant);
              if (!record) return [false, current] as const;
              const next = new Map(current);
              next.delete(grant);
              return [
                record.projectId === projectId && record.inputDigest === inputDigest && record.expiresAt > now,
                next,
              ] as const;
            });
            if (!accepted) {
              return yield* Effect.fail(
                confirmationRejected("A fresh matching confirmation is required before this paid job can start."),
              );
            }
          }),
      } satisfies PaidConfirmationServiceShape;
    }),
  );
}
