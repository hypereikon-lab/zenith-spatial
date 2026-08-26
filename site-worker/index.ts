import { Data, Effect } from "effect";
import * as Schema from "effect/Schema";

const PROJECT_PATH = /^\/api\/site\/projects\/([A-Za-z0-9][A-Za-z0-9_-]{0,127})\/archive$/;
const GENERATION_PROJECT_JOBS_PATH = /^\/api\/projects\/[A-Za-z0-9][A-Za-z0-9_-]{0,127}\/jobs$/;
const PROJECT_CONTENT_TYPE = "application/vnd.zenith.project";
const PROJECT_ARCHIVE_MAGIC = new TextEncoder().encode("ZENITH01");
const MAX_ARCHIVE_BYTES = 250 * 1024 * 1024;

type ZenithSiteEnv = {
  readonly DB: D1Database;
  readonly FILES: R2Bucket;
};

type AuthenticatedUser = {
  readonly id: string;
  readonly email: string;
  readonly name: string | null;
};

type ProjectRow = {
  readonly owner_id: string;
  readonly project_id: string;
  readonly title: string;
  readonly schema_version: number;
  readonly revision: number;
  readonly archive_key: string;
  readonly archive_bytes: number;
  readonly created_at: string;
  readonly updated_at: string;
};

const UploadMetadataSchema = Schema.Struct({
  title: Schema.String.pipe(Schema.minLength(1), Schema.maxLength(160)),
  schemaVersion: Schema.Number.pipe(Schema.int(), Schema.positive()),
  expectedRevision: Schema.Number.pipe(Schema.int(), Schema.nonNegative()),
});

class SiteApiError extends Data.TaggedError("SiteApiError")<{
  readonly status: number;
  readonly code: "unauthorized" | "invalid_input" | "not_found" | "conflict" | "server_error";
  readonly message: string;
  readonly currentRevision?: number;
}> {}

export default {
  fetch(request, env, context) {
    return Effect.runPromise(
      route(request, env, context).pipe(
        Effect.catchAll((error) =>
          Effect.succeed(
            json(
              {
                error: {
                  code: error.code,
                  message: error.message,
                  ...(error.currentRevision === undefined ? {} : { currentRevision: error.currentRevision }),
                },
              },
              error.status,
            ),
          ),
        ),
        Effect.catchAllCause(() =>
          Effect.succeed(
            json(
              { error: { code: "server_error", message: "The private Zenith Site could not complete the request." } },
              500,
            ),
          ),
        ),
      ),
    );
  },
} satisfies ExportedHandler<ZenithSiteEnv>;

export function route(
  request: Request,
  env: ZenithSiteEnv,
  context?: ExecutionContext,
): Effect.Effect<Response, SiteApiError> {
  const url = new URL(request.url);
  if (request.method === "GET" && url.pathname === "/api/site/session") {
    return Effect.succeed(sessionResponse(request));
  }
  if (request.method === "GET" && url.pathname === "/api/runway/status") {
    // Paid generation remains on the local Effect Node server until the hosted job
    // journal can provide the same confirmation, cancellation and recovery guarantees.
    return Effect.succeed(json({ configured: false, provider: "runway", model: "gpt_image_2" }));
  }
  if (GENERATION_PROJECT_JOBS_PATH.test(url.pathname)) {
    return request.method === "GET" ? Effect.succeed(json([])) : Effect.succeed(generationUnavailable());
  }
  if (url.pathname === "/api/site/projects" && request.method === "GET") {
    return listProjects(request, env);
  }
  const projectMatch = PROJECT_PATH.exec(url.pathname);
  if (projectMatch) {
    const projectId = projectMatch[1]!;
    if (request.method === "PUT") return saveProject(request, env, context, projectId);
    if (request.method === "GET") return loadProject(request, env, projectId);
    if (request.method === "DELETE") return deleteProject(request, env, context, projectId);
  }
  if (url.pathname.startsWith("/api/")) {
    return Effect.fail(new SiteApiError({ status: 404, code: "not_found", message: "Site endpoint not found." }));
  }
  return Effect.succeed(new Response(null, { status: 404 }));
}

