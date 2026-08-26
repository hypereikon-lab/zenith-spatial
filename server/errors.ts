import { Data } from "effect";

import type { PublicJobError } from "../src/domain/schema.js";

export class ZenithServerError extends Data.TaggedError("ZenithServerError")<{
  readonly message: string;
  readonly status: number;
  readonly code: PublicJobError["code"];
  readonly provider: PublicJobError["provider"];
  readonly cause?: unknown;
}> {}

export function invalidInput(message: string, cause?: unknown): ZenithServerError {
  return new ZenithServerError({ message, status: 400, code: "invalid_input", provider: "zenith", cause });
}

export function missingSecret(): ZenithServerError {
  return new ZenithServerError({
    message: "Set RUNWAYML_API_SECRET before using image generation.",
    status: 503,
    code: "missing_secret",
    provider: "zenith",
  });
}

export function notFound(message: string): ZenithServerError {
  return new ZenithServerError({ message, status: 404, code: "invalid_input", provider: "zenith" });
}

export function confirmationRejected(message: string): ZenithServerError {
  return new ZenithServerError({ message, status: 403, code: "invalid_input", provider: "zenith" });
}

export function serverFailure(message: string, cause?: unknown): ZenithServerError {
  return new ZenithServerError({ message, status: 500, code: "server_error", provider: "zenith", cause });
}

export function upstreamFailure(message: string, status = 502, cause?: unknown): ZenithServerError {
  return new ZenithServerError({ message, status, code: "upstream_failed", provider: "runway", cause });
}

export function timeoutFailure(message: string): ZenithServerError {
  return new ZenithServerError({ message, status: 504, code: "timeout", provider: "runway" });
}

export function cancelledFailure(message = "Generation was cancelled."): ZenithServerError {
  return new ZenithServerError({ message, status: 499, code: "cancelled", provider: "runway" });
}

export function publicJobError(error: ZenithServerError): PublicJobError {
  return {
    message: error.message,
    status: error.status,
    code: error.code,
    provider: error.provider,
  };
}

export function asServerError(cause: unknown, fallback: string): ZenithServerError {
  if (cause instanceof ZenithServerError) return cause;
  return serverFailure(fallback, cause);
}
