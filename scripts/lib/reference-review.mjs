import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { basename, resolve } from "node:path";

export const REFERENCE_REVIEW_SCHEMA = "zenith.reference-review.v1";

export function createReferenceReview(
  rawEntries,
  {
    createdAt = new Date().toISOString(),
    policyId = "inside-valdivia.natural-world-only.v1",
    reviewer = "codex-pixel-vision",
  } = {},
) {
  if (!Array.isArray(rawEntries) || rawEntries.length === 0) {
    throw new RangeError("A reference review needs at least one image entry.");
  }
  const entries = rawEntries.map((entry, index) => {
    if (!entry || typeof entry !== "object") throw new TypeError(`entries[${index}] must be an object.`);
    const path = existingFile(entry.path, `entries[${index}].path`);
    const decision = entry.decision;
    if (decision !== "approved" && decision !== "rejected") {
      throw new RangeError(`entries[${index}].decision must be approved or rejected.`);
    }
    const reasons = Array.isArray(entry.reasons)
      ? entry.reasons.map((reason, reasonIndex) => requiredString(reason, `entries[${index}].reasons[${reasonIndex}]`))
      : [];
    if (decision === "rejected" && reasons.length === 0) {
      throw new RangeError(`entries[${index}] needs a reason when rejected.`);
    }
    const bytes = readFileSync(path);
    return {
      index,
      filename: basename(path),
      source: path,
      bytes: bytes.byteLength,
      sha256: sha256(bytes),
      decision,
      reasons,
    };
  });
  const receipt = {
    schema: REFERENCE_REVIEW_SCHEMA,
    createdAt,
    policy: {
      id: policyId,
      method: "pixel-vision",
      rejectOnUncertainty: true,
      excludedContent: [
        "people or human figures",
        "boats or other watercraft",
        "cars or other vehicles",
        "roads or vehicle tracks",
        "constructed paths, boardwalks, stairs, bridges or handrails",
        "buildings, utility infrastructure or signage",
        "prominent text, logos or watermarks",
      ],
    },
    reviewer,
    entries,
  };
  return { ...receipt, reviewDigest: sha256(canonicalJson(receipt)) };
}

export function verifyApprovedReferences(records, receiptPath, { label = "references" } = {}) {
  const path = existingFile(receiptPath, "referenceReviewReceipt");
  const bytes = readFileSync(path);
  const receipt = JSON.parse(bytes.toString("utf8"));
  if (receipt?.schema !== REFERENCE_REVIEW_SCHEMA) {
    throw new TypeError(`Expected ${REFERENCE_REVIEW_SCHEMA}.`);
  }
  const expectedDigest = sha256(canonicalJson(stripReviewDigest(receipt)));
  if (receipt.reviewDigest !== expectedDigest) throw new Error("Reference review digest does not match its contents.");
  const decisions = new Map();
  for (const [index, entry] of (receipt.entries || []).entries()) {
    if (!entry || typeof entry !== "object") throw new TypeError(`review entries[${index}] must be an object.`);
    const digest = requiredString(entry.sha256, `review entries[${index}].sha256`);
    if (decisions.has(digest)) throw new Error(`Reference review repeats sha256 ${digest}.`);
    decisions.set(digest, entry);
  }
  for (const [index, record] of records.entries()) {
    const decision = decisions.get(record.sha256);
    if (!decision) throw new Error(`${label}[${index}] has no pixel-vision review: ${record.filename}.`);
    if (decision.decision !== "approved") {
      throw new Error(`${label}[${index}] was rejected by the natural-world reference policy: ${record.filename}.`);
    }
  }
  return {
    filename: basename(path),
    source: path,
    bytes: bytes.byteLength,
    sha256: sha256(bytes),
    reviewDigest: receipt.reviewDigest,
    policy: receipt.policy,
    reviewer: receipt.reviewer,
    reviewedImageCount: records.length,
  };
}

function stripReviewDigest(receipt) {
  const { reviewDigest: _reviewDigest, ...rest } = receipt;
  return rest;
}

function existingFile(value, label) {
  const path = resolve(requiredString(value, label));
  if (!existsSync(path)) throw new Error(`${label} does not exist: ${path}`);
  return path;
}

function requiredString(value, label) {
  if (typeof value !== "string" || !value.trim()) throw new TypeError(`${label} must be a non-empty string.`);
  return value.trim();
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