function listProjects(request: Request, env: ZenithSiteEnv): Effect.Effect<Response, SiteApiError> {
  return Effect.gen(function* () {
    const user = yield* requireUser(request);
    yield* databaseReady(env.DB);
    const rows = yield* databaseAttempt(
      env.DB.prepare(
        `SELECT owner_id, project_id, title, schema_version, revision, archive_key, archive_bytes, created_at, updated_at
         FROM zenith_projects WHERE owner_id = ? ORDER BY updated_at DESC`,
      )
        .bind(user.id)
        .all<ProjectRow>(),
      "Private projects could not be listed.",
    );
    return json({ projects: rows.results.map(projectSummary) });
  });
}

function saveProject(
  request: Request,
  env: ZenithSiteEnv,
  context: ExecutionContext | undefined,
  projectId: string,
): Effect.Effect<Response, SiteApiError> {
  return Effect.gen(function* () {
    const user = yield* requireUser(request);
    const metadata = yield* uploadMetadata(request);
    if (!request.body) {
      return yield* new SiteApiError({ status: 400, code: "invalid_input", message: "Project archive is missing." });
    }
    const archiveStream = yield* validateProjectArchive(request.body);
    const contentType = request.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase();
    if (contentType !== PROJECT_CONTENT_TYPE) {
      return yield* new SiteApiError({
        status: 415,
        code: "invalid_input",
        message: "Project archive content type is unsupported.",
      });
    }
    const declaredBytes = optionalPositiveInteger(request.headers.get("content-length"));
    if (declaredBytes !== null && declaredBytes > MAX_ARCHIVE_BYTES) {
      return yield* new SiteApiError({
        status: 413,
        code: "invalid_input",
        message: "Project archive exceeds the 250 MiB Site limit.",
      });
    }

    yield* databaseReady(env.DB);
    const current = yield* readProjectRow(env.DB, user.id, projectId);
    const currentRevision = current?.revision ?? 0;
    if (metadata.expectedRevision !== currentRevision) {
      return yield* conflict(currentRevision);
    }

    const nextRevision = currentRevision + 1;
    const ownerKey = yield* ownerStorageKey(user.id);
    const archiveKey = `owners/${ownerKey}/projects/${projectId}/revision-${nextRevision}-${crypto.randomUUID()}.zenith`;
    const stored = yield* storageAttempt(
      env.FILES.put(archiveKey, archiveStream, {
        httpMetadata: { contentType: PROJECT_CONTENT_TYPE },
        customMetadata: {
          projectId,
          revision: String(nextRevision),
          schemaVersion: String(metadata.schemaVersion),
        },
      }),
      "Project archive could not be stored.",
    );
    if (!stored) {
      return yield* new SiteApiError({ status: 500, code: "server_error", message: "Project archive was not stored." });
    }
    if (stored.size > MAX_ARCHIVE_BYTES) {
      yield* storageAttempt(env.FILES.delete(archiveKey), "Oversize project cleanup failed.");
      return yield* new SiteApiError({
        status: 413,
        code: "invalid_input",
        message: "Project archive exceeds the 250 MiB Site limit.",
      });
    }

    const now = new Date().toISOString();
    const committed = current
      ? yield* updateProjectRow(env.DB, {
          ownerId: user.id,
          projectId,
          title: metadata.title,
          schemaVersion: metadata.schemaVersion,
          expectedRevision: currentRevision,
          nextRevision,
          archiveKey,
          archiveBytes: stored.size,
          updatedAt: now,
        })
      : yield* insertProjectRow(env.DB, {
          ownerId: user.id,
          projectId,
          title: metadata.title,
          schemaVersion: metadata.schemaVersion,
          revision: nextRevision,
          archiveKey,
          archiveBytes: stored.size,
          createdAt: now,
          updatedAt: now,
        });

    if (!committed) {
      yield* storageAttempt(env.FILES.delete(archiveKey), "Conflicted project cleanup failed.");
      const latest = yield* readProjectRow(env.DB, user.id, projectId);
      return yield* conflict(latest?.revision ?? 0);
    }
    if (current?.archive_key) {
      const cleanup = env.FILES.delete(current.archive_key);
      if (context) context.waitUntil(cleanup);
      else yield* storageAttempt(cleanup, "Previous project revision cleanup failed.");
    }
    return json({ project: projectSummaryFromSave(current, projectId, metadata, nextRevision, stored.size, now) });
  });
}

