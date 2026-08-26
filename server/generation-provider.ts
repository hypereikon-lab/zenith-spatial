import { Context, Effect, Layer, Stream } from "effect";

import type { GenerationInput, GenerationServiceStatus } from "../src/domain/schema.js";
import { ZenithServerConfig } from "./config.js";
import { cancelledFailure, missingSecret, timeoutFailure, upstreamFailure, type ZenithServerError } from "./errors.js";
import { parseImageDataUrl } from "./generation-validation.js";

export type ProviderProgress = {
  readonly type: "progress";
  readonly stage: string;
  readonly progress: number;
  readonly taskId?: string;
};

export type ProviderOutput = {
  readonly type: "output";
  readonly bytes: Uint8Array;
  readonly contentType: string;
  readonly filename: string;
};

export type ProviderEvent = ProviderProgress | ProviderOutput;

export interface GenerationProviderShape {
  readonly status: GenerationServiceStatus;
  readonly generate: (input: GenerationInput) => Stream.Stream<ProviderEvent, ZenithServerError>;
}

export class GenerationProvider extends Context.Tag("zenith/server/GenerationProvider")<
  GenerationProvider,
  GenerationProviderShape
>() {
  static readonly Live = Layer.effect(
    GenerationProvider,
    Effect.gen(function* () {
      const config = yield* ZenithServerConfig;
      const status: GenerationServiceStatus = {
        configured: config.runwayApiSecret.trim().length > 0,
        provider: "runway",
        model: "gpt_image_2",
      };
      return {
        status,
        generate: (input) => (status.configured ? runwayGenerationStream(config, input) : Stream.fail(missingSecret())),
      } satisfies GenerationProviderShape;
    }),
  );

  static test(generate: GenerationProviderShape["generate"], configured = true) {
    return Layer.succeed(GenerationProvider, {
      status: { configured, provider: "runway", model: "gpt_image_2" },
      generate,
    });
  }
}

type RunwayState = {
  readonly controller: AbortController;
  taskId: string | null;
  done: boolean;
};

function runwayGenerationStream(
  config: ZenithServerConfig["Type"],
  input: GenerationInput,
): Stream.Stream<ProviderEvent, ZenithServerError> {
  return Stream.asyncPush<ProviderEvent, ZenithServerError>(
    (emit) =>
      Effect.acquireRelease(
        Effect.sync(() => {
          const state: RunwayState = { controller: new AbortController(), taskId: null, done: false };
          void generateRunway(config, input, state, (event) => {
            emit.single(event);
          }).then(
            (outputs) => {
              state.done = true;
              for (const output of outputs) emit.single(output);
              emit.end();
            },
            (cause) => emit.fail(providerError(cause)),
          );
          return state;
        }),
        (state) =>
          Effect.promise(async () => {
            state.controller.abort();
            if (!state.done && state.taskId) {
              await cancelRunwayTask(config, state.taskId).catch(() => undefined);
            }
          }),
      ),
    { bufferSize: 32, strategy: "sliding" },
  );
}

