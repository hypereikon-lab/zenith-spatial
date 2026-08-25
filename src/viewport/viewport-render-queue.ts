export type ViewportRenderQueue = ReturnType<typeof createViewportRenderQueue>;

type ScheduledRenderHandle =
  | { kind: "animation-frame"; handle: number }
  | { kind: "microtask"; canceled: boolean };

export function createViewportRenderQueue({
  requestAnimationFrame: scheduleFrame,
  cancelAnimationFrame: cancelFrame = defaultCancelAnimationFrame,
}: {
  requestAnimationFrame?: typeof requestAnimationFrame;
  cancelAnimationFrame?: typeof cancelAnimationFrame;
} = {}) {
  let scheduledHandle: ScheduledRenderHandle | null = null;
  let queued = false;
  let inFlight = false;
  let destroyed = false;

  function request(render: () => Promise<void> | void): void {
    if (destroyed) return;
    queued = true;
    if (scheduledHandle !== null || inFlight) return;
    scheduledHandle = scheduleRenderTask(scheduleFrame, () => {
      scheduledHandle = null;
      if (!queued || inFlight || destroyed) return;
      queued = false;
      inFlight = true;
      Promise.resolve(render()).finally(() => {
        inFlight = false;
        if (queued && !destroyed) request(render);
      });
    });
  }

  function cancel(): void {
    queued = false;
    if (scheduledHandle !== null) {
      cancelRenderTask(scheduledHandle, cancelFrame);
      scheduledHandle = null;
    }
  }

  function destroy(): void {
    destroyed = true;
    cancel();
  }

  return {
    request,
    cancel,
    destroy,
  };
}

function scheduleRenderTask(
  scheduleFrame: typeof requestAnimationFrame | undefined,
  callback: FrameRequestCallback,
): ScheduledRenderHandle {
  if (scheduleFrame) {
    return { kind: "animation-frame", handle: scheduleFrame(callback) };
  }
  const handle: ScheduledRenderHandle = { kind: "microtask", canceled: false };
  queueMicrotask(() => {
    if (!handle.canceled) callback(performance.now());
  });
  return handle;
}

function cancelRenderTask(
  handle: ScheduledRenderHandle,
  cancelFrame: typeof cancelAnimationFrame,
): void {
  if (handle.kind === "animation-frame") {
    cancelFrame(handle.handle);
    return;
  }
  handle.canceled = true;
}

const defaultCancelAnimationFrame: typeof cancelAnimationFrame = (handle) => {
  if (typeof globalThis.cancelAnimationFrame === "function") {
    globalThis.cancelAnimationFrame(handle);
  }
};
