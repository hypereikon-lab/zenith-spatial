import { Buffer } from "node:buffer";
import { API_BASE, API_VERSION, POLL_INTERVAL_MS, POLL_TIMEOUT_MS } from "./config";
import type {
  ApiJson,
  ApiPayload,
  DownloadOptions,
  ProgressWriter,
  RunwayOutput,
  RunwayPollOptions,
  RunwayRequestOptions,
  UploadedFileOptions,
} from "./types";
import { delay, httpError, throwIfAborted } from "./errors";
import { asRecord, formatDuration, titleCaseTaskStatus, tryParseJson } from "./utils";

export async function uploadEphemeralFile({
  apiKey,
  filename,
  buffer,
  mime,
  onProgress = () => {},
  signal,
}: UploadedFileOptions): Promise<string> {
  throwIfAborted(signal);
  onProgress({ type: "progress", stage: "Requesting upload", progress: 0.1 });
  const placeholder = await runwayJson(apiKey, "/v1/uploads", {
    method: "POST",
    body: { filename, type: "ephemeral" },
    signal,
  });
  throwIfAborted(signal);
  onProgress({ type: "progress", stage: "Uploading file", progress: 0.18 });
  const form = new FormData();
  for (const [key, value] of Object.entries(placeholder.fields || {})) {
    form.append(key, String(value));
  }
  const uploadBytes: Uint8Array<ArrayBuffer> = new Uint8Array(buffer.length);
  uploadBytes.set(buffer);
  form.append("file", new Blob([uploadBytes], { type: mime }), filename);
  const uploadUrl = String(placeholder.uploadUrl || "");
  if (!uploadUrl) {
    throw httpError(502, "Runway did not return an upload URL.");
  }
  const uploadResponse = await fetch(uploadUrl, {
    method: "POST",
    body: form,
    signal,
  });
  if (!uploadResponse.ok) {
    throw httpError(uploadResponse.status, `Runway upload failed (${uploadResponse.status}).`);
  }
  onProgress({ type: "progress", stage: "Upload done", progress: 0.3 });
  return String(placeholder.runwayUri || "");
}

export async function waitForRunwayTask(
  apiKey: string,
  taskId: unknown,
  onProgress: ProgressWriter = () => {},
  progressOptions: RunwayPollOptions = {},
): Promise<ApiJson> {
  throwIfAborted(progressOptions.signal);
  if (!taskId) {
    throw httpError(502, "Runway did not return a task id.");
  }
  const startProgress = progressOptions.start ?? 0.42;
  const endProgress = progressOptions.end ?? 0.9;
  const timeoutMs = progressOptions.timeoutMs ?? POLL_TIMEOUT_MS;
  const estimateMs = progressOptions.estimateMs ?? 3 * 60 * 1000;
  const label = progressOptions.label;
  const encodedTaskId = encodeURIComponent(String(taskId));
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    throwIfAborted(progressOptions.signal);
    const task = await runwayJson(apiKey, `/v1/tasks/${encodedTaskId}`, {
      signal: progressOptions.signal,
    });
    onProgress({
      type: "progress",
      stage: label || (task.status ? titleCaseTaskStatus(task.status) : "Generating"),
      progress: taskProgress(task, started, startProgress, endProgress, estimateMs),
      taskStatus: task.status,
      taskId,
    });
    const status = typeof task.status === "string" ? task.status : "";
    if (status === "SUCCEEDED") {
      return task;
    }
    if (["CANCELLED", "CANCELED"].includes(status)) {
      throw httpError(499, "Runway task was cancelled.");
    }
    if (status === "FAILED") {
      throw httpError(502, `Runway task ${status.toLowerCase()}.`);
    }
    await delay(POLL_INTERVAL_MS, progressOptions.signal);
  }
  throw httpError(504, `${label || "Runway task"} timed out after ${formatDuration(timeoutMs)}.`);
}

export async function downloadTaskOutputs(
  urls: unknown,
  onProgress: ProgressWriter = () => {},
  start = 0.92,
  end = 0.98,
  options: DownloadOptions = {},
): Promise<RunwayOutput[]> {
  throwIfAborted(options.signal);
  const outputUrls = Array.isArray(urls) ? urls : [];
  const outputs: RunwayOutput[] = [];
  const count = Math.max(1, outputUrls.length);
  for (const [index, item] of outputUrls.entries()) {
    throwIfAborted(options.signal);
    const url =
      typeof item === "string"
        ? item
        : item && typeof item === "object"
          ? String((item as ApiPayload).url || (item as ApiPayload).uri || "")
          : "";
    if (!url) continue;
    onProgress({
      type: "progress",
      stage: `Downloading ${index + 1}/${count}`,
      progress: start + (index / count) * (end - start),
    });
    const response = await fetch(url, { signal: options.signal });
    if (!response.ok) {
      if (options.outputSink) throw httpError(502, `Runway output download failed (${response.status}).`);
      outputs.push({ url });
      continue;
    }
    const contentType = response.headers.get("content-type") || options.fallbackContentType || "image/png";
    if (options.outputSink) {
      if (!response.body) throw httpError(502, "Runway output download returned an empty body.");
      outputs.push(
        await options.outputSink({
          body: response.body,
          contentLength: positiveContentLength(response.headers.get("content-length")),
          contentType,
          sourceUrl: url,
          index,
        }),
      );
    } else {
      const arrayBuffer = await response.arrayBuffer();
      const dataUri = `data:${contentType};base64,${Buffer.from(arrayBuffer).toString("base64")}`;
      outputs.push({ url, dataUri, contentType });
    }
  }
  onProgress({ type: "progress", stage: "Loading result", progress: end });
  return outputs;
}

function positiveContentLength(value: string | null): number | undefined {
  const length = Number(value);
  return Number.isSafeInteger(length) && length >= 0 ? length : undefined;
}

export async function cancelRunwayTask(apiKey: string, taskId: string, signal?: AbortSignal): Promise<void> {
  try {
    await runwayJson(apiKey, `/v1/tasks/${encodeURIComponent(taskId)}`, { method: "DELETE", signal });
  } catch (error) {
    if (Number((error as { status?: unknown } | null)?.status) === 404) return;
    throw error;
  }
}

export async function runwayJson(apiKey: string, path: string, options: RunwayRequestOptions = {}): Promise<ApiJson> {
  throwIfAborted(options.signal);
  const response = await fetch(`${API_BASE}${path}`, {
    method: options.method || "GET",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "X-Runway-Version": API_VERSION,
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
    signal: options.signal,
  });
  const text = await response.text();
  const json = text ? (tryParseJson(text) ?? {}) : {};
  if (!response.ok) {
    const errorBody = asRecord(json.error);
    const message = errorBody.message || json.error || json.message || text || `Runway API error (${response.status})`;
    throw httpError(response.status, String(message));
  }
  return json;
}

function taskProgress(task: ApiJson, started: number, start = 0.42, end = 0.9, estimateMs = 3 * 60 * 1000): number {
  const status = typeof task.status === "string" ? task.status : "";
  if (status === "SUCCEEDED") return end;
  if (["FAILED", "CANCELLED", "CANCELED"].includes(status)) return 1;
  const rawProgress = Number(task.progress ?? task.percentComplete ?? task.percentage);
  if (Number.isFinite(rawProgress)) {
    const normalized = rawProgress > 1 ? rawProgress / 100 : rawProgress;
    return start + Math.max(0, Math.min(1, normalized)) * (end - start);
  }
  const elapsed = Date.now() - started;
  const estimated = Math.min(1, elapsed / Math.max(1000, estimateMs));
  return Math.min(end - 0.01, start + estimated * (end - start));
}
