import { HttpClient, HttpClientRequest, HttpServer } from "@effect/platform";
import { NodeHttpServer } from "@effect/platform-node";
import { Chunk, Effect, Layer, Stream } from "effect";
import { describe, expect, test } from "vitest";

import { defaultImageSpatialSpec, selectedComposition, createInitialZenithDocument } from "../src/domain/project.js";
import type { GenerationInput, GenerationJob } from "../src/domain/schema.js";
import { IdGenerator } from "../src/runtime/id-service.js";
import { zenithRouter } from "./api.js";
import { PaidConfirmationService } from "./confirmation-service.js";
import { ZenithServerConfig } from "./config.js";
import { GenerationJobService } from "./generation-job-service.js";
import { GenerationProvider, type ProviderEvent } from "./generation-provider.js";
import { GenerationRepository } from "./generation-repository.js";
import { serverGenerationInputDigest } from "./generation-validation.js";

describe("Effect generation API", () => {
  test("rejects malformed and tampered paid input before the provider and prevents grant replay", async () => {
    let providerCalls = 0;
    const provider = GenerationProvider.test((_) => {
      providerCalls += 1;
      const events: ReadonlyArray<ProviderEvent> = [
        { type: "progress", stage: "Fake generation", progress: 0.5 },
        {
          type: "output",
          bytes: fakeJpeg(1920, 1920),
          contentType: "image/jpeg",
          filename: "fake.jpg",
        },
      ];
      return Stream.fromIterable(events);
    });
    const layers = testLayers(provider);

    await Effect.runPromise(
      Effect.gen(function* () {
        yield* HttpServer.serveEffect(zenithRouter);
        const malformed = yield* request("/api/projects/project-test/jobs", {
          version: 1,
          broken: true,
        });
        expect(malformed.status).toBe(400);
        expect(providerCalls).toBe(0);

        const input = validInput();
        const confirmation = yield* request("/api/projects/project-test/paid-confirmations", {
          version: 1,
          action: "generate-image",
          inputDigest: input.provenance.inputDigest,
        });
        expect(confirmation.status).toBe(201);
        const grant = (yield* confirmation.json) as { grant: string };

        const tampered = structuredClone(input);
        tampered.direction = "tampered after confirmation";
        const rejected = yield* request("/api/projects/project-test/jobs", {
          version: 1,
          action: "generate-image",
          confirmationGrant: grant.grant,
          input: tampered,
        });
        expect(rejected.status).toBe(400);
        expect(providerCalls).toBe(0);

        const accepted = yield* request("/api/projects/project-test/jobs", {
          version: 1,
          action: "generate-image",
          confirmationGrant: grant.grant,
          input,
        });
        expect(accepted.status).toBe(202);
        const acceptedJob = (yield* accepted.json) as GenerationJob;
        yield* Effect.sleep("10 millis");
        expect(providerCalls).toBe(1);

        const completedResponse = yield* getRequest(`/api/jobs/${encodeURIComponent(acceptedJob.id)}`);
        expect(completedResponse.status).toBe(200);
        const completed = (yield* completedResponse.json) as GenerationJob;
        expect(completed.status).toBe("succeeded");
        expect(completed.outputs).toHaveLength(1);
        const outputResponse = yield* getRequest(completed.outputs[0]!.url);
        expect(outputResponse.status).toBe(200);
        expect(outputResponse.headers["content-type"]).toContain("image/jpeg");
        expect(new Uint8Array(yield* outputResponse.arrayBuffer)).toEqual(fakeJpeg(1920, 1920));

        const replayed = yield* request("/api/projects/project-test/jobs", {
          version: 1,
          action: "generate-image",
          confirmationGrant: grant.grant,
          input,
        });
        expect(replayed.status).toBe(403);
        expect(providerCalls).toBe(1);
      }).pipe(Effect.provide(Layer.mergeAll(NodeHttpServer.layerTest, layers)), Effect.scoped),
    );
  });

  test("interrupts the provider fiber and projects a single cancelled terminal state", async () => {
    const layers = testLayers(GenerationProvider.test(() => Stream.never));
    await Effect.runPromise(
      Effect.gen(function* () {
        const jobs = yield* GenerationJobService;
        const job = yield* jobs.create("project-test", validInput());
        yield* Effect.sleep("5 millis");
        const cancelled = yield* jobs.cancel(job.id);
        expect(cancelled.status).toBe("cancelled");
        expect(cancelled.finishedAt).toBeTruthy();
        const events = yield* jobs.events(job.id).pipe(Stream.runCollect);
        expect(Chunk.toReadonlyArray(events).map((event) => event.type)).toEqual(["queued", "started", "cancelled"]);
        expect((yield* jobs.get(job.id)).status).toBe("cancelled");
      }).pipe(Effect.provide(layers), Effect.scoped),
    );
  });

  test("fails a job instead of attaching a provider output with the wrong raster", async () => {
    const provider = GenerationProvider.test(() =>
      Stream.succeed<ProviderEvent>({
        type: "output",
        bytes: fakeJpeg(960, 960),
        contentType: "image/jpeg",
        filename: "wrong-size.jpg",
      }),
    );
    await Effect.runPromise(
      Effect.gen(function* () {
        const jobs = yield* GenerationJobService;
        const job = yield* jobs.create("project-test", validInput());
        yield* Effect.sleep("10 millis");
        const completed = yield* jobs.get(job.id);
        expect(completed.status).toBe("failed");
        expect(completed.outputs).toEqual([]);
        expect(completed.error).toMatchObject({ code: "server_error", provider: "zenith" });
      }).pipe(Effect.provide(testLayers(provider)), Effect.scoped),
    );
  });
});

