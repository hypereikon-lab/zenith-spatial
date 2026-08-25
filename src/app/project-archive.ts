const PROJECT_ARCHIVE_MAGIC = "ZENITH01";
const PROJECT_ARCHIVE_HEADER_BYTES = 12;
const PROJECT_ARCHIVE_FORMAT = "zenith-project";
const PROJECT_ARCHIVE_VERSION = 1;
const PROJECT_MEDIA_URL_PREFIX = "zenith-media://";
const MAX_PROJECT_ARCHIVE_MANIFEST_BYTES = 64 * 1024 * 1024;

export type ProjectArchiveAttachment = {
  id: string;
  mime: string;
  blob: Blob;
};

export type ProjectArchiveContents = {
  snapshot: unknown;
  media: ReadonlyMap<string, Blob>;
};

type ProjectArchiveMediaEntry = {
  id: string;
  mime: string;
  offset: number;
  length: number;
};

type ProjectArchiveManifest = {
  format: typeof PROJECT_ARCHIVE_FORMAT;
  version: typeof PROJECT_ARCHIVE_VERSION;
  snapshot: unknown;
  media: ProjectArchiveMediaEntry[];
};

type ExternalMedia = {
  id: string;
  mime: string;
  length: number;
  bytes?: Uint8Array;
  blob?: Blob;
};

export async function createProjectArchive(
  snapshot: unknown,
  { attachments = [] }: { attachments?: ProjectArchiveAttachment[] } = {},
): Promise<Blob> {
  assertUniqueAttachments(attachments);
  const media = new Map<string, ExternalMedia>(
    attachments.map((attachment) => [
      attachment.id,
      {
        id: attachment.id,
        mime: attachment.mime || attachment.blob.type || "application/octet-stream",
        length: attachment.blob.size,
        blob: attachment.blob,
      },
    ]),
  );
  const portableSnapshot = await externalizeDataUrls(structuredClone(snapshot), media);
  assertMediaReferences(portableSnapshot, media);
  let offset = 0;
  const entries = [...media.values()].map((item): ProjectArchiveMediaEntry => {
    const entry = { id: item.id, mime: item.mime, offset, length: item.length };
    offset += item.length;
    return entry;
  });
  const manifest: ProjectArchiveManifest = {
    format: PROJECT_ARCHIVE_FORMAT,
    version: PROJECT_ARCHIVE_VERSION,
    snapshot: portableSnapshot,
    media: entries,
  };
  const manifestBytes = new TextEncoder().encode(JSON.stringify(manifest));
  const header = new Uint8Array(PROJECT_ARCHIVE_HEADER_BYTES);
  header.set(new TextEncoder().encode(PROJECT_ARCHIVE_MAGIC), 0);
  new DataView(header.buffer).setUint32(PROJECT_ARCHIVE_MAGIC.length, manifestBytes.byteLength, true);
  const binaryParts = [...media.values()].map((item) =>
    item.blob ? item.blob : exactArrayBuffer(item.bytes || new Uint8Array()),
  );
  return new Blob([exactArrayBuffer(header), exactArrayBuffer(manifestBytes), ...binaryParts], {
    type: "application/vnd.zenith.project",
  });
}

export function createProjectArchiveMediaStore() {
  const byBlob = new WeakMap<Blob, string>();
  const attachments = new Map<string, ProjectArchiveAttachment>();
  return {
    add(blob: Blob, mime = blob.type || "application/octet-stream"): string {
      const existing = byBlob.get(blob);
      if (existing) return `${PROJECT_MEDIA_URL_PREFIX}${existing}`;
      const id = `runtime-${globalThis.crypto?.randomUUID?.() || `${Date.now().toString(36)}-${attachments.size + 1}`}`;
      byBlob.set(blob, id);
      attachments.set(id, { id, mime, blob });
      return `${PROJECT_MEDIA_URL_PREFIX}${id}`;
    },
    attachments(): ProjectArchiveAttachment[] {
      return [...attachments.values()];
    },
  };
}

