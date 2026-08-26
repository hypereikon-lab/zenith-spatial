import { Clock, Context, Data, Effect, Layer, Stream, SubscriptionRef } from "effect";

import { createInitialZenithDocument } from "../domain/project.js";
import type { GenerationInput, GenerationJob, ZenithDocument } from "../domain/schema.js";
import { decodeSchemaSync, GenerationJobSchema, ZenithDocumentSchema } from "../domain/schema.js";
import { IdGenerator } from "./id-service.js";

export type WorkbenchEnvironment = {
  readonly browser: boolean;
  readonly webgpu: boolean;
  readonly generationConfigured: boolean | null;
  readonly checkedAt: string | null;
};

export type WorkbenchNotice = {
  readonly id: string;
  readonly level: "info" | "error";
  readonly message: string;
  readonly scope: string;
  readonly createdAt: string;
};

export type PendingGenerationConfirmation = {
  readonly compositionId: string;
  readonly plateCommitId: string;
  readonly input: GenerationInput;
};

export type WorkbenchActivity = {
  readonly id: string;
  readonly label: string;
} | null;

export type WorkbenchSnapshot = {
  readonly document: ZenithDocument;
  readonly jobs: ReadonlyArray<GenerationJob>;
  readonly environment: WorkbenchEnvironment;
  readonly notices: ReadonlyArray<WorkbenchNotice>;
  readonly pendingGeneration: PendingGenerationConfirmation | null;
  readonly activity: WorkbenchActivity;
  readonly revision: number;
};

export class WorkbenchStateError extends Data.TaggedError("WorkbenchStateError")<{
  readonly message: string;
  readonly cause?: unknown;
}> {}

export interface WorkbenchServiceShape {
  readonly ref: SubscriptionRef.SubscriptionRef<WorkbenchSnapshot>;
  readonly changes: Stream.Stream<WorkbenchSnapshot>;
  readonly getSnapshot: () => WorkbenchSnapshot;
  readonly subscribe: (listener: () => void) => () => void;
  readonly update: (
    transform: (snapshot: WorkbenchSnapshot) => WorkbenchSnapshot,
  ) => Effect.Effect<WorkbenchSnapshot, WorkbenchStateError>;
  readonly updateDocument: (
    transform: (document: ZenithDocument) => ZenithDocument,
  ) => Effect.Effect<ZenithDocument, WorkbenchStateError>;
  readonly replaceDocument: (document: ZenithDocument) => Effect.Effect<void, WorkbenchStateError>;
  readonly upsertJob: (job: GenerationJob) => Effect.Effect<void, WorkbenchStateError>;
  readonly setEnvironment: (environment: Partial<WorkbenchEnvironment>) => Effect.Effect<void, WorkbenchStateError>;
  readonly setPendingGeneration: (
    pending: PendingGenerationConfirmation | null,
  ) => Effect.Effect<void, WorkbenchStateError>;
  readonly setActivity: (activity: WorkbenchActivity) => Effect.Effect<void, WorkbenchStateError>;
  readonly notice: (
    level: WorkbenchNotice["level"],
    message: string,
    scope: string,
  ) => Effect.Effect<void, WorkbenchStateError>;
}

export class WorkbenchService extends Context.Tag("zenith/WorkbenchService")<
  WorkbenchService,
  WorkbenchServiceShape
>() {
  static readonly Live = Layer.effect(
    WorkbenchService,
    Effect.gen(function* () {
      const now = new Date(yield* Clock.currentTimeMillis).toISOString();
      const ids = yield* IdGenerator;
      const projectId = yield* ids.next("project");
      return yield* makeWorkbenchService(createInitialZenithDocument({ now, projectId }));
    }),
  );

  static fromDocument(initialDocument: ZenithDocument) {
    return Layer.effect(WorkbenchService, makeWorkbenchService(initialDocument));
  }
}

function makeWorkbenchService(initialDocument: ZenithDocument): Effect.Effect<WorkbenchServiceShape> {
  return Effect.gen(function* () {
    let current: WorkbenchSnapshot = {
      document: decodeSchemaSync(ZenithDocumentSchema, initialDocument),
      jobs: [],
      environment: {
        browser: typeof globalThis.document !== "undefined" && typeof globalThis.navigator !== "undefined",
        webgpu: typeof globalThis.navigator !== "undefined" && Boolean(globalThis.navigator.gpu),
        generationConfigured: null,
        checkedAt: null,
      },
      notices: [],
      pendingGeneration: null,
      activity: null,
      revision: 0,
    };
    const ref = yield* SubscriptionRef.make(current);
    const listeners = new Set<() => void>();

    const update: WorkbenchServiceShape["update"] = (transform) =>
      SubscriptionRef.modifyEffect(ref, (snapshot) =>
        Effect.try({
          try: () => {
            const next = transform(snapshot);
            return [next, next] as const;
          },
          catch: (cause) => new WorkbenchStateError({ message: "Workbench state transition failed.", cause }),
        }),
      ).pipe(
        Effect.tap((next) =>
          Effect.sync(() => {
            current = next;
            for (const listener of listeners) listener();
          }),
        ),
      );

    const updateDocument: WorkbenchServiceShape["updateDocument"] = (transform) =>
      update((snapshot) => {
        const nextDocument = decodeSchemaSync(ZenithDocumentSchema, transform(snapshot.document));
        return { ...snapshot, document: nextDocument, revision: snapshot.revision + 1 };
      }).pipe(Effect.map((snapshot) => snapshot.document));

    return {
      ref,
      changes: ref.changes,
      getSnapshot: () => current,
      subscribe(listener) {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
      update,
      updateDocument,
      replaceDocument: (nextDocument) =>
        update((snapshot) => ({
          ...snapshot,
          document: decodeSchemaSync(ZenithDocumentSchema, nextDocument),
          pendingGeneration: null,
          activity: null,
          revision: snapshot.revision + 1,
        })).pipe(Effect.asVoid),
      upsertJob: (job) =>
        update((snapshot) => {
          const parsed = decodeSchemaSync(GenerationJobSchema, job);
          const index = snapshot.jobs.findIndex((candidate) => candidate.id === parsed.id);
          const jobs = [...snapshot.jobs];
          if (index >= 0) jobs[index] = parsed;
          else jobs.unshift(parsed);
          return { ...snapshot, jobs, revision: snapshot.revision + 1 };
        }).pipe(Effect.asVoid),
      setEnvironment: (environment) =>
        update((snapshot) => ({
          ...snapshot,
          environment: { ...snapshot.environment, ...environment },
          revision: snapshot.revision + 1,
        })).pipe(Effect.asVoid),
      setPendingGeneration: (pendingGeneration) =>
        update((snapshot) => ({ ...snapshot, pendingGeneration, revision: snapshot.revision + 1 })).pipe(Effect.asVoid),
      setActivity: (activity) =>
        update((snapshot) => ({ ...snapshot, activity, revision: snapshot.revision + 1 })).pipe(Effect.asVoid),
      notice: (level, message, scope) =>
        Effect.gen(function* () {
          const createdAt = new Date(yield* Clock.currentTimeMillis).toISOString();
          yield* update((snapshot) => ({
            ...snapshot,
            notices: [
              { id: `notice-${createdAt}-${snapshot.revision}`, level, message, scope, createdAt },
              ...snapshot.notices,
            ].slice(0, 6),
            revision: snapshot.revision + 1,
          }));
        }),
    };
  });
}
