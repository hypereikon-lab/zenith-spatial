import type { ArtifactConfigValue } from "./artifact-types.js";

export const ARTIFACT_CONFIG_HASH_VERSION = 1;

type ConfigRecord = Record<string, ArtifactConfigValue>;

export function artifactConfigHash(config: ConfigRecord, prefix = "config"): string {
  return `${prefix}-${fnv1a(stableJson(config))}`;
}

function stableJson(value: ArtifactConfigValue): string {
  return JSON.stringify(stableValue(value));
}

function stableValue(value: ArtifactConfigValue): ArtifactConfigValue {
  if (Array.isArray(value)) {
    return value.map(stableValue);
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, item]) => item !== undefined)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, stableValue(item)]),
    );
  }
  return value;
}

function fnv1a(input: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}
