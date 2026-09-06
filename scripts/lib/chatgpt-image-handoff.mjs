import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { basename, extname, resolve } from "node:path";

import { verifyApprovedReferences } from "./reference-review.mjs";

const DEFAULT_URL = "https://chatgpt.com/images";
const SOURCE_REFERENCE_ROLES = new Set([
  "reference",
  "plate_direct_reference",
  "scene_context_reference",
  "supplemental_reference",
]);

export function prepareChatGptImageHandoff(raw, { createdAt = new Date().toISOString() } = {}) {
  const job = normalizeJob(raw, false);
  const { candidates, provenance, conditioning } = compileAttachmentCandidates(job);
  const attachments = deduplicateBySha256(candidates).map((record, index) => ({
    ...record,
    imageIndex: index + 1,
  }));
  const reviewTargets =
    job.referenceReviewScope === "source-references"
      ? attachments.filter(({ role }) => SOURCE_REFERENCE_ROLES.has(role))
      : attachments;
  if (job.referenceReviewReceipt && reviewTargets.length === 0) {
    throw new Error(`referenceReviewScope ${job.referenceReviewScope} selected no reviewable attachments.`);
  }
  const verifiedReferenceReview = job.referenceReviewReceipt
    ? verifyApprovedReferences(reviewTargets, job.referenceReviewReceipt, {
        label: job.referenceReviewScope === "source-references" ? "source references" : "attachments",
      })
    : null;
  const referenceReview = verifiedReferenceReview
    ? {
        ...verifiedReferenceReview,
        ...(job.referenceReviewScope === "source-references" ? { scope: job.referenceReviewScope } : {}),
      }
    : null;
  const request = {
    schema: "zenith.chatgpt-image-handoff.v1",
    createdAt: nonEmptyString(raw.createdAt) || createdAt,
    recipeId: job.recipeId,
    provider: "openai-chatgpt",
    productSurface: "chatgpt-images-2.5",
    invocation: "codex-in-app-browser",
    url: job.url,
    prompt: job.prompt,
    promptSha256: sha256(job.prompt),
    promptUiCanonical: canonicalizePromptForUi(job.prompt),
    promptUiCanonicalSha256: sha256(canonicalizePromptForUi(job.prompt)),
    attachments,
    provenance,
    conditioning,
    ...(referenceReview ? { referenceReview } : {}),
    plannedOutput: job.output,
    browserContract: {
      requireDedicatedInAppTab: true,
      requireCleanComposer: true,
      transport: "binary-clipboard",
      pasteOneAtATime: true,
      verifyCountAfterEveryPaste: true,
      promptVerification: "collapse-whitespace",
      submitExactlyOnce: true,
    },
  };
  return { ...request, requestDigest: sha256(canonicalJson(request)) };
}

export function canonicalizePromptForUi(value) {
  return value.replace(/\s+/gu, " ").trim();
}

export function finalizeChatGptImageHandoff(raw, preparedRequest) {
  const job = normalizeJob(raw, true);
  if (!preparedRequest || preparedRequest.schema !== "zenith.chatgpt-image-handoff.v1") {
    throw new TypeError("A prepared zenith.chatgpt-image-handoff.v1 receipt is required before finalization.");
  }
  const expected = prepareChatGptImageHandoff(raw, { createdAt: preparedRequest.createdAt });
  if (preparedRequest.requestDigest !== expected.requestDigest) {
    throw new Error(
      "The finalized ChatGPT Images job differs from its prepared handoff; refusing ambiguous provenance.",
    );
  }

  return {
    schema: "zenith.chatgpt-image-generation.v2",
    createdAt: preparedRequest.createdAt,
    completedAt: nonEmptyString(raw.completedAt) || new Date().toISOString(),
    recipeId: job.recipeId,
    provider: preparedRequest.provider,
    productSurface: preparedRequest.productSurface,
    invocation: preparedRequest.invocation,
    conversationUrl: job.conversationUrl,
    prompt: preparedRequest.prompt,
    promptSha256: preparedRequest.promptSha256,
    requestDigest: preparedRequest.requestDigest,
    attachments: preparedRequest.attachments,
    ...(preparedRequest.referenceReview ? { referenceReview: preparedRequest.referenceReview } : {}),
    output: fileRecord(job.output),
  };
}

