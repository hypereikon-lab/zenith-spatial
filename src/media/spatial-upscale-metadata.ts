import * as Schema from "effect/Schema";

import {
  AudienceInSpaceSchema,
  ImageSpatialSpecSchema,
  SpatialUpscaleProvenanceSchema,
  type ImageSpatialSpec,
  type SpatialUpscaleProvenance,
} from "../domain/schema.js";
import type { SpatialTileDescriptor } from "../geometry/spatial-upscale.js";
import { embedZenithPngText, readZenithPngText } from "./png-zenith-provenance.js";

export const ZENITH_SPATIAL_TILE_ATLAS_KEYWORD = "zenith.spatial-tiles.v1";
export const ZENITH_SPATIAL_TILE_KEYWORD = "zenith.spatial-tile.v1";
export const ZENITH_SPATIAL_UPSCALE_KEYWORD = "zenith.spatial-upscale.v1";

const finite = Schema.Number.pipe(Schema.finite());
const positiveInteger = Schema.Number.pipe(Schema.int(), Schema.positive());
const nonEmpty = Schema.String.pipe(Schema.minLength(1));
const vec3 = Schema.mutable(Schema.Tuple(finite, finite, finite));
const quaternion = Schema.mutable(Schema.Tuple(finite, finite, finite, finite));
const SpatialTileVerticalWarpSchema = Schema.mutable(
  Schema.Struct({
    kind: Schema.Literal("angular-rim"),
    boundaryElevationDegrees: finite.pipe(Schema.between(-90, 90)),
    validSide: Schema.Literal("above", "below"),
  }),
);

const SpatialTileDescriptorSchema = Schema.mutable(
  Schema.Struct({
    id: Schema.Literal("front", "right", "back", "left", "up", "down"),
    label: nonEmpty,
    orientation: quaternion,
    verticalWarp: Schema.optional(SpatialTileVerticalWarpSchema),
  }),
);

export const SpatialTileAtlasManifestSchema = Schema.mutable(
  Schema.Struct({
    format: Schema.Literal("zenith-spatial-tile-atlas"),
    version: Schema.Literal(1),
    projectId: nonEmpty,
    compositionId: nonEmpty,
    sourceTargetKind: Schema.Literal("take", "commit"),
    sourceTargetId: nonEmpty,
    sourceMediaAssetId: nonEmpty,
    sourceLabel: nonEmpty,
    capturedAt: nonEmpty,
    spatialSpec: ImageSpatialSpecSchema,
    audience: AudienceInSpaceSchema,
    cameraPosition: vec3,
    tileFovDegrees: finite.pipe(Schema.between(90, 130)),
    tileSize: positiveInteger,
    padding: Schema.Number.pipe(Schema.int(), Schema.nonNegative()),
    columns: Schema.Literal(3),
    rows: Schema.Literal(2),
    tiles: Schema.mutable(Schema.Array(SpatialTileDescriptorSchema).pipe(Schema.minItems(6), Schema.maxItems(6))),
  }),
).pipe(
  Schema.filter((manifest) => {
    const ids = new Set(manifest.tiles.map((tile) => tile.id));
    return ids.size === 6
      ? true
      : { path: ["tiles"], message: "tile atlas must contain each cubemap face exactly once" };
  }),
);

export type SpatialTileAtlasManifest = Omit<
  Schema.Schema.Type<typeof SpatialTileAtlasManifestSchema>,
  "tiles" | "spatialSpec"
> & {
  readonly tiles: SpatialTileDescriptor[];
  readonly spatialSpec: ImageSpatialSpec;
};

export const SpatialTilePngMetadataSchema = Schema.mutable(
  Schema.Struct({
    format: Schema.Literal("zenith-spatial-tile"),
    version: Schema.Literal(1),
    tileId: Schema.Literal("front", "right", "back", "left", "up", "down"),
    manifest: SpatialTileAtlasManifestSchema,
  }),
);

export type SpatialTilePngMetadata = {
  readonly format: "zenith-spatial-tile";
  readonly version: 1;
  readonly tileId: SpatialTileDescriptor["id"];
  readonly manifest: SpatialTileAtlasManifest;
};