function loadProject(request: Request, env: ZenithSiteEnv, projectId: string): Effect.Effect<Response, SiteApiError> {
  return Effect.gen(function* () {
    const user = yield* requireUser(request);
    yield* databaseReady(env.DB);
    const row = yield* readProjectRow(env.DB, user.id, projectId);
    if (!row) {
      return yield* new SiteApiError({ status: 404, code: "not_found", message: "Private project not found." });
    }
    const object = yield* storageAttempt(env.FILES.get(row.archive_key), "Project archive could not be retrieved.");
    if (!object) {
      return yield* new SiteApiError({
        status: 500,
        code: "server_error",
        message: "Private project media is unavailable.",
      });
    }
    const headers = new Headers({
      "cache-control": "private, no-store",
      "content-disposition": `attachment; filename="zenith-${safeFilename(row.title)}.zenith"`,
      "content-type": PROJECT_CONTENT_TYPE,
      "x-zenith-project-revision": String(row.revision),
    });
    object.writeHttpMetadata(headers);
    headers.set("etag", object.httpEtag);
    return new Response(object.body, { headers });
  });
}

function deleteProject(
  request: Request,
  env: ZenithSiteEnv,
  context: ExecutionContext | undefined,
  projectId: string,
): Effect.Effect<Response, SiteApiError> {
  return Effect.gen(function* () {
    const user = yield* requireUser(request);
    const expectedRevision = yield* parseRequiredRevision(request.headers.get("x-zenith-expected-revision"));
    yield* databaseReady(env.DB);
    const current = yield* readProjectRow(env.DB, user.id, projectId);
    if (!current) {
      return yield* new SiteApiError({ status: 404, code: "not_found", message: "Private project not found." });
    }
    if (current.revision !== expectedRevision) return yield* conflict(current.revision);
    const result = yield* databaseAttempt(
      env.DB.prepare("DELETE FROM zenith_projects WHERE owner_id = ? AND project_id = ? AND revision = ?")
        .bind(user.id, projectId, expectedRevision)
        .run(),
      "Private project could not be deleted.",
    );
    if (result.meta.changes !== 1) {
      const latest = yield* readProjectRow(env.DB, user.id, projectId);
      return yield* conflict(latest?.revision ?? 0);
    }
    const cleanup = env.FILES.delete(current.archive_key);
    if (context) context.waitUntil(cleanup);
    else yield* storageAttempt(cleanup, "Deleted project cleanup failed.");
    return new Response(null, { status: 204, headers: { "cache-control": "private, no-store" } });
  });
}

function sessionResponse(request: Request): Response {
  const user = authenticatedUser(request);
  return json({
    available: true,
    signedIn: user !== null,
    user,
    signInPath: "/signin-with-chatgpt?return_to=%2F",
    signOutPath: "/signout-with-chatgpt?return_to=%2F",
  });
}

function requireUser(request: Request): Effect.Effect<AuthenticatedUser, SiteApiError> {
  const user = authenticatedUser(request);
  return user
    ? Effect.succeed(user)
    : Effect.fail(new SiteApiError({ status: 401, code: "unauthorized", message: "ChatGPT sign-in is required." }));
}

function authenticatedUser(request: Request): AuthenticatedUser | null {
  const id = request.headers.get("oai-authenticated-user-id");
  const email = request.headers.get("oai-authenticated-user-email");
  if (!id || !email) return null;
  const encodedName = request.headers.get("oai-authenticated-user-full-name");
  const encoding = request.headers.get("oai-authenticated-user-full-name-encoding");
  return {
    id,
    email,
    name: encodedName && encoding === "percent-encoded-utf-8" ? safeDecode(encodedName) : null,
  };
}

