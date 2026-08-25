import { describe, expect, test } from "vitest";
import { createViewportRenderQueue } from "./viewport-render-queue.js";

describe("viewport render queue", () => {
  test("defaults to same-turn coalescing for playback renders", async () => {
    const queue = createViewportRenderQueue();
    let renders = 0;

    queue.request(() => {
      renders += 1;
    });
    queue.request(() => {
      renders += 1;
    });

    expect(renders).toBe(0);
    await Promise.resolve();
    expect(renders).toBe(1);
  });

  test("coalesces multiple requests into one frame", async () => {
    const frames: FrameRequestCallback[] = [];
    const queue = createViewportRenderQueue({
      requestAnimationFrame(callback) {
        frames.push(callback);
        return frames.length;
      },
      cancelAnimationFrame() {},
    });
    let renders = 0;

    queue.request(() => {
      renders += 1;
    });
    queue.request(() => {
      renders += 1;
    });

    expect(frames).toHaveLength(1);
    frames[0](0);
    await Promise.resolve();

    expect(renders).toBe(1);
  });

  test("runs a queued render after in-flight work finishes", async () => {
    const frames: FrameRequestCallback[] = [];
    const queue = createViewportRenderQueue({
      requestAnimationFrame(callback) {
        frames.push(callback);
        return frames.length;
      },
      cancelAnimationFrame() {},
    });
    let releaseRender = () => {};
    let renders = 0;

    queue.request(
      () =>
        new Promise<void>((resolve) => {
          renders += 1;
          releaseRender = resolve;
        }),
    );
    frames[0](0);
    queue.request(() => {
      renders += 1;
    });
    expect(frames).toHaveLength(1);

    releaseRender();
    await Promise.resolve();
    await Promise.resolve();

    expect(frames).toHaveLength(2);
    frames[1](16);
    await Promise.resolve();
    expect(renders).toBe(2);
  });
});