export async function readProjectArchive(buffer: ArrayBuffer): Promise<unknown | null> {
  const bytes = new Uint8Array(buffer);
  if (!isProjectArchiveBytes(bytes)) return null;
  const manifestLength = readManifestLength(bytes);
  const manifestStart = PROJECT_ARCHIVE_HEADER_BYTES;
  const mediaStart = manifestStart + manifestLength;
  if (mediaStart > bytes.byteLength) throw new Error("Zenith project archive manifest is truncated.");
  const manifest = parseManifest(new TextDecoder().decode(bytes.subarray(manifestStart, mediaStart)));
  validateMediaLayout(manifest.media, bytes.byteLength - mediaStart);
  const dataUrls = new Map<string, string>();
  for (const entry of manifest.media) {
    const start = mediaStart + entry.offset;
    const end = start + entry.length;
    if (start < mediaStart || end > bytes.byteLength) {
      throw new Error(`Zenith project archive media ${entry.id} is truncated.`);
    }
    dataUrls.set(entry.id, bytesToDataUrl(bytes.subarray(start, end), entry.mime));
  }
  return hydrateMediaUrls(manifest.snapshot, dataUrls);
}

export async function readProjectArchiveBlob(blob: Blob): Promise<ProjectArchiveContents | null> {
  const header = new Uint8Array(await blob.slice(0, PROJECT_ARCHIVE_HEADER_BYTES).arrayBuffer());
  if (!isProjectArchiveBytes(header)) return null;
  const manifestLength = readManifestLength(header);
  const mediaStart = PROJECT_ARCHIVE_HEADER_BYTES + manifestLength;
  if (mediaStart > blob.size) throw new Error("Zenith project archive manifest is truncated.");
  const manifestText = await blob.slice(PROJECT_ARCHIVE_HEADER_BYTES, mediaStart).text();
  const manifest = parseManifest(manifestText);
  validateMediaLayout(manifest.media, blob.size - mediaStart);
  const media = new Map<string, Blob>();
  for (const entry of manifest.media) {
    media.set(entry.id, blob.slice(mediaStart + entry.offset, mediaStart + entry.offset + entry.length, entry.mime));
  }
  return { snapshot: manifest.snapshot, media };
}

export function projectArchiveMediaId(url: string | undefined): string | null {
  return url?.startsWith(PROJECT_MEDIA_URL_PREFIX) ? url.slice(PROJECT_MEDIA_URL_PREFIX.length) || null : null;
}

export function isProjectArchiveBytes(bytes: Uint8Array): boolean {
  if (bytes.byteLength < PROJECT_ARCHIVE_MAGIC.length) return false;
  return new TextDecoder().decode(bytes.subarray(0, PROJECT_ARCHIVE_MAGIC.length)) === PROJECT_ARCHIVE_MAGIC;
}

async function externalizeDataUrls(value: unknown, media: Map<string, ExternalMedia>): Promise<unknown> {
  if (typeof value === "string") {
    if (!value.startsWith("data:")) return value;
    const decoded = dataUrlBytes(value);
    const id = await mediaDigest(decoded.bytes, decoded.mime);
    if (!media.has(id)) media.set(id, { id, ...decoded, length: decoded.bytes.byteLength });
    return `${PROJECT_MEDIA_URL_PREFIX}${id}`;
  }
  if (Array.isArray(value)) return Promise.all(value.map((item) => externalizeDataUrls(item, media)));
  if (!isRecord(value)) return value;
  const output: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) output[key] = await externalizeDataUrls(item, media);
  return output;
}

function hydrateMediaUrls(value: unknown, media: Map<string, string>): unknown {
  if (typeof value === "string" && value.startsWith(PROJECT_MEDIA_URL_PREFIX)) {
    const id = value.slice(PROJECT_MEDIA_URL_PREFIX.length);
    const dataUrl = media.get(id);
    if (!dataUrl) throw new Error(`Zenith project archive is missing media ${id}.`);
    return dataUrl;
  }
  if (Array.isArray(value)) return value.map((item) => hydrateMediaUrls(item, media));
  if (!isRecord(value)) return value;
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, hydrateMediaUrls(item, media)]));
}

function dataUrlBytes(value: string): { mime: string; bytes: Uint8Array } {
  const comma = value.indexOf(",");
  if (comma < 0) throw new Error("Project media contains an invalid data URL.");
  const metadata = value.slice(5, comma);
  const mime = metadata.split(";")[0] || "application/octet-stream";
  const payload = value.slice(comma + 1);
  if (metadata.split(";").includes("base64")) return { mime, bytes: base64ToBytes(payload) };
  return { mime, bytes: new TextEncoder().encode(decodeURIComponent(payload)) };
}

