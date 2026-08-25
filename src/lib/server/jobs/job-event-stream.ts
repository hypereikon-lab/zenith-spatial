import { httpError } from "$lib/server/runway/errors";
import type { JobStore } from "./job-store";
import { isTerminalJobStatus } from "./in-memory-job-store";
import { serverJobStore } from "./server-job-store";
import type { JobEventV1 } from "$lib/shared/contracts/jobs";

type JobEventStreamOptions = {
  store?: JobStore;
  signal?: AbortSignal;
  cancelJobOnClose?: boolean;
};

export function jobEventStreamResponse(
  jobId: string,
  { store = serverJobStore, signal, cancelJobOnClose = false }: JobEventStreamOptions = {},
): Response | null {
  if (!store.getJob(jobId)) return null;

  const encoder = new TextEncoder();
  let closed = false;
  let unsubscribe: (() => void) | null = null;

  const body = new ReadableStream({
    start(controller) {
      const closeController = () => {
        signal?.removeEventListener("abort", abort);
        unsubscribe?.();
        try {
          controller.close();
        } catch {
          // The stream may already be closed by the client.
        }
      };

      const close = () => {
        if (closed) return;
        closed = true;
        closeController();
      };

      const write = (event: JobEventV1) => {
        if (closed) return;
        controller.enqueue(encoder.encode(JSON.stringify(event) + "\n"));
        if (isTerminalEvent(event)) close();
      };

      const abort = () => {
        if (closed) return;
        closed = true;
        unsubscribe?.();
        if (cancelJobOnClose) {
          store.cancelJob(jobId, signal?.reason || httpError(499, "Request aborted."));
        }
        closeController();
      };

      if (signal?.aborted) {
        abort();
        return;
      }
      signal?.addEventListener("abort", abort, { once: true });

      let shouldUnsubscribe = false;
      unsubscribe = store.subscribeEvents(
        jobId,
        (event) => {
          write(event);
          if (isTerminalEvent(event)) shouldUnsubscribe = true;
        },
        { replay: true },
      );
      if (!unsubscribe) {
        close();
        return;
      }
      if (shouldUnsubscribe) {
        unsubscribe();
      }
    },
    cancel(reason) {
      closed = true;
      unsubscribe?.();
      if (cancelJobOnClose) {
        store.cancelJob(jobId, reason instanceof Error ? reason : httpError(499, "Response stream was cancelled."));
      }
    },
  });

  return new Response(body, {
    headers: {
      "Content-Type": "application/x-ndjson",
      "Cache-Control": "no-cache, no-transform",
      "X-Accel-Buffering": "no",
    },
  });
}

function isTerminalEvent(event: JobEventV1): boolean {
  return isTerminalJobStatus(event.status);
}
