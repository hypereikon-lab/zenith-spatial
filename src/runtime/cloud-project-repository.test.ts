import { Effect } from "effect";
import { describe, expect, it, vi } from "vitest";

import { CloudProjectError, makeCloudProjectRepository } from "./cloud-project-repository.js";

const PROJECT = {
  projectId: "project-one",
  title: "Dome Study",
  schemaVersion: 1,
  revision: 3,
  archiveBytes: 8192,
  createdAt: "2026-08-26T00:00:00.000Z",
  updatedAt: "2026-08-26T01:00:00.000Z",
} as const;

describe("CloudProjectRepository", () => {
  it("stays invisible when the local Node server has no Site endpoint", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 404 }));
    const session = await Effect.runPromise(makeCloudProjectRepository(fetchMock).session);

    expect(session).toEqual({ available: false, signedIn: false, user: null, signInPath: "", signOutPath: "" });
  });

  it("decodes the private project index", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(Response.json({ projects: [PROJECT] }, { headers: { "cache-control": "private" } }));
    const projects = await Effect.runPromise(makeCloudProjectRepository(fetchMock).list);

    expect(projects).toEqual([PROJECT]);
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/site/projects",
      expect.objectContaining({ method: "GET", signal: expect.any(AbortSignal) }),
    );
  });

  it("uploads the exact archive with revision metadata", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ project: PROJECT }));
    const archive = new Blob(["ZENITH01archive"], { type: "application/vnd.zenith.project" });
    const saved = await Effect.runPromise(
      makeCloudProjectRepository(fetchMock).save({
        projectId: PROJECT.projectId,
        title: PROJECT.title,
        schemaVersion: 1,
        expectedRevision: 2,
        archive,
      }),
    );

    expect(saved).toEqual(PROJECT);
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/site/projects/project-one/archive",
      expect.objectContaining({
        method: "PUT",
        body: archive,
        headers: expect.objectContaining({
          "content-type": "application/vnd.zenith.project",
          "x-zenith-project-title": "Dome%20Study",
          "x-zenith-expected-revision": "2",
        }),
      }),
    );
  });

  it("exposes server revision conflicts without overwriting", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        Response.json(
          { error: { code: "conflict", message: "Load the newer revision.", currentRevision: 4 } },
          { status: 409 },
        ),
      );
    const result = await Effect.runPromise(
      Effect.flip(
        makeCloudProjectRepository(fetchMock).save({
          projectId: PROJECT.projectId,
          title: PROJECT.title,
          schemaVersion: 1,
          expectedRevision: 3,
          archive: new Blob(["ZENITH01archive"]),
        }),
      ),
    );

    expect(result).toBeInstanceOf(CloudProjectError);
    expect(result).toMatchObject({ status: 409, currentRevision: 4, operation: "save" });
  });

  it("retrieves archive bytes and deletes only the expected revision", async () => {
    const archiveBytes = new TextEncoder().encode("ZENITH01archive");
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(archiveBytes, { status: 200 }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    const repository = makeCloudProjectRepository(fetchMock);

    const archive = await Effect.runPromise(repository.load(PROJECT.projectId));
    await Effect.runPromise(repository.delete(PROJECT.projectId, PROJECT.revision));

    expect(new Uint8Array(await archive.arrayBuffer())).toEqual(archiveBytes);
    expect(fetchMock).toHaveBeenLastCalledWith(
      "/api/site/projects/project-one/archive",
      expect.objectContaining({
        method: "DELETE",
        headers: { "x-zenith-expected-revision": "3" },
      }),
    );
  });
});
