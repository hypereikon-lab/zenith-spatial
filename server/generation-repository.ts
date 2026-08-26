import { FileSystem } from "@effect/platform";
import { Context, Effect, Layer } from "effect";
import * as Schema from "effect/Schema";
import { createHash, randomUUID } from "node:crypto";
import { join } from "node:path";

import type { DurableJobJournal, GenerationJobOutput, ImageGenerationProvenance } from "../src/domain/schema.js";
import { DurableJobJournalSchema } from "../src/domain/schema.js";
import { readImageByteDimensions } from "../src/media/image-byte-dimensions.js";
import { embedZenithPngProvenance } from "../src/media/png-zenith-provenance.js";
import { ZenithServerConfig } from "./config.js";
import { notFound, serverFailure, ZenithServerError } from "./errors.js";
import type { ProviderOutput } from "./generation-provider.js";

const SAFE_ID = /^[a-zA-Z0-9_-]{1,180}$/;

export type StoredGenerationOutput = {
  readonly descriptor: GenerationJobOutput;
  readonly bytes: Uint8Array;
};

export interface GenerationRepositoryShape {
  readonly load: Effect.Effect<ReadonlyArray<DurableJobJournal>, ZenithServerError>;
  readonly save: (journal: DurableJobJournal) => Effect.Effect<void, ZenithServerError>;
  readonly storeOutput: (
    jobId: string,
    index: number,
    output: ProviderOutput,
    provenance: ImageGenerationProvenance,
  ) => Effect.Effect<GenerationJobOutput, ZenithServerError>;
  readonly readOutput: (
    jobId: string,
    descriptor: GenerationJobOutput,
  ) => Effect.Effect<StoredGenerationOutput, ZenithServerError>;
}

export class GenerationRepository extends Context.Tag("zenith/server/GenerationRepository")<
  GenerationRepository,
  GenerationRepositoryShape
>() {
  static readonly Live = Layer.effect(
    GenerationRepository,
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const config = yield* ZenithServerConfig;
      const jobsDirectory = join(config.runtimeDirectory, "jobs");

      const ensureJobsDirectory = fs
        .makeDirectory(jobsDirectory, { recursive: true })
        .pipe(Effect.mapError((cause) => serverFailure("The local generation journal could not be created.", cause)));

      const save = (journal: DurableJobJournal) =>
        Effect.gen(function* () {
          assertSafeId(journal.job.id, "job");
          const parsed = yield* Schema.decodeUnknown(DurableJobJournalSchema)(journal, {
            onExcessProperty: "error",
          }).pipe(Effect.mapError((cause) => serverFailure("A generation journal failed validation.", cause)));
          const directory = jobDirectory(jobsDirectory, parsed.job.id);
          yield* fs.makeDirectory(directory, { recursive: true });
          const destination = join(directory, "journal.json");
          const temporary = `${destination}.${process.pid}-${randomUUID()}.tmp`;
          yield* fs.writeFileString(temporary, `${JSON.stringify(parsed)}\n`, { mode: 0o600 });
          yield* fs
            .rename(temporary, destination)
            .pipe(Effect.tapError(() => fs.remove(temporary).pipe(Effect.ignore)));
        }).pipe(Effect.mapError((cause) => serverFailure("The generation journal could not be saved.", cause)));

      return {
        load: Effect.gen(function* () {
          yield* ensureJobsDirectory;
          const entries = yield* fs.readDirectory(jobsDirectory);
          const loaded = yield* Effect.forEach(
            entries.filter((entry) => SAFE_ID.test(entry)).sort(),
            (jobId) =>
              fs.readFileString(join(jobDirectory(jobsDirectory, jobId), "journal.json")).pipe(
                Effect.flatMap((text) =>
                  Effect.try({
                    try: () => JSON.parse(text) as unknown,
                    catch: (cause) => serverFailure(`Generation journal ${jobId} is malformed.`, cause),
                  }),
                ),
                Effect.flatMap((value) =>
                  Schema.decodeUnknown(DurableJobJournalSchema)(value, { onExcessProperty: "error" }).pipe(
                    Effect.mapError((cause) => serverFailure(`Generation journal ${jobId} is invalid.`, cause)),
                  ),
                ),
                Effect.tapError((error) => Effect.logWarning(error.message)),
                Effect.option,
              ),
            { concurrency: 8 },
          );
          return loaded.flatMap((option) => (option._tag === "Some" ? [option.value] : []));
        }).pipe(Effect.mapError((cause) => serverFailure("Generation journals could not be loaded.", cause))),
        save,
        storeOutput: (jobId, index, output, provenance) =>
          Effect.gen(function* () {
            assertSafeId(jobId, "job");
            const prepared = yield* Effect.try({
              try: () => prepareOutput(jobId, index, output, provenance),
              catch: (cause) => serverFailure("Generated output failed exact-raster validation.", cause),
            });
            const directory = join(jobDirectory(jobsDirectory, jobId), "outputs");
            yield* fs.makeDirectory(directory, { recursive: true });
            const destination = join(directory, prepared.filenameOnDisk);
            const exists = yield* fs.exists(destination);
            if (!exists) {
              const temporary = `${destination}.${process.pid}-${randomUUID()}.tmp`;
              yield* fs.writeFile(temporary, prepared.bytes, { mode: 0o600 });
              yield* fs
                .rename(temporary, destination)
                .pipe(Effect.tapError(() => fs.remove(temporary).pipe(Effect.ignore)));
            }
            return prepared.descriptor;
          }).pipe(
            Effect.mapError((cause) =>
              cause instanceof ZenithServerError
                ? cause
                : serverFailure("A generated image output could not be stored.", cause),
            ),
          ),
        readOutput: (jobId, descriptor) =>
          Effect.gen(function* () {
            assertSafeId(jobId, "job");
            assertSafeId(descriptor.id, "output");
            const path = join(
              jobDirectory(jobsDirectory, jobId),
              "outputs",
              `${descriptor.id}.${extensionFor(descriptor.contentType)}`,
            );
            if (!(yield* fs.exists(path))) return yield* Effect.fail(notFound("Generated output is missing."));
            return { descriptor, bytes: yield* fs.readFile(path) };
          }).pipe(
            Effect.mapError((cause) =>
              cause instanceof ZenithServerError
                ? cause
                : serverFailure("The generated image output could not be read.", cause),
            ),
          ),
      } satisfies GenerationRepositoryShape;
    }),
  );

  static readonly Memory = Layer.sync(GenerationRepository, () => {
    const journals = new Map<string, DurableJobJournal>();
    const outputs = new Map<string, Uint8Array>();
    return {
      load: Effect.sync(() => [...journals.values()].map((journal) => structuredClone(journal))),
      save: (journal) =>
        Effect.sync(() => {
          journals.set(journal.job.id, structuredClone(journal));
        }),
      storeOutput: (jobId, index, output, provenance) =>
        Effect.try({
          try: () => {
            const prepared = prepareOutput(jobId, index, output, provenance);
            outputs.set(`${jobId}/${prepared.descriptor.id}`, prepared.bytes.slice());
            return prepared.descriptor;
          },
          catch: (cause) => serverFailure("Generated output failed exact-raster validation.", cause),
        }),
      readOutput: (jobId, descriptor) =>
        Effect.gen(function* () {
          const bytes = outputs.get(`${jobId}/${descriptor.id}`);
          if (!bytes) return yield* Effect.fail(notFound("Generated output is missing."));
          return { descriptor, bytes: bytes.slice() };
        }),
    } satisfies GenerationRepositoryShape;
  });
}

