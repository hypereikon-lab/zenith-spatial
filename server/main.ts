import { HttpServer } from "@effect/platform";
import { NodeFileSystem, NodeHttpServer, NodeRuntime } from "@effect/platform-node";
import { Effect, Layer } from "effect";
import { createServer } from "node:http";

import { IdGenerator } from "../src/runtime/id-service.js";
import { zenithRouter } from "./api.js";
import { PaidConfirmationService } from "./confirmation-service.js";
import { ZenithServerConfig } from "./config.js";
import { GenerationJobService } from "./generation-job-service.js";
import { GenerationProvider } from "./generation-provider.js";
import { GenerationRepository } from "./generation-repository.js";

const InfrastructureLive = Layer.mergeAll(ZenithServerConfig.Live, NodeFileSystem.layer, IdGenerator.Live);

const RepositoryLive = GenerationRepository.Live.pipe(Layer.provide(InfrastructureLive));
const ProviderLive = GenerationProvider.Live.pipe(Layer.provide(InfrastructureLive));
const ConfirmationLive = PaidConfirmationService.Live.pipe(Layer.provide(InfrastructureLive));
const JobsLive = GenerationJobService.Live.pipe(
  Layer.provide(Layer.mergeAll(RepositoryLive, ProviderLive, IdGenerator.Live)),
);

const ApplicationServicesLive = Layer.mergeAll(
  InfrastructureLive,
  RepositoryLive,
  ProviderLive,
  ConfirmationLive,
  JobsLive,
);

const HttpServerLive = Layer.unwrapEffect(
  Effect.map(ZenithServerConfig, (config) =>
    NodeHttpServer.layer(() => createServer(), { host: config.host, port: config.port }),
  ),
).pipe(Layer.provide(InfrastructureLive));

const ApplicationLive = zenithRouter
  .pipe(HttpServer.serve(), HttpServer.withLogAddress)
  .pipe(Layer.provide(ApplicationServicesLive), Layer.provide(HttpServerLive));

Layer.launch(ApplicationLive).pipe(NodeRuntime.runMain);
