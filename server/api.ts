import { FileSystem, HttpRouter, HttpServerError, HttpServerRequest, HttpServerResponse } from "@effect/platform";
import { Cause, Effect, Option, Stream } from "effect";
import * as ParseResult from "effect/ParseResult";
import * as Schema from "effect/Schema";
import { resolve, sep } from "node:path";

import { CreateGenerationJobRequestSchema, PaidConfirmationRequestSchema } from "../src/domain/schema.js";
import { PaidConfirmationService } from "./confirmation-service.js";
import { ZenithServerConfig } from "./config.js";
import { asServerError, invalidInput, missingSecret, notFound, publicJobError, ZenithServerError } from "./errors.js";
import { GenerationJobService } from "./generation-job-service.js";
import { validateGenerationInput } from "./generation-validation.js";

const ProjectPath = Schema.Struct({ projectId: Schema.String.pipe(Schema.minLength(1)) });
const JobPath = Schema.Struct({ jobId: Schema.String.pipe(Schema.minLength(1)) });
const OutputPath = Schema.Struct({
  jobId: Schema.String.pipe(Schema.minLength(1)),
  outputId: Schema.String.pipe(Schema.minLength(1)),
});
const maxJsonBody = Option.some(128 * 1024 * 1024);
const textEncoder = new TextEncoder();

export const zenithRouter = HttpRouter.empty.pipe(
  HttpRouter.get(
    "/api/runway/status",
    handled(
      Effect.gen(function* () {
        const jobs = yield* GenerationJobService;
        return json(jobs.status);
      }),
    ),
  ),
  HttpRouter.post(
    "/api/projects/:projectId/paid-confirmations",
    handled(
      Effect.gen(function* () {
        const { projectId } = yield* HttpRouter.schemaPathParams(ProjectPath);
        const body = yield* HttpServerRequest.schemaBodyJson(PaidConfirmationRequestSchema, {
          onExcessProperty: "error",
        }).pipe(HttpServerRequest.withMaxBodySize(maxJsonBody));
        const jobs = yield* GenerationJobService;
        if (!jobs.status.configured) return yield* Effect.fail(missingSecret());
        const confirmations = yield* PaidConfirmationService;
        const grant = yield* confirmations.issue(projectId, body.inputDigest);
        return json(grant, 201);
      }),
    ),
  ),
  HttpRouter.get(
    "/api/projects/:projectId/jobs",
    handled(
      Effect.gen(function* () {
        const { projectId } = yield* HttpRouter.schemaPathParams(ProjectPath);
        const jobs = yield* GenerationJobService;
        return json(yield* jobs.list(projectId));
      }),
    ),
  ),
  HttpRouter.post(
    "/api/projects/:projectId/jobs",
    handled(
      Effect.gen(function* () {
        const { projectId } = yield* HttpRouter.schemaPathParams(ProjectPath);
        const body = yield* HttpServerRequest.schemaBodyJson(CreateGenerationJobRequestSchema, {
          onExcessProperty: "error",
        }).pipe(HttpServerRequest.withMaxBodySize(maxJsonBody));
        const jobs = yield* GenerationJobService;
        if (!jobs.status.configured) return yield* Effect.fail(missingSecret());
        const validated = yield* validateGenerationInput(projectId, body.input);
        const confirmations = yield* PaidConfirmationService;
        yield* confirmations.consume(projectId, validated.inputDigest, body.confirmationGrant);
        return json(yield* jobs.create(projectId, validated.input), 202);
      }),
    ),
  ),
  HttpRouter.get(
    "/api/jobs/:jobId",
    handled(
      Effect.gen(function* () {
        const { jobId } = yield* HttpRouter.schemaPathParams(JobPath);
        const jobs = yield* GenerationJobService;
        return json(yield* jobs.get(jobId));
      }),
    ),
  ),
  HttpRouter.get(
    "/api/jobs/:jobId/events",
    handled(
      Effect.gen(function* () {
        const { jobId } = yield* HttpRouter.schemaPathParams(JobPath);
        const jobs = yield* GenerationJobService;
        yield* jobs.get(jobId);
        const stream = jobs.events(jobId).pipe(Stream.map((event) => textEncoder.encode(`${JSON.stringify(event)}\n`)));
        return HttpServerResponse.stream(stream, {
          headers: {
            "content-type": "application/x-ndjson; charset=utf-8",
            "cache-control": "no-store",
            connection: "keep-alive",
          },
        });
      }),
    ),
  ),
  HttpRouter.del(
    "/api/jobs/:jobId",
    handled(
      Effect.gen(function* () {
        const { jobId } = yield* HttpRouter.schemaPathParams(JobPath);
        const jobs = yield* GenerationJobService;
        return json(yield* jobs.cancel(jobId));
      }),
    ),
  ),
  HttpRouter.get(
    "/api/jobs/:jobId/outputs/:outputId",
    handled(
      Effect.gen(function* () {
        const { jobId, outputId } = yield* HttpRouter.schemaPathParams(OutputPath);
        const jobs = yield* GenerationJobService;
        const output = yield* jobs.output(jobId, outputId);
        return HttpServerResponse.uint8Array(output.bytes, {
          contentType: output.descriptor.contentType,
          headers: {
            "content-length": String(output.bytes.byteLength),
            "cache-control": "private, max-age=31536000, immutable",
            "content-disposition": `inline; filename="${output.descriptor.filename.replace(/["\\\r\n]/g, "-")}"`,
          },
        });
      }),
    ),
  ),
  HttpRouter.all("*", handled(serveClientAsset())),
);

