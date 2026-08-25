import { createReadStream } from "node:fs";
import { Readable } from "node:stream";
import type { JobOutputStore, StoredJobOutput } from "./job-output-store";

export async function jobOutputResponse(
  jobId: string,
  outputId: string,
  request: Request,
  store: JobOutputStore,
): Promise<Response> {
  let output: StoredJobOutput | null;
  try {
    output = await store.get(jobId, outputId);
  } catch {
    return new Response("Invalid job output request.", { status: 400 });
  }
  if (!output) return new Response("Job output was not found.", { status: 404 });
  const range = parseByteRange(request.headers.get("range"), output.byteLength);
  if (range === "invalid") {
    return new Response(null, {
      status: 416,
      headers: { "Content-Range": `bytes */${output.byteLength}`, "Accept-Ranges": "bytes" },
    });
  }
  const start = range?.start ?? 0;
  const end = range?.end ?? Math.max(0, output.byteLength - 1);
  const length = output.byteLength === 0 ? 0 : end - start + 1;
  const headers = new Headers({
    "Accept-Ranges": "bytes",
    "Cache-Control": "private, max-age=31536000, immutable",
    "Content-Disposition": `inline; filename*=UTF-8''${encodeURIComponent(output.name)}`,
    "Content-Length": String(length),
    "Content-Type": output.contentType,
    ETag: `"sha256-${output.sha256}"`,
  });
  if (range) headers.set("Content-Range", `bytes ${start}-${end}/${output.byteLength}`);
  if (request.method === "HEAD" || output.byteLength === 0) {
    return new Response(null, { status: range ? 206 : 200, headers });
  }
  const nodeStream = createReadStream(output.path, { start, end });
  const body = Readable.toWeb(nodeStream) as ReadableStream<Uint8Array>;
  return new Response(body, { status: range ? 206 : 200, headers });
}

export function parseByteRange(value: string | null, size: number): { start: number; end: number } | "invalid" | null {
  if (!value) return null;
  const match = /^bytes=(\d*)-(\d*)$/.exec(value.trim());
  if (!match || size <= 0) return "invalid";
  const [, startText, endText] = match;
  if (!startText && !endText) return "invalid";
  if (!startText) {
    const suffix = Number(endText);
    if (!Number.isSafeInteger(suffix) || suffix <= 0) return "invalid";
    return { start: Math.max(0, size - suffix), end: size - 1 };
  }
  const start = Number(startText);
  const requestedEnd = endText ? Number(endText) : size - 1;
  if (
    !Number.isSafeInteger(start) ||
    !Number.isSafeInteger(requestedEnd) ||
    start < 0 ||
    requestedEnd < start ||
    start >= size
  ) {
    return "invalid";
  }
  return { start, end: Math.min(requestedEnd, size - 1) };
}
