import type { ApiJson, ApiPayload, JobOptions, ProgressWriter } from "./types";
import { getRunwayApiKey, INPAINT_MODEL, INPAINT_MODEL_CONFIG } from "./config";
import { httpError, throwIfAborted } from "./errors";
import { downloadTaskOutputs, runwayJson, uploadEphemeralFile, waitForRunwayTask } from "./http";
import { parseImageDataUrl, safeMediaFilename } from "./media";
import { clampInt, clampPrompt, sanitizeChoice, sanitizeRatio, sanitizeReferenceTag } from "./utils";
import { validateRunwayInpaintPayload } from "./schemas";

export async function requestRunwayInpaint(
  payload: ApiPayload,
  onProgress: ProgressWriter = () => {},
  options: JobOptions = {},
) {
  payload = validateRunwayInpaintPayload(payload);
  throwIfAborted(options.signal);
  onProgress({ type: "progress", stage: "Validating", progress: 0.03 });
  const apiKey = getRunwayApiKey();
  if (!apiKey) throw httpError(401, "Set RUNWAYML_API_SECRET before using image generation.");

  const model = INPAINT_MODEL;
  const config = INPAINT_MODEL_CONFIG;
  const { buffer, mime } = parseImageDataUrl(payload.imageDataUrl);
  const sourceImage = payload.sourceImageDataUrl ? parseImageDataUrl(payload.sourceImageDataUrl) : null;
  const referenceUri = await uploadEphemeralFile({
    apiKey,
    filename: "zenith-plate-sketch-" + Date.now() + ".png",
    buffer,
    mime,
    onProgress,
    signal: options.signal,
  });
  const sourceUri = sourceImage
    ? await uploadEphemeralFile({
        apiKey,
        filename: safeMediaFilename(payload.sourceFilename, "zenith-source-" + Date.now() + ".png"),
        buffer: sourceImage.buffer,
        mime: sourceImage.mime,
        onProgress,
        signal: options.signal,
      })
    : null;
  const references = [
    ...(sourceUri ? [{ uri: sourceUri, tag: sanitizeReferenceTag(payload.sourceImageTag, "source") }] : []),
    { uri: referenceUri, tag: sanitizeReferenceTag(payload.referenceImageTag, "plate_sketch") },
  ];
  const extras = Array.isArray(payload.extraReferenceImages) ? payload.extraReferenceImages : [];
  for (let index = 0; index < extras.length && references.length < config.maxReferences; index += 1) {
    const extra = extras[index];
    if (!extra || typeof extra !== "object") continue;
    const tag = sanitizeReferenceTag(extra.tag, "ref" + (index + 1));
    if (typeof extra.uri === "string" && extra.uri.trim()) {
      references.push({ uri: extra.uri.trim(), tag });
      continue;
    }
    const dataUrl = String(extra.imageDataUrl || extra.dataUri || "");
    if (!dataUrl) continue;
    const image = parseImageDataUrl(dataUrl);
    const uri = await uploadEphemeralFile({
      apiKey,
      filename: safeMediaFilename(extra.filename, "zenith-reference-" + (index + 1) + ".png"),
      buffer: image.buffer,
      mime: image.mime,
      onProgress,
      signal: options.signal,
    });
    references.push({ uri, tag });
  }
  const body: ApiJson = {
    model,
    promptText: clampPrompt(String(payload.prompt || ""), config.maxPrompt),
    ratio: sanitizeRatio(payload.ratio, config.ratio),
    referenceImages: references,
    outputCount: clampInt(payload.outputCount, 1, 10),
    background: "opaque",
    quality: sanitizeChoice(payload.quality, ["low", "medium", "high", "auto"], "auto"),
  };
  onProgress({ type: "progress", stage: "Creating task", progress: 0.34 });
  const task = await runwayJson(apiKey, "/v1/text_to_image", {
    method: "POST",
    body,
    signal: options.signal,
  });
  onProgress({ type: "progress", stage: "Queued", progress: 0.42, taskId: task.id });
  const completed = await waitForRunwayTask(apiKey, task.id, onProgress, { signal: options.signal });
  onProgress({ type: "progress", stage: "Downloading", progress: 0.92 });
  const outputs = await downloadTaskOutputs(completed.output || [], onProgress, 0.92, 0.98, {
    signal: options.signal,
    outputSink: options.outputSink,
  });
  return { id: completed.id || task.id, status: completed.status, model, ratio: body.ratio, outputs };
}