function uploadMetadata(request: Request) {
  return Effect.try({
    try: () =>
      Schema.decodeUnknownSync(UploadMetadataSchema)(
        {
          title: decodeURIComponent(request.headers.get("x-zenith-project-title") ?? ""),
          schemaVersion: requiredNumberHeader(request.headers.get("x-zenith-schema-version")),
          expectedRevision: requiredNumberHeader(request.headers.get("x-zenith-expected-revision")),
        },
        { onExcessProperty: "error" },
      ),
    catch: () => new SiteApiError({ status: 400, code: "invalid_input", message: "Project metadata is invalid." }),
  });
}

function validateProjectArchive(
  body: ReadableStream<Uint8Array>,
): Effect.Effect<ReadableStream<Uint8Array>, SiteApiError> {
  return Effect.tryPromise({
    try: async () => {
      const [inspection, upload] = body.tee();
      const reader = inspection.getReader();
      const prefix = new Uint8Array(PROJECT_ARCHIVE_MAGIC.byteLength);
      let offset = 0;
      while (offset < prefix.byteLength) {
        const chunk = await reader.read();
        if (chunk.done) break;
        const take = Math.min(chunk.value.byteLength, prefix.byteLength - offset);
        prefix.set(chunk.value.subarray(0, take), offset);
        offset += take;
      }
      if (offset !== prefix.byteLength || !prefix.every((byte, index) => byte === PROJECT_ARCHIVE_MAGIC[index])) {
        await Promise.all([reader.cancel(), upload.cancel()]);
        throw new Error("invalid archive magic");
      }
      void reader.cancel();
      return upload;
    },
    catch: () =>
      new SiteApiError({ status: 400, code: "invalid_input", message: "Project archive is not a Zenith archive." }),
  });
}

function databaseReady(database: D1Database): Effect.Effect<void, SiteApiError> {
  return databaseAttempt(
    database.batch([
      database.prepare(
        `CREATE TABLE IF NOT EXISTS zenith_projects (
          owner_id text NOT NULL,
          project_id text NOT NULL,
          title text NOT NULL,
          schema_version integer NOT NULL,
          revision integer NOT NULL,
          archive_key text NOT NULL,
          archive_bytes integer NOT NULL,
          created_at text NOT NULL,
          updated_at text NOT NULL,
          PRIMARY KEY (owner_id, project_id)
        )`,
      ),
      database.prepare(
        "CREATE INDEX IF NOT EXISTS zenith_projects_owner_updated_idx ON zenith_projects (owner_id, updated_at)",
      ),
    ]),
    "Private project storage is unavailable.",
  ).pipe(Effect.asVoid);
}

function readProjectRow(database: D1Database, ownerId: string, projectId: string) {
  return databaseAttempt(
    database
      .prepare(
        `SELECT owner_id, project_id, title, schema_version, revision, archive_key, archive_bytes, created_at, updated_at
         FROM zenith_projects WHERE owner_id = ? AND project_id = ?`,
      )
      .bind(ownerId, projectId)
      .first<ProjectRow>(),
    "Private project metadata could not be read.",
  );
}

function updateProjectRow(
  database: D1Database,
  input: {
    ownerId: string;
    projectId: string;
    title: string;
    schemaVersion: number;
    expectedRevision: number;
    nextRevision: number;
    archiveKey: string;
    archiveBytes: number;
    updatedAt: string;
  },
) {
  return databaseAttempt(
    database
      .prepare(
        `UPDATE zenith_projects
         SET title = ?, schema_version = ?, revision = ?, archive_key = ?, archive_bytes = ?, updated_at = ?
         WHERE owner_id = ? AND project_id = ? AND revision = ?`,
      )
      .bind(
        input.title,
        input.schemaVersion,
        input.nextRevision,
        input.archiveKey,
        input.archiveBytes,
        input.updatedAt,
        input.ownerId,
        input.projectId,
        input.expectedRevision,
      )
      .run(),
    "Private project metadata could not be updated.",
  ).pipe(Effect.map((result) => result.meta.changes === 1));
}

