import { HttpClient, HttpClientRequest, HttpClientResponse } from "@effect/platform";
import { Context, Data, Effect, Layer, Stream } from "effect";
import * as Schema from "effect/Schema";

import type {
  CreateGenerationJobRequest,
  GenerationJob,
  GenerationJobEvent,
  GenerationServiceStatus,
  PaidConfirmationGrant,
  PaidConfirmationRequest,
} from "../domain/schema.js";
import {
  GenerationJobEventSchema,
  GenerationJobSchema,
  GenerationServiceStatusSchema,
  PaidConfirmationGrantSchema,
  PublicJobErrorSchema,
} from "../domain/schema.js";

export class GenerationClientError extends Data.TaggedError("GenerationClientError")<{
  readonly operation: "status" | "confirm" | "create" | "list" | "get" | "events" | "cancel" | "output";
  readonly message: string;
  readonly status?: number;
  readonly cause?: unknown;
}> {}

export interface GenerationClientService {
  readonly status: Effect.Effect<GenerationServiceStatus, GenerationClientError>;
  readonly confirm: (
    projectId: string,
    request: PaidConfirmationRequest,
  ) => Effect.Effect<PaidConfirmationGrant, GenerationClientError>;
  readonly create: (
    projectId: string,
    request: CreateGenerationJobRequest,
  ) => Effect.Effect<GenerationJob, GenerationClientError>;
  readonly list: (projectId: string) => Effect.Effect<ReadonlyArray<GenerationJob>, GenerationClientError>;
  readonly get: (jobId: string) => Effect.Effect<GenerationJob, GenerationClientError>;
  readonly events: (jobId: string) => Stream.Stream<GenerationJobEvent, GenerationClientError>;
  readonly cancel: (jobId: string) => Effect.Effect<GenerationJob, GenerationClientError>;
  readonly output: (jobId: string, outputId: string) => Effect.Effect<Blob, GenerationClientError>;
}

export class GenerationClient extends Context.Tag("zenith/GenerationClient")<
  GenerationClient,
  GenerationClientService
>() {
  static readonly Live = Layer.effect(
    GenerationClient,
    Effect.gen(function* () {
      const client = yield* HttpClient.HttpClient;

      function requestJson<A, I>(
        operation: GenerationClientError["operation"],
        request: HttpClientRequest.HttpClientRequest,
        schema: Schema.Schema<A, I, never>,
      ) {
        return client.execute(request).pipe(
          Effect.flatMap((response) => requireSuccess(operation, response)),
          Effect.flatMap(HttpClientResponse.schemaBodyJson(schema, { onExcessProperty: "error" })),
          Effect.mapError((cause) => clientError(operation, cause)),
        );
      }

      return {
        status: requestJson("status", HttpClientRequest.get("/api/runway/status"), GenerationServiceStatusSchema),
        confirm: (projectId, request) =>
          requestJson(
            "confirm",
            jsonRequest(`/api/projects/${encodeURIComponent(projectId)}/paid-confirmations`, request),
            PaidConfirmationGrantSchema,
          ),
        create: (projectId, request) =>
          requestJson(
            "create",
            jsonRequest(`/api/projects/${encodeURIComponent(projectId)}/jobs`, request),
            GenerationJobSchema,
          ),
        list: (projectId) =>
          requestJson(
            "list",
            HttpClientRequest.get(`/api/projects/${encodeURIComponent(projectId)}/jobs`),
            Schema.Array(GenerationJobSchema),
          ),
        get: (jobId) =>
          requestJson("get", HttpClientRequest.get(`/api/jobs/${encodeURIComponent(jobId)}`), GenerationJobSchema),
        events: (jobId) =>
          Stream.unwrap(
            client.get(`/api/jobs/${encodeURIComponent(jobId)}/events`).pipe(
              Effect.flatMap((response) => requireSuccess("events", response)),
              Effect.map((response) =>
                response.stream.pipe(
                  Stream.decodeText("utf-8"),
                  Stream.splitLines,
                  Stream.map((line) => line.trim()),
                  Stream.filter((line) => line.length > 0),
                  Stream.mapEffect((line) =>
                    Effect.try({
                      try: () => JSON.parse(line) as unknown,
                      catch: (cause) => clientError("events", cause, "Malformed job event stream."),
                    }).pipe(
                      Effect.flatMap((value) =>
                        Effect.mapError(
                          Schema.decodeUnknown(GenerationJobEventSchema)(value, { onExcessProperty: "error" }),
                          (cause) => clientError("events", cause, "Invalid job event payload."),
                        ),
                      ),
                    ),
                  ),
                  Stream.mapError((cause) => clientError("events", cause)),
                ),
              ),
              Effect.mapError((cause) => clientError("events", cause)),
            ),
          ),
        cancel: (jobId) =>
          requestJson("cancel", HttpClientRequest.del(`/api/jobs/${encodeURIComponent(jobId)}`), GenerationJobSchema),
        output: (jobId, outputId) =>
          client.get(`/api/jobs/${encodeURIComponent(jobId)}/outputs/${encodeURIComponent(outputId)}`).pipe(
            Effect.flatMap((response) => requireSuccess("output", response)),
            Effect.flatMap((response) =>
              response.arrayBuffer.pipe(
                Effect.map(
                  (buffer) =>
                    new Blob([buffer], {
                      type: response.headers["content-type"]?.split(";")[0] || "application/octet-stream",
                    }),
                ),
              ),
            ),
            Effect.mapError((cause) => clientError("output", cause)),
          ),
      } satisfies GenerationClientService;
    }),
  );
}

function jsonRequest(url: string, body: unknown): HttpClientRequest.HttpClientRequest {
  return HttpClientRequest.post(url).pipe(
    HttpClientRequest.setHeader("content-type", "application/json; charset=utf-8"),
    HttpClientRequest.bodyText(JSON.stringify(body)),
  );
}

function requireSuccess(
  operation: GenerationClientError["operation"],
  response: HttpClientResponse.HttpClientResponse,
) {
  if (response.status >= 200 && response.status < 300) return Effect.succeed(response);
  return response.json.pipe(
    Effect.flatMap((value) => {
      try {
        const error = Schema.decodeUnknownSync(PublicJobErrorSchema)(value, { onExcessProperty: "error" });
        return Effect.fail(new GenerationClientError({ operation, message: error.message, status: response.status }));
      } catch {
        return Effect.fail(
          new GenerationClientError({
            operation,
            message: `Generation service returned HTTP ${response.status}.`,
            status: response.status,
          }),
        );
      }
    }),
    Effect.catchAll(() =>
      Effect.fail(
        new GenerationClientError({
          operation,
          message: `Generation service returned HTTP ${response.status}.`,
          status: response.status,
        }),
      ),
    ),
  );
}

function clientError(
  operation: GenerationClientError["operation"],
  cause: unknown,
  fallback = "The generation service could not complete the request.",
): GenerationClientError {
  if (cause instanceof GenerationClientError) return cause;
  const message =
    typeof cause === "object" && cause && "message" in cause && typeof cause.message === "string"
      ? cause.message
      : fallback;
  return new GenerationClientError({ operation, message, cause });
}