export function normalizeChatGptImageJob(raw, { requireOutput = false } = {}) {
  return normalizeJob(raw, requireOutput);
}

function normalizeJob(raw, requireOutput) {
  if (!raw || typeof raw !== "object") throw new TypeError("The ChatGPT Images job must be a JSON object.");
  const plateSketch = existingFile(raw.plateSketch, "plateSketch");
  const references = Array.isArray(raw.references)
    ? raw.references.map((value, index) => existingFile(value, `references[${index}]`))
    : [];
  const inferredManifest = `${plateSketch}.manifest.json`;
  const plateManifest = raw.plateManifest
    ? existingFile(raw.plateManifest, "plateManifest")
    : existsSync(inferredManifest)
      ? inferredManifest
      : null;
  if (references.length === 0 && !plateManifest) {
    throw new RangeError("Provide plateManifest or at least one reference image path.");
  }

  const output = requiredPath(raw.output, "output");
  if (requireOutput && !existsSync(output)) throw new Error(`output does not exist: ${output}`);

  const requireReferenceReview = optionalBoolean(raw.requireReferenceReview, "requireReferenceReview") ?? false;
  const referenceReviewScope = nonEmptyString(raw.referenceReviewScope) || "all-attachments";
  if (referenceReviewScope !== "all-attachments" && referenceReviewScope !== "source-references") {
    throw new RangeError("referenceReviewScope must be all-attachments or source-references.");
  }
  const referenceReviewReceipt = nonEmptyString(raw.referenceReviewReceipt)
    ? existingFile(raw.referenceReviewReceipt, "referenceReviewReceipt")
    : null;
  if (requireReferenceReview && !referenceReviewReceipt) {
    throw new Error("referenceReviewReceipt is required by this ChatGPT Images job.");
  }

  return {
    recipeId: requiredString(raw.recipeId, "recipeId"),
    url: nonEmptyString(raw.url) || DEFAULT_URL,
    plateSketch,
    plateManifest,
    references,
    contextPolicy: normalizeContextPolicy(raw.contextPolicy),
    prompt: promptText(raw),
    output,
    conversationUrl: requireOutput ? chatGptConversationUrl(raw.conversationUrl) : null,
    requireReferenceReview,
    referenceReviewScope,
    referenceReviewReceipt,
  };
}