function prepareOutput(
  jobId: string,
  index: number,
  output: ProviderOutput,
  provenance: ImageGenerationProvenance,
): { readonly descriptor: GenerationJobOutput; readonly bytes: Uint8Array; readonly filenameOnDisk: string } {
  assertSafeId(jobId, "job");
  const contentType = normalizeContentType(output.contentType);
  const bytes = contentType === "image/png" ? embedZenithPngProvenance(output.bytes, provenance) : output.bytes.slice();
  const digest = createHash("sha256").update(bytes).digest("hex");
  const extension = extensionFor(contentType);
  const id = `output-${index + 1}-${digest.slice(0, 16)}`;
  const dimensions = readImageByteDimensions(bytes);
  if (!dimensions) throw new Error("The provider output is not a supported encoded image.");
  const expected = provenance.spatialSpec;
  if (dimensions.width !== expected.targetWidth || dimensions.height !== expected.targetHeight) {
    throw new Error(
      `The provider output is ${dimensions.width}×${dimensions.height}; the pinned carrier requires exactly ${expected.targetWidth}×${expected.targetHeight} pixels.`,
    );
  }
  const descriptor: GenerationJobOutput = {
    id,
    url: `/api/jobs/${encodeURIComponent(jobId)}/outputs/${encodeURIComponent(id)}`,
    contentType,
    filename: safeFilename(output.filename, `zenith-image-take-${index + 1}.${extension}`),
    width: dimensions.width,
    height: dimensions.height,
  };
  return { descriptor, bytes, filenameOnDisk: `${id}.${extension}` };
}

function jobDirectory(root: string, jobId: string): string {
  return join(root, jobId);
}

function assertSafeId(value: string, label: string): void {
  if (!SAFE_ID.test(value)) throw new Error(`Unsafe ${label} id.`);
}

function normalizeContentType(value: string): string {
  const type = value.split(";")[0]!.trim().toLowerCase();
  return /^image\/[a-z0-9.+-]+$/.test(type) ? type : "application/octet-stream";
}

function extensionFor(contentType: string): string {
  if (contentType === "image/png") return "png";
  if (contentType === "image/jpeg") return "jpg";
  if (contentType === "image/webp") return "webp";
  return "bin";
}

function safeFilename(value: string, fallback: string): string {
  return (
    value
      .split(/[\\/]/)
      .pop()
      ?.replace(/[^a-zA-Z0-9_.-]+/g, "-")
      .slice(0, 180) || fallback
  );
}