function serveClientAsset() {
  return Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const config = yield* ZenithServerConfig;
    const fs = yield* FileSystem.FileSystem;
    const pathname = decodePathname(request.url);
    if (pathname.startsWith("/api/")) return errorResponse(notFound("API route not found."));
    const root = resolve(config.clientDirectory);
    const requested = resolve(root, pathname === "/" ? "index.html" : `.${pathname}`);
    const insideRoot = requested === root || requested.startsWith(`${root}${sep}`);
    if (insideRoot && (yield* fs.exists(requested))) return yield* HttpServerResponse.file(requested);
    const index = resolve(root, "index.html");
    if (!(yield* fs.exists(index))) {
      return errorResponse(
        new ZenithServerError({
          message: "Zenith client build is missing. Run npm run build before npm start.",
          status: 503,
          code: "server_error",
          provider: "zenith",
        }),
      );
    }
    return yield* HttpServerResponse.file(index, { headers: { "cache-control": "no-cache" } });
  });
}

function handled<R>(
  effect: Effect.Effect<HttpServerResponse.HttpServerResponse, unknown, R>,
): Effect.Effect<HttpServerResponse.HttpServerResponse, never, R> {
  return effect.pipe(
    Effect.catchAll((cause) => errorResponse(requestFailure(cause))),
    Effect.catchAllCause((cause) =>
      Effect.succeed(
        errorResponse(asServerError(Cause.squash(cause), "The local Zenith server encountered an internal error.")),
      ),
    ),
  );
}

function requestFailure(cause: unknown): ZenithServerError {
  if (cause instanceof ZenithServerError) return cause;
  if (cause instanceof ParseResult.ParseError || cause instanceof HttpServerError.RequestError) {
    return invalidInput("The request body or route parameters are malformed.", cause);
  }
  return asServerError(cause, "The local Zenith server encountered an internal error.");
}

function json(value: unknown, status = 200): HttpServerResponse.HttpServerResponse {
  return HttpServerResponse.unsafeJson(value, {
    status,
    headers: { "cache-control": "no-store" },
  });
}

function errorResponse(error: ZenithServerError): HttpServerResponse.HttpServerResponse {
  return HttpServerResponse.unsafeJson(publicJobError(error), {
    status: error.status,
    headers: { "cache-control": "no-store" },
  });
}

function decodePathname(url: string): string {
  try {
    return decodeURIComponent(new URL(url, "http://127.0.0.1").pathname);
  } catch {
    return "/";
  }
}
