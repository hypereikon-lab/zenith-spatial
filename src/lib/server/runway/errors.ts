import type { HttpStatusError } from "./types";

export function httpError(status: number, message: string): HttpStatusError {
  const error = new Error(message) as HttpStatusError;
  error.status = status;
  return error;
}

export function throwIfAborted(signal?: AbortSignal): void {
  if (!signal?.aborted) return;
  if (signal.reason instanceof Error) {
    throw signal.reason;
  }
  const error = new Error("Request aborted.") as HttpStatusError;
  error.name = "AbortError";
  error.status = 499;
  throw error;
}

export function delay(ms: number, signal?: AbortSignal): Promise<void> {
  throwIfAborted(signal);
  return new Promise((resolveDelay, rejectDelay) => {
    const timeout = setTimeout(() => {
      signal?.removeEventListener("abort", abortDelay);
      resolveDelay();
    }, ms);

    function abortDelay() {
      clearTimeout(timeout);
      rejectDelay(signal?.reason instanceof Error ? signal.reason : httpError(499, "Request aborted."));
    }

    signal?.addEventListener("abort", abortDelay, { once: true });
  });
}

export function errorStatus(error: unknown): number {
  return Number((error as Partial<HttpStatusError> | null)?.status) || 500;
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error || "Server error");
}
