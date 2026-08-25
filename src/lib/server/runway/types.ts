import type { Buffer } from "node:buffer";

export type ApiPayload = Record<string, unknown>;
export type ApiJson = Record<string, unknown>;

export type ProgressEvent = Record<string, unknown> & {
  type?: "progress" | "complete" | "error";
  stage?: string;
  progress?: number;
};

export type ProgressWriter = (event: ProgressEvent) => void;
export type RunwayOutputSinkInput = {
  body: ReadableStream<Uint8Array>;
  contentLength?: number;
  contentType: string;
  sourceUrl: string;
  index: number;
};
export type RunwayOutputSink = (input: RunwayOutputSinkInput) => Promise<RunwayOutput>;
export type JobOptions = { signal?: AbortSignal; outputSink?: RunwayOutputSink };
export type HttpStatusError = Error & { status?: number };

export type RunwayRequestOptions = JobOptions & {
  method?: "GET" | "POST" | "DELETE";
  body?: ApiJson;
};

export type RunwayPollOptions = JobOptions & {
  start?: number;
  end?: number;
  timeoutMs?: number;
  estimateMs?: number;
  label?: string;
};

export type DownloadOptions = JobOptions & {
  fallbackContentType?: string;
};

export type ParsedMediaDataUrl = {
  mime: string;
  buffer: Buffer;
};

export type UploadedFileOptions = ParsedMediaDataUrl &
  JobOptions & {
    apiKey: string;
    filename: string;
    onProgress?: ProgressWriter;
  };

export type RunwayOutput = {
  url: string;
  dataUri?: string;
  contentType?: string;
  name?: string;
};