function compileAttachmentCandidates(job) {
  const plateSketch = fileRecord(job.plateSketch, { role: "plate_sketch", requestedIndex: 0 });
  const sceneContext = compileSceneContext(job.contextPolicy);
  if (!job.plateManifest) {
    return {
      candidates: [
        plateSketch,
        ...job.references.map((path, index) => fileRecord(path, { role: "reference", requestedIndex: index + 1 })),
        ...sceneContext.candidates,
      ],
      provenance: { mode: "manual", ancestryDepth: 0 },
      conditioning: sceneContext.conditioning,
    };
  }

  const manifestBytes = readFileSync(job.plateManifest);
  const manifest = parseComposeManifest(manifestBytes, job.plateManifest);
  if (manifest.output.sha256 !== plateSketch.sha256) {
    throw new Error(
      `plateSketch does not match the compose manifest output: expected ${manifest.output.sha256}, received ${plateSketch.sha256}.`,
    );
  }

  const manualRecords = job.references.map((path) => fileRecord(path));
  const plateSources = manifest.sources.map((source, arrayIndex) => {
    const sourceIndex = integerOr(source.index, arrayIndex);
    const sourcePath = locateManifestSource(source, manualRecords, `plateManifest.sources[${arrayIndex}]`);
    return verifiedManifestFile(sourcePath, source.sha256, `plateManifest.sources[${arrayIndex}]`, {
      role: "plate_source",
      plateSourceIndex: sourceIndex,
      ...(nonEmptyString(source.slot) ? { plateSlot: source.slot.trim() } : {}),
      ...(source.generationReceipt
        ? { generationReceipt: verifiedReceiptRecord(source.generationReceipt, arrayIndex) }
        : {}),
    });
  });

  const directReferences = manifest.sources.flatMap((source, arrayIndex) => {
    const sourceIndex = integerOr(source.index, arrayIndex);
    if (!Array.isArray(source.directReferences)) return [];
    return source.directReferences.map((reference, referenceIndex) => {
      if (!reference || typeof reference !== "object") {
        throw new TypeError(
          `plateManifest.sources[${arrayIndex}].directReferences[${referenceIndex}] must be an object.`,
        );
      }
      const label = `plateManifest.sources[${arrayIndex}].directReferences[${referenceIndex}]`;
      const sourcePath = existingFile(reference.source, `${label}.source`);
      return verifiedManifestFile(sourcePath, reference.sha256, label, {
        role: "plate_direct_reference",
        plateSourceIndices: [sourceIndex],
        ...(nonEmptyString(reference.filename) ? { provenanceFilename: reference.filename.trim() } : {}),
      });
    });
  });
  const provenanceHashes = new Set([...plateSources, ...directReferences].map(({ sha256: digest }) => digest));
  const supplementalReferences = manualRecords.filter(({ sha256: digest }) => !provenanceHashes.has(digest));

  return {
    candidates: [
      plateSketch,
      ...plateSources,
      ...(job.contextPolicy.mode === "exact" || job.contextPolicy.mode === "hybrid" ? directReferences : []),
      ...sceneContext.candidates,
      ...supplementalReferences.map((record, index) => ({
        ...record,
        role: "supplemental_reference",
        requestedIndex: index + 1,
      })),
    ],
    provenance: {
      mode: "plate-manifest-direct",
      ancestryDepth: 1,
      composeManifest: {
        filename: basename(job.plateManifest),
        mime: "application/json",
        bytes: manifestBytes.byteLength,
        sha256: sha256(manifestBytes),
        source: job.plateManifest,
        schema: manifest.schema,
      },
      plateSourceCount: plateSources.length,
      directReferenceCount: deduplicateBySha256(directReferences).length,
    },
    conditioning: {
      ...sceneContext.conditioning,
      availablePlateDirectReferenceCount: deduplicateBySha256(directReferences).length,
      attachedPlateDirectReferenceCount:
        job.contextPolicy.mode === "exact" || job.contextPolicy.mode === "hybrid"
          ? deduplicateBySha256(directReferences).length
          : 0,
    },
  };
}

function normalizeContextPolicy(raw) {
  const policy = raw && typeof raw === "object" ? raw : {};
  const mode = nonEmptyString(policy.mode) || "exact";
  if (mode !== "exact" && mode !== "related" && mode !== "hybrid") {
    throw new RangeError("contextPolicy.mode must be exact, related, or hybrid.");
  }
  const sceneContextReceipt = policy.sceneContextReceipt
    ? existingFile(policy.sceneContextReceipt, "contextPolicy.sceneContextReceipt")
    : null;
  const stateIndex = policy.stateIndex ?? 0;
  if (!Number.isInteger(stateIndex) || stateIndex < 0) {
    throw new RangeError("contextPolicy.stateIndex must be a non-negative integer.");
  }
  const additionalReferences = Array.isArray(policy.additionalReferences)
    ? policy.additionalReferences.map((reference, index) => {
        const candidate = typeof reference === "string" ? { path: reference } : reference;
        if (!candidate || typeof candidate !== "object") {
          throw new TypeError(`contextPolicy.additionalReferences[${index}] must be a path or object.`);
        }
        const sceneIds = Array.isArray(candidate.sceneIds)
          ? candidate.sceneIds.map((sceneId, sceneIndex) =>
              requiredString(sceneId, `contextPolicy.additionalReferences[${index}].sceneIds[${sceneIndex}]`),
            )
          : [];
        return {
          path: existingFile(candidate.path, `contextPolicy.additionalReferences[${index}].path`),
          sourceKind: nonEmptyString(candidate.sourceKind) || "local-curated",
          sceneIds,
        };
      })
    : [];
  if (mode === "exact" && (sceneContextReceipt || additionalReferences.length > 0)) {
    throw new TypeError("Use related or hybrid when supplying scene-context references.");
  }
  if (mode !== "exact" && !sceneContextReceipt && additionalReferences.length === 0) {
    throw new RangeError("related and hybrid modes require a sceneContextReceipt or additionalReferences.");
  }
  return { mode, sceneContextReceipt, stateIndex, additionalReferences };
}

