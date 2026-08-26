import { Chunk, Clock, Context, Effect, FiberMap, Layer, Ref, Stream, SubscriptionRef } from "effect";

import type {
  DurableJobJournal,
  GenerationInput,
  GenerationJob,
  GenerationJobEvent,
  GenerationServiceStatus,
  PublicJobError,
} from "../src/domain/schema.js";
import { nextEventSequence, terminalGenerationJob } from "../src/domain/schema.js";
import { IdGenerator } from "../src/runtime/id-service.js";
import { notFound, publicJobError, serverFailure, type ZenithServerError } from "./errors.js";
import { GenerationProvider, type ProviderOutput } from "./generation-provider.js";
import { GenerationRepository, type StoredGenerationOutput } from "./generation-repository.js";

type JobEntry = {
  readonly journal: SubscriptionRef.SubscriptionRef<DurableJobJournal>;
};

type JobMutation = (
  journal: DurableJobJournal,
  now: string,
) => {
  readonly job: GenerationJob;
  readonly type: GenerationJobEvent["type"];
} | null;

export interface GenerationJobServiceShape {
  readonly status: GenerationServiceStatus;
  readonly create: (projectId: string, input: GenerationInput) => Effect.Effect<GenerationJob, ZenithServerError>;
  readonly get: (jobId: string) => Effect.Effect<GenerationJob, ZenithServerError>;
  readonly list: (projectId: string) => Effect.Effect<ReadonlyArray<GenerationJob>, ZenithServerError>;
  readonly events: (jobId: string) => Stream.Stream<GenerationJobEvent, ZenithServerError>;
  readonly cancel: (jobId: string) => Effect.Effect<GenerationJob, ZenithServerError>;
  readonly output: (jobId: string, outputId: string) => Effect.Effect<StoredGenerationOutput, ZenithServerError>;
}

export class GenerationJobService extends Context.Tag("zenith/server/GenerationJobs")<
  GenerationJobService,
  GenerationJobServiceShape