async function mediaDigest(bytes: Uint8Array, mime: string): Promise<string> {
  if (!globalThis.crypto?.subtle) throw new Error("Web Crypto is required to save a Zenith project archive.");
  const mimeBytes = new TextEncoder().encode(`${mime}\0`);
  const input = new Uint8Array(mimeBytes.byteLength + bytes.byteLength);
  input.set(mimeBytes);
  input.set(bytes, mimeBytes.byteLength);
  const digest = await globalThis.crypto.subtle.digest("SHA-256", input);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function parseManifest(text: string): ProjectArchiveManifest {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new Error("Zenith project archive manifest contains invalid JSON.");
  }
  if (!isRecord(value) || value.format !== PROJECT_ARCHIVE_FORMAT || value.version !== PROJECT_ARCHIVE_VERSION) {
    throw new Error("Zenith project archive manifest is unsupported.");
  }
  if (!Array.isArray(value.media) || !("snapshot" in value)) {
    throw new Error("Zenith project archive manifest is invalid.");
  }
  const seen = new Set<string>();
  const media = value.media.map((candidate): ProjectArchiveMediaEntry => {
    if (
      !isRecord(candidate) ||
      typeof candidate.id !== "string" ||
      candidate.id.length === 0 ||
      typeof candidate.mime !== "string" ||
      !isSafeNonNegativeInteger(candidate.offset) ||
      !isSafeNonNegativeInteger(candidate.length) ||
      seen.has(candidate.id)
    ) {
      throw new Error("Zenith project archive contains invalid media metadata.");
    }
    seen.add(candidate.id);
    return { id: candidate.id, mime: candidate.mime, offset: candidate.offset, length: candidate.length };
  });
  return {
    format: PROJECT_ARCHIVE_FORMAT,
    version: PROJECT_ARCHIVE_VERSION,
    snapshot: value.snapshot,
    media,
  };
}

function readManifestLength(bytes: Uint8Array): number {
  if (bytes.byteLength < PROJECT_ARCHIVE_HEADER_BYTES) throw new Error("Zenith project archive is truncated.");
  const length = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(
    PROJECT_ARCHIVE_MAGIC.length,
    true,
  );
  if (length > MAX_PROJECT_ARCHIVE_MANIFEST_BYTES) {
    throw new Error("Zenith project archive manifest exceeds the supported safety limit.");
  }
  return length;
}

function validateMediaLayout(entries: ProjectArchiveMediaEntry[], availableBytes: number): void {
  let previousEnd = 0;
  for (const entry of [...entries].sort((left, right) => left.offset - right.offset)) {
    const end = entry.offset + entry.length;
    if (!Number.isSafeInteger(end) || entry.offset < previousEnd || end > availableBytes) {
      throw new Error(`Zenith project archive media ${entry.id} has an invalid byte range.`);
    }
    previousEnd = end;
  }
}

function assertUniqueAttachments(attachments: ProjectArchiveAttachment[]): void {
  const ids = new Set<string>();
  for (const attachment of attachments) {
    if (!attachment.id || ids.has(attachment.id)) {
      throw new Error(`Zenith project archive attachment id ${attachment.id || "(empty)"} is invalid or duplicated.`);
    }
    ids.add(attachment.id);
  }
}

function assertMediaReferences(value: unknown, media: Map<string, ExternalMedia>): void {
  if (typeof value === "string") {
    const id = projectArchiveMediaId(value);
    if (id && !media.has(id)) throw new Error(`Zenith project archive is missing attachment ${id}.`);
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) assertMediaReferences(item, media);
    return;
  }
  if (!isRecord(value)) return;
  for (const item of Object.values(value)) assertMediaReferences(item, media);
}

function isSafeNonNegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function base64ToBytes(value: string): Uint8Array {
  const binary = globalThis.atob ? globalThis.atob(value) : Buffer.from(value, "base64").toString("binary");
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function bytesToDataUrl(bytes: Uint8Array, mime: string): string {
  let binary = "";
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.byteLength; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }
  const base64 = globalThis.btoa ? globalThis.btoa(binary) : Buffer.from(bytes).toString("base64");
  return `data:${mime || "application/octet-stream"};base64,${base64}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function exactArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.slice().buffer as ArrayBuffer;
}
