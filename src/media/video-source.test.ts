import { describe, expect, test, vi } from "vitest";

import { disposeVideoSource, loadVideoSource, readVideoDimensions } from "./video-source.js";

describe("browser MP4 source", () => {
  test("loads a muted inline looping frame source and starts playback", async () => {
    const video = fakeVideo({ width: 2048, height: 2048, readyState: 2 });
    const loaded = await loadVideoSource("blob:video", {
      autoplay: true,
      createVideo: () => video,
      loop: true,
      waitFor: "frame",
    });
    expect(loaded).toBe(video);
    expect(video).toMatchObject({ muted: true, loop: true, playsInline: true, src: "blob:video" });
    expect(video.play).toHaveBeenCalledOnce();
  });

  test("reads dimensions and releases its temporary URL and element", async () => {
    const video = fakeVideo({ width: 1920, height: 1080, readyState: 1 });
    const revokeObjectUrl = vi.fn();
    await expect(
      readVideoDimensions(new Blob(["mp4"], { type: "video/mp4" }), {
        createObjectUrl: () => "blob:metadata",
        createVideo: () => video,
        revokeObjectUrl,
      }),
    ).resolves.toEqual({ width: 1920, height: 1080 });
    expect(video.pause).toHaveBeenCalledOnce();
    expect(video.removeAttribute).toHaveBeenCalledWith("src");
    expect(revokeObjectUrl).toHaveBeenCalledWith("blob:metadata");
  });

  test("disposes playback deterministically", () => {
    const video = fakeVideo({ width: 1, height: 1, readyState: 2 });
    disposeVideoSource(video);
    expect(video.pause).toHaveBeenCalledOnce();
    expect(video.load).toHaveBeenCalledOnce();
  });
});

function fakeVideo({ width, height, readyState }: { width: number; height: number; readyState: number }) {
  const target = new EventTarget();
  return Object.assign(target, {
    crossOrigin: "",
    load: vi.fn(),
    loop: false,
    muted: false,
    pause: vi.fn(),
    play: vi.fn(async () => undefined),
    playsInline: false,
    preload: "",
    readyState,
    removeAttribute: vi.fn(),
    src: "",
    videoHeight: height,
    videoWidth: width,
  }) as unknown as HTMLVideoElement;
}
