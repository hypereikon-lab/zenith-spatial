import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { basename, extname, resolve } from "node:path";

import { verifyApprovedReferences } from "./reference-review.mjs";

export function prepareRunwayImageRequest(raw, { createdAt = new Date().toISOString() } = {}) {
  const job = normalizeJob(raw, false);
  const references = job.references.map((reference, index) =>
    fileRecord(reference.path, { index, role: reference.role }),
  );
  const referenceReview = job.referenceReviewReceipt
    ? verifyApprovedReferences(references, job.referenceReviewReceipt)
    : null;
  const request = {
    schema: "zenith.runway-image-request.v1",
    createdAt: nonEmptyString(raw.createdAt) || createdAt,
    recipeId: job.recipeId,
    provider: "runway",
    invocation: job.invocation,
    model: job.model,
    ratio: job.ratio,
    count: 2,
    prompt: job.prompt,
    promptSha256: sha256(job.prompt),
    references,
    ...(referenceReview ? { referenceReview } : {}),
  };
  return { ...request, requestDigest: sha256(canonicalJson(request)) };
}

export function finalizeRunwayImageReceipt(raw, preparedRequest) {
  const job = normalizeJob(raw, true);
  const expected = prepareRunwayImageRequest(raw, { createdAt: preparedRequest?.createdAt });
  if (!preparedRequest || preparedRequest.schema !== "zenith.runway-image-request.v1") {
    throw new TypeError("A prepared zenith.runway-image-request.v1 receipt is required before finalization.");
  }
  if (preparedRequest.requestDigest !== expected.requestDigest) {
    throw new Error("The finalized Runway job differs from its prepared request; refusing ambiguous provenance.");
  }
  if (job.providerTaskIds.length === 0) {
    throw new RangeError("providerTaskIds must contain the Runway task id returned by the MCP call.");
  }

  const requestReceiptPath = existingFile(raw.requestReceipt, "requestReceipt");
  return {
    schema: "zenith.runway-image-generation.v1",
    createdAt: preparedRequest.createdAt,
    completedAt: nonEmptyString(raw.completedAt) || new Date().toISOString(),
    recipeId: job.recipeId,
    provider: "runway",
    invocation: job.invocation,
    model: job.model,
    ratio: job.ratio,
    count: 2,
    prompt: job.prompt,
    promptSha256: expected.promptSha256,
    requestDigest: expected.requestDigest,
    requestReceipt: fileRecord(requestReceiptPath),
    references: expected.references,
    ...(expected.referenceReview ? { referenceReview: expected.referenceReview } : {}),
    providerTaskIds: job.providerTaskIds,
    ...(job.creditsUsed === null ? {} : { creditsUsed: job.creditsUsed }),
    outputs: job.outputs.map((output, index) => ({
      ...fileRecord(output.path, { index }),
      ...(output.assetId ? { providerAssetId: output.assetId } : {}),
    })),
  };
}

export function normalizeRunwayImageJob(raw, { requireOutputs = false } = {}) {
  return normalizeJob(raw, requireOutputs);
}

