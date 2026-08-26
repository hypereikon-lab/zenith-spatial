import * as Schema from "effect/Schema";

import {
  ImageGenerationProvenanceSchema,
  ImageSpatialSpecSchema,
  PlateCommitProvenanceSchema,
  PlateDraftSchema,
  type ImageGenerationProvenance,
} from "../domain/schema.js";

export const ZENITH_PNG_PROVENANCE_KEYWORD = "zenith.spatial.v1";
export const ZENITH_PNG_PLATE_KEYWORD = "zenith.plate.v1";

export const ZenithPlatePngMetadataSchema = Schema.mutable(
  Schema.Struct({
    version: Schema.Literal(1),
    kind: Schema.Literal("plate-draft", "plate-commit"),
    projectId: Schema.String.pipe(Schema.minLength(1)),
    compositionId: Schema.String.pipe(Schema.minLength(1)),
    plateCommitId: Schema.NullOr(Schema.String.pipe(Schema.minLength(1))),
    createdAt: Schema.String.pipe(Schema.minLength(1)),
    draft: PlateDraftSchema,
    spatialSpec: ImageSpatialSpecSchema,
    provenance: Schema.NullOr(PlateCommitProvenanceSchema),
  }),
).pipe(
  Schema.filter((metadata) => {
    const issues: Schema.FilterIssue[] = [];
    if ((metadata.kind === "plate-commit") !== (metadata.plateCommitId !== null)) {
      issues.push({ path: ["plateCommitId"], message: "Plate Commit metadata must carry its commit id" });
    }
    if ((metadata.kind === "plate-commit") !== (metadata.provenance !== null)) {
      issues.push({ path: ["provenance"], message: "Only Plate Commit metadata carries commit provenance" });
    }
    if (
      metadata.draft.raster.width !== metadata.spatialSpec.targetWidth ||
      metadata.draft.raster.height !== metadata.spatialSpec.targetHeight
    ) {
      issues.push({ path: ["spatialSpec"], message: "Plate metadata spatial target must match its raster" });
    }
    return issues;
  }),
);

export type ZenithPlatePngMetadata = Schema.Schema.Type<typeof ZenithPlatePngMetadataSchema>;

const PNG_SIGNATURE = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder("utf-8", { fatal: true });

type PngChunk = {
  start: number;
  end: number;
  type: string;
  dataStart: number;
  dataEnd: number;
  crc: number;
};

export function embedZenithPngProvenance(bytes: Uint8Array, provenance: ImageGenerationProvenance): Uint8Array {
  const parsed = Schema.decodeUnknownSync(ImageGenerationProvenanceSchema)(provenance, {
    onExcessProperty: "error",
  });
  return embedInternationalText(bytes, ZENITH_PNG_PROVENANCE_KEYWORD, JSON.stringify(parsed));
}

export function embedZenithPlatePngMetadata(bytes: Uint8Array, metadata: ZenithPlatePngMetadata): Uint8Array {
  const parsed = Schema.decodeUnknownSync(ZenithPlatePngMetadataSchema)(metadata, {
    onExcessProperty: "error",
  });
  return embedInternationalText(bytes, ZENITH_PNG_PLATE_KEYWORD, JSON.stringify(parsed));
}

export async function embedZenithPlateMetadataInPngBlob(blob: Blob, metadata: ZenithPlatePngMetadata): Promise<Blob> {
  const bytes = embedZenithPlatePngMetadata(new Uint8Array(await blob.arrayBuffer()), metadata);
  const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  return new Blob([buffer], { type: "image/png" });
}

function embedInternationalText(bytes: Uint8Array, keyword: string, text: string): Uint8Array {
  const chunks = parsePngChunks(bytes);
  const metadataChunk = createChunk("iTXt", encodeInternationalText(keyword, text));
  const output: Uint8Array[] = [PNG_SIGNATURE];
  let inserted = false;

  for (const chunk of chunks) {
    if (chunk.type === "iTXt" && internationalTextKeyword(bytes.subarray(chunk.dataStart, chunk.dataEnd)) === keyword) {
      continue;
    }
    if (chunk.type === "IEND" && !inserted) {
      output.push(metadataChunk);
      inserted = true;
    }
    output.push(bytes.subarray(chunk.start, chunk.end));
  }

  if (!inserted) throw new Error("PNG is missing its IEND chunk.");
  return concatenateBytes(output);
}

export function readZenithPngProvenance(bytes: Uint8Array): ImageGenerationProvenance | null {
  const value = readInternationalText(bytes, ZENITH_PNG_PROVENANCE_KEYWORD);
  return value === null
    ? null
    : Schema.decodeUnknownSync(ImageGenerationProvenanceSchema)(JSON.parse(value) as unknown, {
        onExcessProperty: "error",
      });
}

export function readZenithPlatePngMetadata(bytes: Uint8Array): ZenithPlatePngMetadata | null {
  const value = readInternationalText(bytes, ZENITH_PNG_PLATE_KEYWORD);
  return value === null
    ? null
    : Schema.decodeUnknownSync(ZenithPlatePngMetadataSchema)(JSON.parse(value) as unknown, {
        onExcessProperty: "error",
      });
}