async function generateRunway(
  config: ZenithServerConfig["Type"],
  input: GenerationInput,
  state: RunwayState,
  report: (event: ProviderProgress) => void,
): Promise<ProviderOutput[]> {
  const signal = state.controller.signal;
  report({ type: "progress", stage: "Validating", progress: 0.03 });
  const plate = parseImageDataUrl(input.imageDataUrl);
  const plateUri = await uploadEphemeral(
    config,
    plate.bytes,
    plate.mime,
    "zenith-plate-sketch.png",
    signal,
    (progress) => report({ type: "progress", stage: "Uploading Plate Sketch", progress }),
  );
  const references: Array<{ uri: string; tag: string }> = [{ uri: plateUri, tag: "plate_sketch" }];
  const sourceCount = input.sourceReferences.length;
  for (const [index, reference] of input.sourceReferences.entries()) {
    const source = parseImageDataUrl(reference.imageDataUrl);
    const start = 0.18 + (index / Math.max(1, sourceCount)) * 0.12;
    const end = 0.18 + ((index + 1) / Math.max(1, sourceCount)) * 0.12;
    const uri = await uploadEphemeral(
      config,
      source.bytes,
      source.mime,
      safeFilename(reference.filename, `source-${index + 1}.png`),
      signal,
      (fraction) =>
        report({
          type: "progress",
          stage: `Uploading appearance reference ${index + 1}/${sourceCount}`,
          progress: start + fraction * (end - start),
        }),
    );
    references.push({ uri, tag: safeReferenceTag(reference.tag, `source_${index + 1}`) });
  }

  report({ type: "progress", stage: "Creating Runway task", progress: 0.34 });
  const created = await runwayJson(config, "/v1/text_to_image", {
    method: "POST",
    signal,
    body: {
      model: input.model,
      promptText: input.prompt,
      ratio: input.ratio,
      referenceImages: references,
      outputCount: input.outputCount,
      background: "opaque",
      quality: input.quality,
    },
  });
  const taskId = stringValue(created.id);
  if (!taskId) throw upstreamFailure("Runway did not return a task id.");
  state.taskId = taskId;
  report({ type: "progress", stage: "Queued", progress: 0.42, taskId });

  const startedAt = Date.now();
  let completed: Record<string, unknown> | null = null;
  while (Date.now() - startedAt < config.runwayPollTimeoutMs) {
    assertNotAborted(signal);
    const task = await runwayJson(config, `/v1/tasks/${encodeURIComponent(taskId)}`, { signal });
    const taskStatus = stringValue(task.status).toUpperCase();
    report({
      type: "progress",
      stage: titleCase(taskStatus || "GENERATING"),
      progress: providerTaskProgress(task, startedAt),
      taskId,
    });
    if (taskStatus === "SUCCEEDED") {
      completed = task;
      break;
    }
    if (taskStatus === "FAILED") throw upstreamFailure("Runway generation failed.");
    if (taskStatus === "CANCELLED" || taskStatus === "CANCELED") throw cancelledFailure();
    await abortableDelay(config.runwayPollIntervalMs, signal);
  }
  if (!completed) throw timeoutFailure("Runway generation timed out.");

  const outputUrls = Array.isArray(completed.output) ? completed.output : [];
  if (outputUrls.length === 0) throw upstreamFailure("Runway returned no image outputs.");
  const outputs: ProviderOutput[] = [];
  for (const [index, item] of outputUrls.entries()) {
    const url = outputUrl(item);
    if (!url) continue;
    report({
      type: "progress",
      stage: `Downloading output ${index + 1}/${outputUrls.length}`,
      progress: 0.92 + (index / outputUrls.length) * 0.06,
      taskId,
    });
    const response = await fetch(url, { signal });
    if (!response.ok) throw upstreamFailure(`Runway output download failed (${response.status}).`);
    const contentType = normalizedContentType(response.headers.get("content-type") ?? "image/png");
    outputs.push({
      type: "output",
      bytes: new Uint8Array(await response.arrayBuffer()),
      contentType,
      filename: `zenith-image-take-${index + 1}.${extensionFor(contentType)}`,
    });
  }
  if (outputs.length === 0) throw upstreamFailure("Runway returned no readable image outputs.");
  report({ type: "progress", stage: "Finalizing outputs", progress: 0.99, taskId });
  return outputs;
}

async function uploadEphemeral(
  config: ZenithServerConfig["Type"],
  bytes: Uint8Array,
  mime: string,
  filename: string,
  signal: AbortSignal,
  progress: (fraction: number) => void,
): Promise<string> {
  progress(0.1);
  const placeholder = await runwayJson(config, "/v1/uploads", {
    method: "POST",
    signal,
    body: { filename, type: "ephemeral" },
  });
  const uploadUrl = stringValue(placeholder.uploadUrl);
  const runwayUri = stringValue(placeholder.runwayUri);
  if (!uploadUrl || !runwayUri) throw upstreamFailure("Runway did not return an upload target.");
  const form = new FormData();
  const fields = recordValue(placeholder.fields);
  for (const [key, value] of Object.entries(fields)) form.append(key, String(value));
  form.append("file", new Blob([new Uint8Array(bytes)], { type: mime }), filename);
  progress(0.5);
  const response = await fetch(uploadUrl, { method: "POST", body: form, signal });
  if (!response.ok) throw upstreamFailure(`Runway upload failed (${response.status}).`);
  progress(1);
  return runwayUri;
}

