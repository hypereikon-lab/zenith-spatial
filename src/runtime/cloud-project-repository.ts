import { Context, Data, Effect, Layer } from "effect";
import * as Schema from "effect/Schema";

const CloudUserSchema = Schema.Struct({
  id: Schema.String,
  email: Schema.String,
  name: Schema.NullOr(Schema.String),
});

export const CloudProjectSessionSchema = Schema.Struct({
  available: Schema.Boolean,
  signedIn: Schema.Boolean,
  user: Schema.NullOr(CloudUserSchema),
  signInPath: Schema.String,
  signOutPath: Schema.String,
});

export const CloudProjectSummarySchema = Schema.Struct({
  projectId: Schema.String,
  title: Schema.String,
  schemaVersion: Schema.Number.pipe(Schema.int(), Schema.positive()),
  revision: Schema.Number.pipe(Schema.int(), Schema.positive()),
  archiveBytes: Schema.Number.pipe(Schema.int(), Schema.nonNegative()),
  createdAt: Schema.String,
  updatedAt: Schema.String,
});

const CloudProjectListSchema = Schema.Struct({
  projects: Schema.Array(CloudProjectSummarySchema),
});

const CloudProjectSaveSchema = Schema.Struct({
  project: CloudProjectSummarySchema,
});

export type CloudProjectSession = Schema.Schema.Type<typeof CloudProjectSessionSchema>;
export type CloudProjectSummary = Schema.Schema.Type<typeof CloudProjectSummarySchema>;

export class CloudProjectError extends Data.TaggedError("CloudProjectError")<{
  readonly operation: "session" | "list" | "save" | "load" | "delete";
  readonly message: string;
  readonly status?: number;
  readonly currentRevision?: number;
  readonly cause?: unknown;
}> {}

export type SaveCloudProject = {
  readonly projectId: string;
  readonly title: string;
  readonly schemaVersion: number;
  readonly expectedRevision: number;
  readonly archive: Blob;
};

export interface CloudProjectRepositoryShape {
  readonly session: Effect.Effect<CloudProjectSession, CloudProjectError>;
  readonly list: Effect.Effect<ReadonlyArray<CloudProjectSummary>, CloudProjectError>;
  readonly save: (input: SaveCloudProject) => Effect.Effect<CloudProjectSummary, CloudProjectError>;
  readonly load: (projectId: string) => Effect.Effect<Blob, CloudProjectError>;
  readonly delete: (projectId: string, revision: number) => Effect.Effect<void, CloudProjectError>;
}

export class CloudProjectRepository extends Context.Tag("zenith/CloudProjectRepository")<
  CloudProjectRepository,
  CloudProjectRepositoryShape
>() {
  static readonly Live = Layer.succeed(CloudProjectRepository, makeCloudProjectRepository());

  static test(service: CloudProjectRepositoryShape) {
    return Layer.succeed(CloudProjectRepository, service);
  }
}

export function makeCloudProjectRepository(fetchSource: typeof fetch = globalThis.fetch): CloudProjectRepositoryShape {
  return {
    session: requestJson(fetchSource, "session", CloudProjectSessionSchema, "/api/site/session", {
      method: "GET",
      headers: { accept: "application/json" },
    }).pipe(
      Effect.catchTag("CloudProjectError", (error) =>
        error.status === 404 ? Effect.succeed(localOnlySession()) : error,
      ),
    ),

    list: requestJson(fetchSource, "list", CloudProjectListSchema, "/api/site/projects", {
      method: "GET",
      headers: { accept: "application/json" },
    }).pipe(Effect.map((response) => response.projects)),

    save: (input) =>
      requestJson(
        fetchSource,
        "save",
        CloudProjectSaveSchema,
        `/api/site/projects/${encodeProjectId(input.projectId)}/archive`,
        {
          method: "PUT",
          headers: {
            accept: "application/json",
            "content-type": "application/vnd.zenith.project",
            "x-zenith-project-title": encodeURIComponent(input.title),
            "x-zenith-schema-version": String(input.schemaVersion),
            "x-zenith-expected-revision": String(input.expectedRevision),
          },
          body: input.archive,
        },
      ).pipe(Effect.map((response) => response.project)),

    load: (projectId) =>
      request(
        fetchSource,
        "load",
        `/api/site/projects/${encodeProjectId(projectId)}/archive`,
        { method: "GET", headers: { accept: "application/vnd.zenith.project" } },
        (response) => response.blob(),
      ),

    delete: (projectId, revision) =>
      request(
        fetchSource,
        "delete",
        `/api/site/projects/${encodeProjectId(projectId)}/archive`,
        { method: "DELETE", headers: { "x-zenith-expected-revision": String(revision) } },
        () => Promise.resolve(undefined),
      ),
  };
}

function requestJson<S extends Schema.Schema.AnyNoContext>(
  fetchSource: typeof fetch,
  operation: CloudProjectError["operation"],
  schema: S,
  path: string,
  init: RequestInit,
): Effect.Effect<Schema.Schema.Type<S>, CloudProjectError> {
  return request(fetchSource, operation, path, init, async (response) =>
    Schema.decodeUnknownSync(schema)(await response.json(), { onExcessProperty: "error" }),
  );
}

function request<A>(
  fetchSource: typeof fetch,
  operation: CloudProjectError["operation"],
  path: string,
  init: RequestInit,
  decode: (response: Response) => Promise<A>,
): Effect.Effect<A, CloudProjectError> {
  return Effect.tryPromise({
    try: async (signal) => {
      const response = await fetchSource(path, { ...init, signal });
      if (!response.ok) throw await responseFailure(response);
      return decode(response);
    },
    catch: (cause) => {
      if (isResponseFailure(cause)) {
        return new CloudProjectError({
          operation,
          message: cause.message,
          status: cause.status,
          currentRevision: cause.currentRevision,
        });
      }
      return new CloudProjectError({
        operation,
        message: defaultMessage(operation),
        cause,
      });
    },
  });
}

type ResponseFailure = {
  readonly _tag: "ResponseFailure";
  readonly status: number;
  readonly message: string;
  readonly currentRevision?: number;
};

async function responseFailure(response: Response): Promise<ResponseFailure> {
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    body = null;
  }
  const error = isRecord(body) && isRecord(body.error) ? body.error : null;
  return {
    _tag: "ResponseFailure",
    status: response.status,
    message:
      error && typeof error.message === "string"
        ? error.message
        : `Private Site request failed (HTTP ${response.status}).`,
    ...(error && typeof error.currentRevision === "number" ? { currentRevision: error.currentRevision } : {}),
  };
}

function isResponseFailure(value: unknown): value is ResponseFailure {
  return isRecord(value) && value._tag === "ResponseFailure" && typeof value.status === "number";
}

function encodeProjectId(projectId: string): string {
  return encodeURIComponent(projectId);
}

function defaultMessage(operation: CloudProjectError["operation"]): string {
  switch (operation) {
    case "session":
      return "Could not inspect private Site access.";
    case "list":
      return "Private projects could not be listed.";
    case "save":
      return "The project could not be saved to the private Site.";
    case "load":
      return "The private project could not be loaded.";
    case "delete":
      return "The private project could not be deleted.";
  }
}

function localOnlySession(): CloudProjectSession {
  return {
    available: false,
    signedIn: false,
    user: null,
    signInPath: "",
    signOutPath: "",
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
