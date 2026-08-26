import { describe, expect, it } from "vitest";

import worker from "./index.js";

const emptyEnv = {} as never;
const emptyContext = {} as ExecutionContext;
const incoming = (request: Request) => request as unknown as Parameters<typeof worker.fetch>[0];

describe("Zenith Site Worker boundary", () => {
  it("never reports hosted paid generation as configured", async () => {
    const response = await worker.fetch(
      incoming(new Request("https://zenith.test/api/runway/status")),
      emptyEnv,
      emptyContext,
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ configured: false, provider: "runway", model: "gpt_image_2" });
  });

  it("projects an empty server-authoritative job list in Site mode", async () => {
    const response = await worker.fetch(
      incoming(new Request("https://zenith.test/api/projects/project-one/jobs")),
      emptyEnv,
      emptyContext,
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual([]);
  });

  it("requires ChatGPT identity before reading private projects", async () => {
    const response = await worker.fetch(
      incoming(new Request("https://zenith.test/api/site/projects")),
      emptyEnv,
      emptyContext,
    );

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toMatchObject({ error: { code: "unauthorized" } });
  });

  it("rejects malformed archives before touching D1 or R2", async () => {
    const response = await worker.fetch(
      incoming(
        new Request("https://zenith.test/api/site/projects/project-one/archive", {
          method: "PUT",
          headers: {
            "content-type": "application/vnd.zenith.project",
            "oai-authenticated-user-id": "owner-one",
            "oai-authenticated-user-email": "owner@example.test",
            "x-zenith-project-title": "Dome%20Study",
            "x-zenith-schema-version": "1",
            "x-zenith-expected-revision": "0",
          },
          body: "not-a-zenith-archive",
        }),
      ),
      emptyEnv,
      emptyContext,
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "invalid_input", message: "Project archive is not a Zenith archive." },
    });
  });

  it("decodes the Sites display name without trusting malformed encoding", async () => {
    const response = await worker.fetch(
      incoming(
        new Request("https://zenith.test/api/site/session", {
          headers: {
            "oai-authenticated-user-id": "owner-one",
            "oai-authenticated-user-email": "owner@example.test",
            "oai-authenticated-user-full-name": "Zenith%20Artist",
            "oai-authenticated-user-full-name-encoding": "percent-encoded-utf-8",
          },
        }),
      ),
      emptyEnv,
      emptyContext,
    );

    await expect(response.json()).resolves.toMatchObject({
      signedIn: true,
      user: { id: "owner-one", name: "Zenith Artist" },
    });
  });
});
