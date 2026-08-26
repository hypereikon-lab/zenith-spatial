import { HttpServer } from "@effect/platform";
import { NodeFileSystem, NodeHttpServer, NodeRuntime } from "@effect/platform-node";
import { Effect, Layer } from "effect";
import { readFileSync } from "node:fs";
import { createServer } from "node:http";
import { createServer as createSecureServer } from "node:https";

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
    NodeHttpServer.layer(() => createZenithNodeServer(config), { host: config.host, port: config.port }),
  ),
).pipe(Layer.provide(InfrastructureLive));

const ApplicationLive = zenithRouter
  .pipe(HttpServer.serve(), HttpServer.withLogAddress)
  .pipe(Layer.provide(ApplicationServicesLive), Layer.provide(HttpServerLive));

Layer.launch(ApplicationLive).pipe(NodeRuntime.runMain);

function createZenithNodeServer(config: ZenithServerConfig["Type"]) {
  const certificatePath = config.tlsCertificatePath.trim();
  const privateKeyPath = config.tlsPrivateKeyPath.trim();
  if (!certificatePath && !privateKeyPath) return createServer();
  if (!certificatePath || !privateKeyPath) {
    throw new Error("ZENITH_TLS_CERT_PATH and ZENITH_TLS_KEY_PATH must be configured together.");
  }
  return createSecureServer({
    cert: readFileSync(certificatePath),
    key: readFileSync(privateKeyPath),
  });
}