function normalizeJob(raw, requireOutputs) {
  if (!raw || typeof raw !== "object") throw new TypeError("The Runway job must be a JSON object.");
  const count = raw.count ?? 2;
  if (count !== 2) throw new RangeError("Runway ecosystem synthesis jobs must request exactly 2 images.");
  const prompt = promptText(raw);
  const references = Array.isArray(raw.references)
    ? raw.references.map((reference, index) => {
        const candidate = typeof reference === "string" ? { path: reference } : reference;
        if (!candidate || typeof candidate !== "object") {
          throw new TypeError(`references[${index}] must be a path or object.`);
        }
        return {
          path: existingFile(candidate.path, `references[${index}].path`),
          role: nonEmptyString(candidate.role) || `reference_${String(index + 1).padStart(2, "0")}`,
        };
      })
    : [];
  if (references.length === 0) throw new RangeError("references must contain at least one direct image reference.");

  const outputs = Array.isArray(raw.outputs)
    ? raw.outputs.map((output, index) => {
        const candidate = typeof output === "string" ? { path: output } : output;
        if (!candidate || typeof candidate !== "object") throw new TypeError(`outputs[${index}] must be an object.`);
        return {
          path: requireOutputs
            ? existingFile(candidate.path, `outputs[${index}].path`)
            : resolveRequiredPath(candidate.path, `outputs[${index}].path`),
          assetId: nonEmptyString(candidate.assetId),
        };
      })
    : [];
  if (outputs.length !== 2) throw new RangeError("outputs must reserve exactly 2 ordered image paths.");

  const providerTaskIds = Array.isArray(raw.providerTaskIds)
    ? raw.providerTaskIds.map(nonEmptyString).filter(Boolean)
    : [];
  const creditsUsed = raw.creditsUsed === undefined ? null : Number(raw.creditsUsed);
  if (creditsUsed !== null && (!Number.isFinite(creditsUsed) || creditsUsed < 0)) {
    throw new RangeError("creditsUsed must be a non-negative number when supplied.");
  }
  const requireReferenceReview = optionalBoolean(raw.requireReferenceReview, "requireReferenceReview") ?? false;
  const referenceReviewReceipt = nonEmptyString(raw.referenceReviewReceipt)
    ? existingFile(raw.referenceReviewReceipt, "referenceReviewReceipt")
    : null;
  if (requireReferenceReview && !referenceReviewReceipt) {
    throw new Error("referenceReviewReceipt is required by this Runway job.");
  }
  return {
    recipeId: requiredString(raw.recipeId, "recipeId"),
    invocation: nonEmptyString(raw.invocation) || "runway-mcp",
    model: nonEmptyString(raw.model) || "gpt-image-2",
    ratio: nonEmptyString(raw.ratio) || "16:9",
    count,
    prompt,
    references,
    outputs,
    providerTaskIds,
    creditsUsed,
    requireReferenceReview,
    referenceReviewReceipt,
  };
}

function promptText(raw) {
  const inline = nonEmptyString(raw.prompt);
  const promptFile = nonEmptyString(raw.promptFile);
  if (inline && promptFile) throw new TypeError("Use prompt or promptFile, not both.");
  if (inline) return inline;
  if (promptFile) return readFileSync(existingFile(promptFile, "promptFile"), "utf8");
  throw new TypeError("A non-empty prompt or promptFile is required.");
}

function fileRecord(path, extra = {}) {
  const bytes = readFileSync(path);
  return {
    ...extra,
    filename: basename(path),
    mime: mimeForPath(path),
    bytes: bytes.byteLength,
    sha256: sha256(bytes),
    source: path,
  };
}

function existingFile(value, label) {
  const path = resolveRequiredPath(value, label);
  if (!existsSync(path)) throw new Error(`${label} does not exist: ${path}`);
  return path;
}

function resolveRequiredPath(value, label) {
  if (typeof value !== "string" || value.length === 0) throw new TypeError(`${label} must be a file path.`);
  return resolve(value);
}

function requiredString(value, label) {
  const result = nonEmptyString(value);
  if (!result) throw new TypeError(`${label} must be a non-empty string.`);
  return result;
}

function nonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function optionalBoolean(value, label) {
  if (value === undefined || value === null) return null;
  if (typeof value !== "boolean") throw new TypeError(`${label} must be a boolean when supplied.`);
  return value;
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function canonicalJson(value) {
  return JSON.stringify(sortKeys(value));
}

function sortKeys(value) {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, sortKeys(value[key])]),
  );
}

function mimeForPath(path) {
  const extension = extname(path).toLowerCase();
  if (extension === ".png") return "image/png";
  if (extension === ".webp") return "image/webp";
  if (extension === ".json") return "application/json";
  return "image/jpeg";
}
