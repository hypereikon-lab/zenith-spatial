import { Buffer } from "node:buffer";
import { MAX_JSON_BYTES } from "./config";
import type { ApiPayload, JobOptions, ProgressWriter } from "./types";
import { errorMessage, errorStatus, httpError, throwIfAborted } from "./errors";

export async function readJsonPayload(request: Request): Promise<ApiPayload> {
  const contentLength = Number(request.headers.get("content-length") || 0);
  if (Number.isFinite(contentLength) && contentLength > MAX_JSON_BYTES) {
    throw httpError(413, "Request is too large.");
  }
  const text = await readBoundedRequestText(request);
  if (!text.trim()) return {};

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw httpError(400, "Request body must be valid JSON.");
  }
  if (!isApiPayload(parsed)) {
    throw httpError(400, "Request body must be a JSON object.");
  }
  return parsed;
}

export function streamProgressResponse(
  run: (onProgress: ProgressWriter, options: JobOptions) => Promise<unknown>,
  fallbackError: string,
  signal?: AbortSignal,
): Response {
  const encoder = new TextEncoder();
  let closed = false;
  let abortController: AbortController | null = null;
  const body = new ReadableStream({
    async start(controller) {
      abortController = new AbortController();
      const abort = () => abortController?.abort(signal?.reason);
      if (signal?.aborted) {
        abort();
      } else {
        signal?.addEventListener("abort", abort, { once: true });
      }

      const writeProgress: ProgressWriter = (event) => {
        if (closed) return;
        controller.enqueue(encoder.encode(JSON.stringify(event) + "\n"));
      };

      try {
        throwIfAborted(abortController.signal);
        const result = await run(writeProgress, { signal: abortController.signal });
        writeProgress({ type: "complete", stage: "Complete", progress: 1, result });
      } catch (error) {
        if (!closed) {
          writeProgress({
            type: "error",
            stage: "Failed",
            progress: 1,
            error: errorMessage(error) || fallbackError,
            status: errorStatus(error),
          });
        }
      } finally {
        signal?.removeEventListener("abort", abort);
        closed = true;
        abortController = null;
        try {
          controller.close();
        } catch {
          // The client may already have closed the stream.
        }
      }
    },
    cancel(reason) {
      closed = true;
      abortController?.abort(reason instanceof Error ? reason : httpError(499, "Response stream was cancelled."));
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

async function readBoundedRequestText(request: Request): Promise<string> {
  if (!request.body) return "";

  const reader = request.body.getReader();
  const decoder = new TextDecoder();
  let bytes = 0;
  let text = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      bytes += value.byteLength;
      if (bytes > MAX_JSON_BYTES) {
        throw httpError(413, "Request is too large.");
      }
      text += decoder.decode(value, { stream: true });
    }
    text += decoder.decode();
    if (Buffer.byteLength(text, "utf8") > MAX_JSON_BYTES) {
      throw httpError(413, "Request is too large.");
    }
    return text;
  } finally {
    reader.releaseLock();
  }
}

function isApiPayload(value: unknown): value is ApiPayload {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}