function compileSceneContext(policy) {
  if (policy.mode === "exact") {
    return {
      candidates: [],
      conditioning: { mode: "exact", sceneContextReferenceCount: 0 },
    };
  }
  const candidates = policy.additionalReferences.map((reference) =>
    fileRecord(reference.path, {
      role: "scene_context_reference",
      sceneIds: reference.sceneIds,
      sourceKind: reference.sourceKind,
    }),
  );
  let receiptRecord = null;
  let stateRecord = null;
  if (policy.sceneContextReceipt) {
    const bytes = readFileSync(policy.sceneContextReceipt);
    let receipt;
    try {
      receipt = JSON.parse(bytes.toString("utf8"));
    } catch {
      throw new TypeError(`sceneContextReceipt is not valid JSON: ${policy.sceneContextReceipt}`);
    }
    if (receipt?.schemaVersion !== "inside-valdivia.scene-context-selection@1") {
      throw new TypeError("sceneContextReceipt must use schema inside-valdivia.scene-context-selection@1.");
    }
    const state = receipt.states?.[policy.stateIndex];
    if (!state || state.index !== policy.stateIndex || !Array.isArray(state.references)) {
      throw new RangeError(`sceneContextReceipt has no state ${policy.stateIndex}.`);
    }
    for (const [index, reference] of state.references.entries()) {
      const label = `sceneContextReceipt.states[${policy.stateIndex}].references[${index}]`;
      const path = existingFile(reference?.path, `${label}.path`);
      candidates.push(
        verifiedManifestFile(path, reference.sha256, label, {
          role: "scene_context_reference",
          sourceKind: "atlas-scene-corpus",
          sceneIds: nonEmptyString(reference.assignedSceneId) ? [reference.assignedSceneId.trim()] : [],
          sceneContextState: policy.stateIndex,
          retainedFromPreviousState: reference.retainedFromPreviousState === true,
          ...(nonEmptyString(reference.assetId) ? { atlasAssetId: reference.assetId.trim() } : {}),
        }),
      );
    }
    receiptRecord = {
      filename: basename(policy.sceneContextReceipt),
      mime: "application/json",
      bytes: bytes.byteLength,
      sha256: sha256(bytes),
      source: policy.sceneContextReceipt,
      schema: receipt.schemaVersion,
    };
    stateRecord = {
      index: state.index,
      progress: state.progress,
      interpolationProgress: state.interpolationProgress,
      sceneMix: state.sceneMix,
      selectionSeed: state.seed,
    };
  }
  const deduplicated = deduplicateBySha256(candidates);
  return {
    candidates: deduplicated,
    conditioning: {
      mode: policy.mode,
      sceneContextReferenceCount: deduplicated.length,
      ...(receiptRecord ? { sceneContextReceipt: receiptRecord, sceneContextState: stateRecord } : {}),
    },
  };
}

function parseComposeManifest(bytes, path) {
  let manifest;
  try {
    manifest = JSON.parse(bytes.toString("utf8"));
  } catch {
    throw new TypeError(`plateManifest is not valid JSON: ${path}`);
  }
  if (
    !manifest ||
    (manifest.schema !== "zenith.fulldome-compose.v1" && manifest.schema !== "zenith.fulldome-compose.v2")
  ) {
    throw new TypeError("plateManifest must use schema zenith.fulldome-compose.v1 or v2.");
  }
  if (!manifest.output || typeof manifest.output !== "object" || !sha256String(manifest.output.sha256)) {
    throw new TypeError("plateManifest.output.sha256 must be a SHA-256 digest.");
  }
  if (!Array.isArray(manifest.sources) || manifest.sources.length === 0) {
    throw new RangeError("plateManifest.sources must contain at least one source.");
  }
  return manifest;
}