function insertProjectRow(
  database: D1Database,
  input: {
    ownerId: string;
    projectId: string;
    title: string;
    schemaVersion: number;
    revision: number;
    archiveKey: string;
    archiveBytes: number;
    createdAt: string;
    updatedAt: string;
  },
) {
  return Effect.tryPromise({
    try: () =>
      database
        .prepare(
          `INSERT INTO zenith_projects
           (owner_id, project_id, title, schema_version, revision, archive_key, archive_bytes, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(
          input.ownerId,
          input.projectId,
          input.title,
          input.schemaVersion,
          input.revision,
          input.archiveKey,
          input.archiveBytes,
          input.createdAt,
          input.updatedAt,
        )
        .run()
        .then((result) => result.meta.changes === 1)
        .catch(() => false),
    catch: () => new SiteApiError({ status: 500, code: "server_error", message: "Project metadata failed." }),
  });
}

function ownerStorageKey(ownerId: string): Effect.Effect<string, SiteApiError> {
  return Effect.tryPromise({
    try: async () => {
      const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(ownerId));
      return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
    },
    catch: () => new SiteApiError({ status: 500, code: "server_error", message: "Storage identity failed." }),
  });
}

function databaseAttempt<A>(promise: Promise<A>, message: string): Effect.Effect<A, SiteApiError> {
  return Effect.tryPromise({
    try: () => promise,
    catch: () => new SiteApiError({ status: 500, code: "server_error", message }),
  });
}

function storageAttempt<A>(promise: Promise<A>, message: string): Effect.Effect<A, SiteApiError> {
  return Effect.tryPromise({
    try: () => promise,
    catch: () => new SiteApiError({ status: 500, code: "server_error", message }),
  });
}

function conflict(currentRevision: number): Effect.Effect<never, SiteApiError> {
  return Effect.fail(
    new SiteApiError({
      status: 409,
      code: "conflict",
      message: "A newer private project revision exists. Load it before saving again.",
      currentRevision,
    }),
  );
}

function projectSummary(row: ProjectRow) {
  return {
    projectId: row.project_id,
    title: row.title,
    schemaVersion: row.schema_version,
    revision: row.revision,
    archiveBytes: row.archive_bytes,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function projectSummaryFromSave(
  current: ProjectRow | null,
  projectId: string,
  metadata: Schema.Schema.Type<typeof UploadMetadataSchema>,
  revision: number,
  archiveBytes: number,
  now: string,
) {
  return {
    projectId,
    title: metadata.title,
    schemaVersion: metadata.schemaVersion,
    revision,
    archiveBytes,
    createdAt: current?.created_at ?? now,
    updatedAt: now,
  };
}

function parseRequiredRevision(value: string | null): Effect.Effect<number, SiteApiError> {
  const revision = Number(value);
  return Number.isSafeInteger(revision) && revision >= 1
    ? Effect.succeed(revision)
    : Effect.fail(new SiteApiError({ status: 400, code: "invalid_input", message: "Project revision is invalid." }));
}

function optionalPositiveInteger(value: string | null): number | null {
  if (value === null) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null;
}

function requiredNumberHeader(value: string | null): number {
  return value === null ? Number.NaN : Number(value);
}

function safeFilename(value: string): string {
  return (
    value
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "") || "project"
  );
}

function safeDecode(value: string): string | null {
  try {
    return decodeURIComponent(value);
  } catch {
    return null;
  }
}

function json(value: unknown, status = 200): Response {
  return Response.json(value, { status, headers: { "cache-control": "private, no-store" } });
}

function generationUnavailable(): Response {
  return json(
    {
      message: "Paid image generation is available only from Zenith's local Effect server.",
      status: 503,
      code: "missing_secret",
      provider: "zenith",
    },
    503,
  );
}