function readInternationalText(bytes: Uint8Array, keyword: string): string | null {
  for (const chunk of parsePngChunks(bytes)) {
    if (chunk.type !== "iTXt") continue;
    const data = bytes.subarray(chunk.dataStart, chunk.dataEnd);
    if (internationalTextKeyword(data) !== keyword) continue;
    const typeBytes = bytes.subarray(chunk.start + 4, chunk.start + 8);
    if (crc32(concatenateBytes([typeBytes, data])) !== chunk.crc) {
      throw new Error("Zenith PNG provenance has an invalid checksum.");
    }
    return decodeInternationalText(data);
  }
  return null;
}

export function readZenithProvenanceFromPngDataUrl(dataUrl: string): ImageGenerationProvenance | null {
  const { mime, bytes } = decodeBase64DataUrl(dataUrl);
  if (mime !== "image/png") return null;
  return readZenithPngProvenance(bytes);
}

export async function readZenithProvenanceFromPngBlob(blob: Blob): Promise<ImageGenerationProvenance | null> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  if (!hasPngSignature(bytes)) return null;
  return readZenithPngProvenance(bytes);
}

export async function readZenithPlateMetadataFromPngBlob(blob: Blob): Promise<ZenithPlatePngMetadata | null> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  if (!hasPngSignature(bytes)) return null;
  return readZenithPlatePngMetadata(bytes);
}

function parsePngChunks(bytes: Uint8Array): PngChunk[] {
  assertPngSignature(bytes);
  const chunks: PngChunk[] = [];
  let offset = PNG_SIGNATURE.length;
  while (offset < bytes.length) {
    if (offset + 12 > bytes.length) throw new Error("PNG contains a truncated chunk header.");
    const length = readUint32(bytes, offset);
    const end = offset + 12 + length;
    if (end > bytes.length) throw new Error("PNG contains a truncated chunk body.");
    const type = ascii(bytes.subarray(offset + 4, offset + 8));
    chunks.push({
      start: offset,
      end,
      type,
      dataStart: offset + 8,
      dataEnd: offset + 8 + length,
      crc: readUint32(bytes, offset + 8 + length),
    });
    offset = end;
    if (type === "IEND") {
      if (offset !== bytes.length) throw new Error("PNG contains bytes after IEND.");
      break;
    }
  }
  if (!chunks.some((chunk) => chunk.type === "IEND")) throw new Error("PNG is missing its IEND chunk.");
  return chunks;
}

function createChunk(type: string, data: Uint8Array): Uint8Array {
  if (type.length !== 4) throw new Error("PNG chunk types must contain four ASCII characters.");
  const typeBytes = textEncoder.encode(type);
  const chunk = new Uint8Array(data.length + 12);
  writeUint32(chunk, 0, data.length);
  chunk.set(typeBytes, 4);
  chunk.set(data, 8);
  writeUint32(chunk, 8 + data.length, crc32(concatenateBytes([typeBytes, data])));
  return chunk;
}

function encodeInternationalText(keyword: string, text: string): Uint8Array {
  return concatenateBytes([textEncoder.encode(keyword), new Uint8Array([0, 0, 0, 0, 0]), textEncoder.encode(text)]);
}

function decodeInternationalText(data: Uint8Array): string {
  const keywordEnd = data.indexOf(0);
  if (keywordEnd < 0 || keywordEnd + 4 >= data.length) throw new Error("Zenith PNG provenance is malformed.");
  const compressionFlag = data[keywordEnd + 1];
  const compressionMethod = data[keywordEnd + 2];
  if (compressionFlag !== 0 || compressionMethod !== 0) {
    throw new Error("Compressed Zenith PNG provenance is not supported.");
  }
  const languageEnd = data.indexOf(0, keywordEnd + 3);
  if (languageEnd < 0) throw new Error("Zenith PNG provenance language field is malformed.");
  const translatedKeywordEnd = data.indexOf(0, languageEnd + 1);
  if (translatedKeywordEnd < 0) throw new Error("Zenith PNG provenance keyword field is malformed.");
  return textDecoder.decode(data.subarray(translatedKeywordEnd + 1));
}

function internationalTextKeyword(data: Uint8Array): string | null {
  const end = data.indexOf(0);
  return end < 0 ? null : ascii(data.subarray(0, end));
}

function decodeBase64DataUrl(dataUrl: string): { mime: string; bytes: Uint8Array } {
  const match = /^data:([^;,]+);base64,([\s\S]+)$/i.exec(dataUrl);
  if (!match) throw new Error("Expected a base64 data URL.");
  const binary = atob(match[2]);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return { mime: match[1].toLowerCase(), bytes };
}

function assertPngSignature(bytes: Uint8Array): void {
  if (bytes.length < PNG_SIGNATURE.length) throw new Error("PNG signature is missing.");
  if (!hasPngSignature(bytes)) throw new Error("PNG signature is invalid.");
}

function hasPngSignature(bytes: Uint8Array): boolean {
  if (bytes.length < PNG_SIGNATURE.length) return false;
  for (let index = 0; index < PNG_SIGNATURE.length; index += 1) {
    if (bytes[index] !== PNG_SIGNATURE[index]) return false;
  }
  return true;
}

function ascii(bytes: Uint8Array): string {
  let value = "";
  for (const byte of bytes) value += String.fromCharCode(byte);
  return value;
}

function readUint32(bytes: Uint8Array, offset: number): number {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(offset, false);
}

function writeUint32(bytes: Uint8Array, offset: number, value: number): void {
  new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).setUint32(offset, value >>> 0, false);
}

function concatenateBytes(parts: readonly Uint8Array[]): Uint8Array {
  const output = new Uint8Array(parts.reduce((total, part) => total + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    output.set(part, offset);
    offset += part.length;
  }
  return output;
}

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}
