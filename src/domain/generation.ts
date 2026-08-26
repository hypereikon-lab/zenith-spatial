import type { GenerationInput } from "./schema.js";

/** Canonical bytes protected by both the paid confirmation grant and job creation. */
export function canonicalGenerationInput(input: GenerationInput): string {
  return canonicalJson({
    ...input,
    provenance: {
      ...input.provenance,
      inputDigest: "",
    },
  });
}

export async function browserGenerationInputDigest(input: GenerationInput): Promise<string> {
  if (!globalThis.crypto?.subtle) throw new Error("Web Crypto is required for paid-action confirmation.");
  const bytes = new TextEncoder().encode(canonicalGenerationInput(input));
  const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function canonicalJson(value: unknown): string {
  if (value === null) return "null";
  if (typeof value === "string" || typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("Generation input contains a non-finite number.");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`)
      .join(",")}}`;
  }
  throw new Error("Generation input must be JSON serializable.");
}
