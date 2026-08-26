import { describe, expect, test } from "vitest";
import {
  createProjectArchive,
  createProjectArchiveMediaStore,
  isProjectArchiveBytes,
  readProjectArchive,
  readProjectArchiveBlob,
} from "./project-archive.js";

describe("Zenith project archive", () => {
  test("deduplicates binary media and restores portable data URLs", async () => {
    const dataUrl = "data:image/png;base64,UE5HREFUQQ==";
    const snapshot = { version: 5, first: { url: dataUrl }, sequence: { revisions: [{ media: { url: dataUrl } }] } };

    const archive = await createProjectArchive(snapshot);
    const bytes = new Uint8Array(await archive.arrayBuffer());
    const restored = await readProjectArchive(bytes.buffer);

    expect(archive.type).toBe("application/vnd.zenith.project");
    expect(isProjectArchiveBytes(bytes)).toBe(true);
    expect(restored).toEqual(snapshot);
    expect(new TextDecoder().decode(bytes)).not.toContain("UE5HREFUQQ==");
  });

  test("returns null for legacy JSON and rejects a truncated archive", async () => {
    const json = new TextEncoder().encode('{"version":5}');
    expect(await readProjectArchive(json.buffer)).toBeNull();

    const archive = new Uint8Array(await (await createProjectArchive({ version: 5 })).arrayBuffer());
    await expect(readProjectArchive(archive.slice(0, 10).buffer)).rejects.toThrow("truncated");
    await expect(createProjectArchive({ url: "zenith-media://missing" })).rejects.toThrow("missing attachment");
  });

  test("writes runtime Blob sidecars directly and deduplicates shared handles", async () => {
    const mediaStore = createProjectArchiveMediaStore();
    const video = new Blob(["MASTER"], { type: "video/mp4" });
    const url = mediaStore.add(video);
    expect(mediaStore.add(video)).toBe(url);

    const archive = await createProjectArchive(
      { first: { url }, selected: { url } },
      { attachments: mediaStore.attachments() },
    );
    const streamed = await readProjectArchiveBlob(archive);
    const restored = await readProjectArchive(await archive.arrayBuffer());

    expect(mediaStore.attachments()).toHaveLength(1);
    expect(streamed?.snapshot).toEqual({ first: { url }, selected: { url } });
    expect(await streamed?.media.get(url.slice("zenith-media://".length))?.text()).toBe("MASTER");
    expect(restored).toEqual({
      first: { url: "data:video/mp4;base64,TUFTVEVS" },
      selected: { url: "data:video/mp4;base64,TUFTVEVS" },
    });
  });
});