async function runwayJson(
  config: ZenithServerConfig["Type"],
  path: string,
  options: { readonly method?: "GET" | "POST" | "DELETE"; readonly body?: unknown; readonly signal: AbortSignal },
): Promise<Record<string, unknown>> {
  assertNotAborted(options.signal);
  const response = await fetch(`${config.runwayApiBase}${path}`, {
    method: options.method ?? "GET",
    headers: {
      authorization: `Bearer ${config.runwayApiSecret}`,
      "content-type": "application/json",
      "x-runway-version": config.runwayApiVersion,
    },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
    signal: options.signal,
  });
  const text = await response.text();
  const value = text ? safeJson(text) : {};
  if (!response.ok) {
    const error = recordValue(recordValue(value).error);
    const message = stringValue(error.message) || stringValue(recordValue(value).message);
    throw upstreamFailure(message || `Runway API request failed (${response.status}).`);
  }
  return recordValue(value);
}

async function cancelRunwayTask(config: ZenithServerConfig["Type"], taskId: string): Promise<void> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5_000);
  try {
    await runwayJson(config, `/v1/tasks/${encodeURIComponent(taskId)}`, {
      method: "DELETE",
      signal: controller.signal,
    });
  } catch {
    // Cancellation is best effort; the local job remains authoritatively cancelled.
  } finally {
    clearTimeout(timeout);
  }
}

function providerTaskProgress(task: Record<string, unknown>, startedAt: number): number {
  const raw = Number(task.progress ?? task.percentComplete ?? task.percentage);
  if (Number.isFinite(raw)) {
    const normalized = raw > 1 ? raw / 100 : raw;
    return 0.42 + Math.max(0, Math.min(1, normalized)) * 0.48;
  }
  const estimate = Math.min(1, (Date.now() - startedAt) / (3 * 60 * 1_000));
  return Math.min(0.89, 0.42 + estimate * 0.48);
}

function outputUrl(value: unknown): string {
  if (typeof value === "string") return value;
  const record = recordValue(value);
  return stringValue(record.url) || stringValue(record.uri);
}

function providerError(cause: unknown): ZenithServerError {
  if (cause && typeof cause === "object" && "_tag" in cause && cause._tag === "ZenithServerError") {
    return cause as ZenithServerError;
  }
  if (cause instanceof DOMException && cause.name === "AbortError") return cancelledFailure();
  if (cause instanceof Error && cause.name === "AbortError") return cancelledFailure();
  return upstreamFailure("Runway generation could not be completed.", 502, cause);
}

function assertNotAborted(signal: AbortSignal): void {
  if (signal.aborted) throw cancelledFailure();
}

function abortableDelay(milliseconds: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(cancelledFailure());
      return;
    }
    const timeout = setTimeout(done, milliseconds);
    function done() {
      signal.removeEventListener("abort", aborted);
      resolve();
    }
    function aborted() {
      clearTimeout(timeout);
      signal.removeEventListener("abort", aborted);
      reject(cancelledFailure());
    }
    signal.addEventListener("abort", aborted, { once: true });
  });
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return {};
  }
}

function recordValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function safeReferenceTag(value: string, fallback: string): string {
  return (
    value
      .replace(/[^a-zA-Z0-9_]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, 64) || fallback
  );
}

function safeFilename(value: string, fallback: string): string {
  return (
    value
      .split(/[\\/]/)
      .pop()
      ?.replace(/[^a-zA-Z0-9_.-]+/g, "-")
      .slice(0, 160) || fallback
  );
}

function normalizedContentType(value: string): string {
  const type = value.split(";")[0]!.trim().toLowerCase();
  return /^image\/[a-z0-9.+-]+$/.test(type) ? type : "image/png";
}

function extensionFor(contentType: string): string {
  if (contentType === "image/jpeg") return "jpg";
  if (contentType === "image/webp") return "webp";
  return "png";
}

function titleCase(value: string): string {
  return value
    .toLowerCase()
    .split(/[_\s-]+/)
    .filter(Boolean)
    .map((part) => part[0]!.toUpperCase() + part.slice(1))
    .join(" ");
}