function testLayers(provider: Layer.Layer<GenerationProvider>) {
  const ids = IdGenerator.deterministic([]);
  const config = ZenithServerConfig.test({ runwayApiSecret: "test-secret" });
  const repository = GenerationRepository.Memory;
  const confirmations = PaidConfirmationService.Live.pipe(Layer.provide(ids));
  const jobs = GenerationJobService.Live.pipe(Layer.provide(Layer.mergeAll(repository, provider, ids)));
  return Layer.mergeAll(config, ids, repository, provider, confirmations, jobs);
}

function validInput(): GenerationInput {
  const document = createInitialZenithDocument({ projectId: "project-test", compositionId: "composition-test" });
  const draft = selectedComposition(document).plateDraft;
  let input: GenerationInput = {
    imageDataUrl: fakePngDataUrl(1920, 1920),
    prompt: "Preserve the committed carrier geometry and complete the spatial image.",
    direction: "Continue material and light coherently.",
    strategy: "strict",
    model: "gpt_image_2",
    ratio: draft.raster.aspectPreset,
    quality: "high",
    outputCount: 1,
    referenceImageTag: "plate_sketch",
    sourceReferences: [],
    provenance: {
      version: 2,
      projectId: "project-test",
      compositionId: "composition-test",
      plateCommitId: "plate-commit-test",
      inputDigest: "pending",
      model: "gpt_image_2",
      carrierRaster: structuredClone(draft.raster),
      spatialSpec: {
        ...defaultImageSpatialSpec(draft),
        sourceWidth: draft.raster.width,
        sourceHeight: draft.raster.height,
      },
    },
  };
  input = {
    ...input,
    provenance: { ...input.provenance, inputDigest: serverGenerationInputDigest(input) },
  };
  return input;
}

function request(url: string, body: unknown) {
  return Effect.gen(function* () {
    const client = yield* HttpClient.HttpClient;
    return yield* client.execute(
      HttpClientRequest.post(url).pipe(
        HttpClientRequest.setHeader("content-type", "application/json"),
        HttpClientRequest.bodyText(JSON.stringify(body)),
      ),
    );
  });
}

function getRequest(url: string) {
  return Effect.gen(function* () {
    const client = yield* HttpClient.HttpClient;
    return yield* client.execute(HttpClientRequest.get(url));
  });
}

function fakePngDataUrl(width: number, height: number): string {
  const bytes = Buffer.alloc(600);
  bytes.set([137, 80, 78, 71, 13, 10, 26, 10], 0);
  bytes.set([0, 0, 0, 13, 73, 72, 68, 82], 8);
  bytes.writeUInt32BE(width, 16);
  bytes.writeUInt32BE(height, 20);
  return `data:image/png;base64,${bytes.toString("base64")}`;
}

function fakeJpeg(width: number, height: number): Uint8Array {
  const bytes = new Uint8Array(21);
  bytes.set([0xff, 0xd8, 0xff, 0xc0, 0x00, 0x11, 0x08], 0);
  const view = new DataView(bytes.buffer);
  view.setUint16(7, height, false);
  view.setUint16(9, width, false);
  bytes.set([0x03, 0x01, 0x11, 0x00, 0x02, 0x11, 0x00, 0x03, 0x11, 0x00], 11);
  return bytes;
}