export const SpatialUpscalePngMetadataSchema = Schema.mutable(
  Schema.Struct({
    format: Schema.Literal("zenith-spatial-upscale"),
    version: Schema.Literal(1),
    spatialSpec: ImageSpatialSpecSchema,
    provenance: SpatialUpscaleProvenanceSchema,
  }),
);

export type SpatialUpscalePngMetadata = {
  readonly format: "zenith-spatial-upscale";
  readonly version: 1;
  readonly spatialSpec: ImageSpatialSpec;
  readonly provenance: SpatialUpscaleProvenance;
};

export async function embedSpatialTileAtlasManifest(png: Blob, manifest: SpatialTileAtlasManifest): Promise<Blob> {
  const parsed = Schema.decodeUnknownSync(SpatialTileAtlasManifestSchema)(manifest, {
    onExcessProperty: "error",
  });
  return embedMetadata(png, ZENITH_SPATIAL_TILE_ATLAS_KEYWORD, parsed);
}

export async function readSpatialTileAtlasManifest(png: Blob): Promise<SpatialTileAtlasManifest | null> {
  return readMetadata(
    png,
    ZENITH_SPATIAL_TILE_ATLAS_KEYWORD,
    SpatialTileAtlasManifestSchema,
  ) as Promise<SpatialTileAtlasManifest | null>;
}

export async function embedSpatialTilePngMetadata(png: Blob, metadata: SpatialTilePngMetadata): Promise<Blob> {
  const parsed = Schema.decodeUnknownSync(SpatialTilePngMetadataSchema)(metadata, {
    onExcessProperty: "error",
  });
  return embedMetadata(png, ZENITH_SPATIAL_TILE_KEYWORD, parsed);
}

export async function readSpatialTilePngMetadata(png: Blob): Promise<SpatialTilePngMetadata | null> {
  return readMetadata(
    png,
    ZENITH_SPATIAL_TILE_KEYWORD,
    SpatialTilePngMetadataSchema,
  ) as Promise<SpatialTilePngMetadata | null>;
}

export function parseSpatialTileAtlasManifest(value: unknown): SpatialTileAtlasManifest {
  return Schema.decodeUnknownSync(SpatialTileAtlasManifestSchema)(value, { onExcessProperty: "error" });
}

export async function embedSpatialUpscalePngMetadata(png: Blob, metadata: SpatialUpscalePngMetadata): Promise<Blob> {
  const parsed = Schema.decodeUnknownSync(SpatialUpscalePngMetadataSchema)(metadata, {
    onExcessProperty: "error",
  });
  return embedMetadata(png, ZENITH_SPATIAL_UPSCALE_KEYWORD, parsed);
}

export async function readSpatialUpscalePngMetadata(png: Blob): Promise<SpatialUpscalePngMetadata | null> {
  return readMetadata(
    png,
    ZENITH_SPATIAL_UPSCALE_KEYWORD,
    SpatialUpscalePngMetadataSchema,
  ) as Promise<SpatialUpscalePngMetadata | null>;
}

async function embedMetadata(png: Blob, keyword: string, value: unknown): Promise<Blob> {
  const bytes = new Uint8Array(await png.arrayBuffer());
  const output = embedZenithPngText(bytes, keyword, JSON.stringify(value));
  return new Blob([exactBuffer(output)], { type: "image/png" });
}

async function readMetadata<S extends Schema.Schema.AnyNoContext>(
  png: Blob,
  keyword: string,
  schema: S,
): Promise<Schema.Schema.Type<S> | null> {
  const bytes = new Uint8Array(await png.arrayBuffer());
  if (!hasPngSignature(bytes)) return null;
  const text = readZenithPngText(bytes, keyword);
  if (text === null) return null;
  return Schema.decodeUnknownSync(schema)(JSON.parse(text) as unknown, { onExcessProperty: "error" });
}

function hasPngSignature(bytes: Uint8Array): boolean {
  const signature = [137, 80, 78, 71, 13, 10, 26, 10];
  return signature.every((value, index) => bytes[index] === value);
}

function exactBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}
