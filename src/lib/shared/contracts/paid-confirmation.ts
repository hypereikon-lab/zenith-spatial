export type PaidConfirmationDigestInput = {
  version: number;
  operatorId: string;
  input: Record<string, unknown>;
};

export function canonicalPaidConfirmationPayload({ version, operatorId, input }: PaidConfirmationDigestInput): string {
  return canonicalJson({ version, operatorId, input });
}

export async function paidConfirmationInputDigest(input: PaidConfirmationDigestInput): Promise<string> {
  const bytes = new TextEncoder().encode(canonicalPaidConfirmationPayload(input));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function canonicalJson(value: unknown): string {
  if (value === null) return "null";
  if (typeof value === "string" || typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("Paid confirmation input must contain finite JSON numbers.");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (isRecord(value)) {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
      .join(",")}}`;
  }
  throw new Error("Paid confirmation input must be JSON-serializable.");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}