function locateManifestSource(source, manualRecords, label) {
  if (!source || typeof source !== "object") throw new TypeError(`${label} must be an object.`);
  if (!sha256String(source.sha256)) throw new TypeError(`${label}.sha256 must be a SHA-256 digest.`);
  if (nonEmptyString(source.source)) return existingFile(source.source, `${label}.source`);
  const matching = manualRecords.find((record) => record.sha256 === source.sha256);
  if (matching) return matching.source;
  throw new Error(
    `${label} has no local source locator. Re-compose with the current manifest format or include that plate image in references.`,
  );
}

function verifiedManifestFile(path, expectedSha256, label, extra) {
  if (!sha256String(expectedSha256)) throw new TypeError(`${label}.sha256 must be a SHA-256 digest.`);
  const record = fileRecord(path, extra);
  if (record.sha256 !== expectedSha256) {
    throw new Error(`${label} changed after composition: ${path}`);
  }
  return record;
}

function verifiedReceiptRecord(receipt, sourceIndex) {
  if (!receipt || typeof receipt !== "object") {
    throw new TypeError(`plateManifest.sources[${sourceIndex}].generationReceipt must be an object.`);
  }
  const label = `plateManifest.sources[${sourceIndex}].generationReceipt`;
  const path = existingFile(receipt.source, `${label}.source`);
  const bytes = readFileSync(path);
  const digest = sha256(bytes);
  if (sha256String(receipt.sha256) && digest !== receipt.sha256) {
    throw new Error(`${label} changed after composition: ${path}`);
  }
  return { filename: basename(path), sha256: digest, source: path };
}

function promptText(raw) {
  const inline = nonEmptyString(raw.prompt);
  const promptFile = nonEmptyString(raw.promptFile);
  if (inline && promptFile) throw new TypeError("Use prompt or promptFile, not both.");
  if (inline) return inline;
  if (promptFile) return readFileSync(existingFile(promptFile, "promptFile"), "utf8").trim();
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
    ...pngDimensions(bytes),
  };
}

function deduplicateBySha256(records) {
  const byDigest = new Map();
  for (const record of records) {
    const previous = byDigest.get(record.sha256);
    if (!previous) {
      byDigest.set(record.sha256, record);
      continue;
    }
    const indices = [...(previous.plateSourceIndices ?? []), ...(record.plateSourceIndices ?? [])];
    if (indices.length > 0) previous.plateSourceIndices = [...new Set(indices)].sort((a, b) => a - b);
    const sceneIds = [...(previous.sceneIds ?? []), ...(record.sceneIds ?? [])];
    if (sceneIds.length > 0) previous.sceneIds = [...new Set(sceneIds)];
    const roles = [...(previous.roles ?? [previous.role]), ...(record.roles ?? [record.role])].filter(Boolean);
    if (roles.length > 1) previous.roles = [...new Set(roles)];
  }
  return [...byDigest.values()];
}

function pngDimensions(bytes) {
  const signature = "89504e470d0a1a0a";
  if (bytes.length < 24 || bytes.subarray(0, 8).toString("hex") !== signature) return {};
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}

function chatGptConversationUrl(value) {
  const candidate = requiredString(value, "conversationUrl");
  let url;
  try {
    url = new URL(candidate);
  } catch {
    throw new TypeError("conversationUrl must be a valid ChatGPT conversation URL.");
  }
  if (url.hostname !== "chatgpt.com" || !url.pathname.startsWith("/c/")) {
    throw new TypeError("conversationUrl must point to a chatgpt.com/c/... conversation.");
  }
  return url.toString();
}

function existingFile(value, label) {
  const path = requiredPath(value, label);
  if (!existsSync(path)) throw new Error(`${label} does not exist: ${path}`);
  return path;
}

function requiredPath(value, label) {
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

function integerOr(value, fallback) {
  return Number.isInteger(value) ? value : fallback;
}

function sha256String(value) {
  return typeof value === "string" && /^[a-f0-9]{64}$/u.test(value);
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
  if (extension === ".gif") return "image/gif";
  if (extension === ".json") return "application/json";
  return "image/jpeg";
}