>() {
  static readonly Live = Layer.scoped(
    GenerationJobService,
    Effect.gen(function* () {
      const repository = yield* GenerationRepository;
      const provider = yield* GenerationProvider;
      const ids = yield* IdGenerator;
      const entries = yield* Ref.make(new Map<string, JobEntry>());
      const workers = yield* FiberMap.make<string, void, never>();

      const loaded = yield* repository.load;
      for (const source of loaded) {
        const journal = terminalGenerationJob(source.job)
          ? source
          : yield* recoverInterruptedJournal(source, repository, ids);
        const reference = yield* SubscriptionRef.make(journal);
        yield* Ref.update(entries, (current) => new Map(current).set(journal.job.id, { journal: reference }));
      }

      const getEntry = (jobId: string) =>
        Ref.get(entries).pipe(
          Effect.flatMap((current) => {
            const entry = current.get(jobId);
            return entry ? Effect.succeed(entry) : Effect.fail(notFound("Generation job was not found."));
          }),
        );

      const transition = (jobId: string, mutation: JobMutation) =>
        Effect.gen(function* () {
          const entry = yield* getEntry(jobId);
          const now = new Date(yield* Clock.currentTimeMillis).toISOString();
          const eventId = yield* ids.next("job-event");
          return yield* SubscriptionRef.modifyEffect(entry.journal, (journal) => {
            const result = mutation(journal, now);
            if (!result) return Effect.succeed([journal.job, journal] as const);
            const event: GenerationJobEvent = {
              version: 1,
              id: eventId,
              jobId,
              sequence: nextEventSequence(journal.events),
              type: result.type,
              status: result.job.status,
              stage: result.job.stage,
              progress: result.job.progress,
              createdAt: now,
              job: structuredClone(result.job),
            };
            const next: DurableJobJournal = {
              ...journal,
              job: result.job,
              events: [...journal.events, event],
            };
            return repository.save(next).pipe(Effect.as([result.job, next] as const));
          });
        });

      const markCancelled = (jobId: string) =>
        transition(jobId, (journal, now) => {
          if (terminalGenerationJob(journal.job)) return null;
          return {
            type: "cancelled",
            job: {
              ...journal.job,
              status: "cancelled",
              stage: "Cancelled",
              progress: journal.job.progress,
              finishedAt: now,
              error: {
                message: "Generation was cancelled.",
                status: 499,
                code: "cancelled",
                provider: "zenith",
              },
            },
          };
        });

      const markFailed = (jobId: string, error: PublicJobError) =>
        transition(jobId, (journal, now) => {
          if (terminalGenerationJob(journal.job)) return null;
          const cancelled = error.code === "cancelled";
          return {
            type: cancelled ? "cancelled" : "error",
            job: {
              ...journal.job,
              status: cancelled ? "cancelled" : "failed",
              stage: cancelled ? "Cancelled" : "Failed",
              progress: journal.job.progress,
              finishedAt: now,
              error,
            },
          };
        });

      const runJob = (jobId: string) =>
        Effect.gen(function* () {
          const entry = yield* getEntry(jobId);
          const journal = yield* SubscriptionRef.get(entry.journal);
          yield* transition(jobId, (current, now) => {
            if (terminalGenerationJob(current.job)) return null;
            return {
              type: "started",
              job: {
                ...current.job,
                status: "running",
                stage: "Starting provider",
                progress: Math.max(current.job.progress, 0.01),
                startedAt: current.job.startedAt ?? now,
              },
            };
          });
          const outputs: ProviderOutput[] = [];
          yield* provider.generate(journal.input).pipe(
            Stream.runForEach((event) => {
              if (event.type === "output") {
                outputs.push(event);
                return Effect.void;
              }
              return transition(jobId, (current, now) => {
                if (terminalGenerationJob(current.job)) return null;
                return {
                  type: "progress",
                  job: {
                    ...current.job,
                    status: "running",
                    stage: event.stage || "Generating",
                    progress: clampProgress(event.progress),
                    startedAt: current.job.startedAt ?? now,
                  },
                };
              }).pipe(Effect.asVoid);
            }),
          );
          if (outputs.length === 0) {
            return yield* Effect.fail(serverFailure("The provider completed without an image output."));
          }
          const stored = yield* Effect.forEach(
            outputs,
            (output, index) => repository.storeOutput(jobId, index, output, journal.input.provenance),
            { concurrency: 1 },
          );
          yield* transition(jobId, (current, now) => {
            if (terminalGenerationJob(current.job)) return null;
            return {
              type: "complete",
              job: {
                ...current.job,
                status: "succeeded",
                stage: "Complete",
                progress: 1,
                finishedAt: now,
                outputs: stored,
              },
            };
          });
        }).pipe(
          Effect.catchAll((error) =>
            markFailed(jobId, publicJobError(error)).pipe(
              Effect.catchAll(() => Effect.void),
              Effect.asVoid,
            ),
          ),
          Effect.onInterrupt(() => markCancelled(jobId).pipe(Effect.ignore)),
          Effect.asVoid,
        );

      return {
        status: provider.status,
        create: (projectId, input) =>
          Effect.gen(function* () {
            const jobId = yield* ids.next("generation-job");
            const eventId = yield* ids.next("job-event");
            const now = new Date(yield* Clock.currentTimeMillis).toISOString();
            const job: GenerationJob = {
              version: 1,
              id: jobId,
              projectId,
              compositionId: input.provenance.compositionId,
              plateCommitId: input.provenance.plateCommitId,
              status: "queued",
              stage: "Queued",
              progress: 0,
              createdAt: now,
              provenance: structuredClone(input.provenance),
              direction: input.direction,
              strategy: input.strategy,
              prompt: input.prompt,
              model: input.model,
              outputs: [],
            };
            const queued: GenerationJobEvent = {
              version: 1,
              id: eventId,
              jobId,
              sequence: 1,
              type: "queued",
              status: "queued",
              stage: "Queued",
              progress: 0,
              createdAt: now,
              job: structuredClone(job),
            };
            const journal: DurableJobJournal = { job, events: [queued], input };
            yield* repository.save(journal);
            const reference = yield* SubscriptionRef.make(journal);
            yield* Ref.update(entries, (current) => new Map(current).set(jobId, { journal: reference }));
            yield* FiberMap.run(workers, jobId, runJob(jobId));
            return job;
          }),
        get: (jobId) =>
          getEntry(jobId).pipe(
            Effect.flatMap((entry) => SubscriptionRef.get(entry.journal)),
            Effect.map((journal) => journal.job),
          ),
        list: (projectId) =>
          Effect.gen(function* () {
            const current = yield* Ref.get(entries);
            const journals = yield* Effect.forEach(current.values(), (entry) => SubscriptionRef.get(entry.journal), {
              concurrency: 16,
            });
            return journals
              .map((journal) => journal.job)
              .filter((job) => job.projectId === projectId)
              .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
          }),
        events: (jobId) =>
          Stream.unwrap(
            getEntry(jobId).pipe(
              Effect.map((entry) =>
                entry.journal.changes.pipe(
                  Stream.mapAccum(0, (lastSequence, journal) => {
                    const fresh = journal.events.filter((event) => event.sequence > lastSequence);
                    const nextSequence = fresh.at(-1)?.sequence ?? lastSequence;
                    return [nextSequence, Chunk.fromIterable(fresh)] as const;
                  }),
                  Stream.flattenChunks,
                  Stream.takeUntil((event) => terminalGenerationJob(event.job)),
                ),
              ),
            ),
          ),
        cancel: (jobId) =>
          Effect.gen(function* () {
            const job = yield* markCancelled(jobId);
            yield* FiberMap.remove(workers, jobId);
            return job;
          }),
        output: (jobId, outputId) =>
          Effect.gen(function* () {
            const entry = yield* getEntry(jobId);
            const journal = yield* SubscriptionRef.get(entry.journal);
            const descriptor = journal.job.outputs.find((output) => output.id === outputId);
            if (!descriptor) {
              return yield* Effect.fail(notFound("Generated output was not found."));
            }
            return yield* repository.readOutput(jobId, descriptor);
          }),
      } satisfies GenerationJobServiceShape;
    }),
  );
}

function recoverInterruptedJournal(
  journal: DurableJobJournal,
  repository: GenerationRepository["Type"],
  ids: IdGenerator["Type"],
) {
  return Effect.gen(function* () {
    const now = new Date(yield* Clock.currentTimeMillis).toISOString();
    const job: GenerationJob = {
      ...journal.job,
      status: "failed",
      stage: "Interrupted by server restart",
      finishedAt: now,
      error: {
        message: "Generation was interrupted by a local server restart. Start a new confirmed job.",
        status: 500,
        code: "server_error",
        provider: "zenith",
      },
    };
    const event: GenerationJobEvent = {
      version: 1,
      id: yield* ids.next("job-event"),
      jobId: job.id,
      sequence: nextEventSequence(journal.events),
      type: "error",
      status: "failed",
      stage: job.stage,
      progress: job.progress,
      createdAt: now,
      job: structuredClone(job),
    };
    const recovered = { ...journal, job, events: [...journal.events, event] };
    yield* repository.save(recovered);
    return recovered;
  });
}

function clampProgress(value: number): number {
  return Math.max(0, Math.min(0.999, Number.isFinite(value) ? value : 0));
}
