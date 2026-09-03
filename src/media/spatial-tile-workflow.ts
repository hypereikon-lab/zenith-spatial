import type { AudienceInSpace, ImageSpatialSpec, SpatialUpscaleProvenance } from "../domain/schema.js";
import { audienceCameraForProjection } from "../geometry/audience-in-space.js";
import {
  createSpatialSurfacePointMapper,
  remapSpatialTileSampleToAtlas,
  spatialSurfacePointFromSourceUv,
  spatialTileBasis,
  spatialTileCameraPosition,
  spatialTilePlan,
  spatialTileRimBoundaryV,
  type SpatialTileBasis,
  type SpatialTileDescriptor,
  type SpatialTileSample,
} from "../geometry/spatial-upscale.js";
import { createSourceMapPreviewRenderer } from "../graphics/source-map-preview-renderer.js";
import { clamp, type Vec3 } from "../projection.js";
import { canvasToBlob } from "./canvas-utils.js";
import {
  embedSpatialTileAtlasManifest,
  embedSpatialTilePngMetadata,
  embedSpatialUpscalePngMetadata,
  parseSpatialTileAtlasManifest,
  readSpatialTileAtlasManifest,
  readSpatialTilePngMetadata,
  type SpatialTileAtlasManifest,
} from "./spatial-upscale-metadata.js";
import { createStoredZip } from "./stored-zip.js";

export type SpatialTileCaptureInput = {
  readonly mediaUrl: string;
  readonly projectId: string;
  readonly compositionId: string;
  readonly sourceTargetKind: "take" | "commit";
  readonly sourceTargetId: string;
  readonly sourceMediaAssetId: string;
  readonly sourceLabel: string;
  readonly spatialSpec: ImageSpatialSpec;
  readonly audience: AudienceInSpace;
  readonly tileSize: number;
  readonly tileFovDegrees?: number;
  readonly padding?: number;
  readonly capturedAt?: string;
};

export type SpatialTileCaptureResult = {
  readonly atlas: Blob;
  readonly atlasFilename: string;
  readonly bundle: Blob;
  readonly tiles: ReadonlyArray<{
    readonly id: SpatialTileDescriptor["id"];
    readonly image: Blob;
    readonly filename: string;
  }>;
  readonly manifest: SpatialTileAtlasManifest;
  readonly filename: string;
};

export type SpatialTileReconstructionResult = {
  readonly image: Blob;
  readonly manifest: SpatialTileAtlasManifest;
  readonly spatialSpec: ImageSpatialSpec;
  readonly provenance: SpatialUpscaleProvenance;
  readonly filename: string;
  readonly coverage: number;
  readonly scale: number;
};

export type SpatialTileProgress = {
  readonly progress: number;
  readonly status: string;
};

type IdentifiedSpatialTileFile = {
  readonly id: SpatialTileDescriptor["id"];
  readonly file: File;
};

type PyramidImage = {
  readonly width: number;
  readonly height: number;
  readonly data: Uint8ClampedArray;
};

type PreparedTile = {
  readonly basis: SpatialTileBasis;
  readonly descriptor: SpatialTileDescriptor;
  readonly pyramid: ReadonlyArray<PyramidImage>;
  readonly tangent: number;
  readonly cameraPosition: Vec3;
  readonly tileFovDegrees: number;
  gain: number;
};

const DEFAULT_TILE_FOV_DEGREES = 110;
const DEFAULT_PADDING = 20;
const PYRAMID_LEVELS = 5;
const MAX_OUTPUT_PIXELS = 36_000_000;
const MAX_OUTPUT_DIMENSION = 8192;
const SRGB_TO_LINEAR = Float32Array.from({ length: 256 }, (_, value) => {
  const encoded = value / 255;
  return encoded <= 0.04045 ? encoded / 12.92 : ((encoded + 0.055) / 1.055) ** 2.4;
});

/** Captures the exact unshaded carrier from six overlapping audience cameras into one portable PNG atlas. */
export async function captureSpatialTileAtlas(
  input: SpatialTileCaptureInput,
  emit: (progress: SpatialTileProgress) => void = () => {},
): Promise<SpatialTileCaptureResult> {
  if (!navigator.gpu) throw new Error("WebGPU is required to capture spatial tiles.");
  const tileSize = clamp(Math.round(input.tileSize), 256, 1536);
  const padding = clamp(Math.round(input.padding ?? DEFAULT_PADDING), 0, Math.floor(tileSize / 8));
  const tileFovDegrees = clamp(input.tileFovDegrees ?? DEFAULT_TILE_FOV_DEGREES, 90, 130);
  const tiles = spatialTilePlan(input.audience, {
    spatialSpec: input.spatialSpec,
    tileFovDegrees,
  });
  const camera = audienceCameraForProjection(
    input.audience,
    input.spatialSpec.projectionMode,
    input.spatialSpec.surface,
  );
  const cameraPosition = spatialTileCameraPosition(input.audience, input.spatialSpec);
  const capturedAt = input.capturedAt ?? new Date().toISOString();
  const manifest: SpatialTileAtlasManifest = {
    format: "zenith-spatial-tile-atlas",
    version: 1,
    projectId: input.projectId,
    compositionId: input.compositionId,
    sourceTargetKind: input.sourceTargetKind,
    sourceTargetId: input.sourceTargetId,
    sourceMediaAssetId: input.sourceMediaAssetId,
    sourceLabel: input.sourceLabel,
    capturedAt,
    spatialSpec: structuredClone(input.spatialSpec),
    audience: structuredClone(input.audience),
    cameraPosition,
    tileFovDegrees,
    tileSize,
    padding,
    columns: 3,
    rows: 2,
    tiles,
  };

  emit({ progress: 0.02, status: "Loading the source master for spatial capture…" });
  const response = await fetch(input.mediaUrl);
  if (!response.ok) throw new Error("The selected media could not be loaded for spatial capture.");
  const bitmap = await createImageBitmap(await response.blob(), { imageOrientation: "from-image" });
  const tileCanvas = document.createElement("canvas");
  tileCanvas.width = tileSize;
  tileCanvas.height = tileSize;
  const renderer = await createSourceMapPreviewRenderer(tileCanvas);
  const cellSize = tileSize + padding * 2;
  const atlas = document.createElement("canvas");
  atlas.width = cellSize * manifest.columns;
  atlas.height = cellSize * manifest.rows;
  const context = canvas2d(atlas);
  context.fillStyle = "#000";
  context.fillRect(0, 0, atlas.width, atlas.height);
  const individualTiles: Array<{
    id: SpatialTileDescriptor["id"];
    image: Blob;
    filename: string;
  }> = [];

  try {
    renderer.setSourceImage(bitmap);
    for (let index = 0; index < tiles.length; index += 1) {
      const tile = tiles[index]!;
      emit({
        progress: 0.08 + (index / tiles.length) * 0.72,
        status: `Capturing ${tile.label.toLowerCase()} crop ${index + 1} of ${tiles.length}…`,
      });
      await renderer.render({
        width: tileSize,
        height: tileSize,
        sourceProjectionMode: input.spatialSpec.projectionMode,
        projectionViewMode: "audience-space",
        projectionCamera: {
          ...camera,
          position: cameraPosition,
          orientation: tile.orientation,
          fovDegrees: tileFovDegrees,
          mode: "inside",
        },
        showProjectionGuides: false,
        guideOverlay: "clean",
        domeGuideSemanticSplit: input.spatialSpec.guideSplit,
        domeGuideHorizonSplit: input.spatialSpec.horizonSplit,
        showCaveMask: false,
        invertCaveMask: false,
        captureUnshaded: true,
        waitForCompletion: true,
        projectionSurface: input.spatialSpec.surface,
      });
      const x = (index % manifest.columns) * cellSize;
      const y = Math.floor(index / manifest.columns) * cellSize;
      const exportTile = tile.verticalWarp
        ? normalizeAngularRimTile(tileCanvas, tile, cameraPosition, tileFovDegrees)
        : tileCanvas;
      drawPaddedTile(context, exportTile, x, y, tileSize, padding);
      const tilePng = await canvasToBlob(exportTile, "image/png");
      const portableTile = await embedSpatialTilePngMetadata(tilePng, {
        format: "zenith-spatial-tile",
        version: 1,
        tileId: tile.id,
        manifest,
      });
      individualTiles.push({
        id: tile.id,
        image: portableTile,
        filename: `${String(index + 1).padStart(2, "0")}-${tile.id}-${slug(tile.label)}.png`,
      });
      await yieldToBrowser();
    }
  } finally {
    renderer.destroy();
    bitmap.close();
  }

  emit({ progress: 0.86, status: "Embedding projection, observer, and tile provenance…" });
  const atlasPng = await canvasToBlob(atlas, "image/png");
  const portableAtlas = await embedSpatialTileAtlasManifest(atlasPng, manifest);
  const atlasFilename = `zenith-spatial-atlas-${slug(input.sourceLabel)}-${tileSize}px.png`;
  const bundle = await createStoredZip([
    ...individualTiles.map((tile) => ({ name: `tiles/${tile.filename}`, data: tile.image })),
    { name: "zenith-spatial-manifest.json", data: JSON.stringify(manifest, null, 2) },
    { name: atlasFilename, data: portableAtlas },
  ]);
  emit({ progress: 1, status: "Spatial crop atlas is ready." });
  return {
    atlas: portableAtlas,
    atlasFilename,
    bundle,
    tiles: individualTiles,
    manifest,
    filename: `zenith-spatial-tiles-${slug(input.sourceLabel)}-${tileSize}px.zip`,
  };
}

/**
 * Reprojects an upscaled atlas into its original carrier and blends all shared
 * regions per frequency band. No provider call occurs here.
 */
export async function reconstructSpatialTileAtlas(
  atlasFile: Blob,
  fallbackManifest: SpatialTileAtlasManifest | null,
  emit: (progress: SpatialTileProgress) => void = () => {},
  reconstructedAt = new Date().toISOString(),
): Promise<SpatialTileReconstructionResult> {
  emit({ progress: 0.01, status: "Reading the spatial atlas and its provenance…" });
  const embeddedManifest = await readSpatialTileAtlasManifest(atlasFile);
  const manifest = embeddedManifest ?? fallbackManifest;
  if (!manifest) {
    throw new Error("This image has no Zenith tile metadata. Capture the source again before importing it.");
  }
  const atlasBitmap = await createImageBitmap(atlasFile, { imageOrientation: "from-image" });
  const expectedWidth = (manifest.tileSize + manifest.padding * 2) * manifest.columns;
  const expectedHeight = (manifest.tileSize + manifest.padding * 2) * manifest.rows;
  const scaleX = atlasBitmap.width / expectedWidth;
  const scaleY = atlasBitmap.height / expectedHeight;
  if (!Number.isFinite(scaleX) || scaleX < 0.5 || Math.abs(scaleX - scaleY) > Math.max(scaleX, scaleY) * 0.01) {
    atlasBitmap.close();
    throw new Error("The upscaled atlas changed its 3×2 tile layout or aspect ratio.");
  }
  const scale = (scaleX + scaleY) * 0.5;
  const outputWidth = Math.max(1, Math.round(manifest.spatialSpec.targetWidth * scale));
  const outputHeight = Math.max(1, Math.round(manifest.spatialSpec.targetHeight * scale));
  if (
    outputWidth > MAX_OUTPUT_DIMENSION ||
    outputHeight > MAX_OUTPUT_DIMENSION ||
    outputWidth * outputHeight > MAX_OUTPUT_PIXELS
  ) {
    atlasBitmap.close();
    throw new Error(
      `The reconstructed master would be ${outputWidth}×${outputHeight}. Keep it below ${MAX_OUTPUT_DIMENSION}px and 36 megapixels.`,
    );
  }

  emit({ progress: 0.06, status: `Extracting six ${scale.toFixed(2)}× processed crops…` });
  const tileImages = extractTiles(atlasBitmap, manifest, scale);
  atlasBitmap.close();
  const pyramids: PyramidImage[][] = [];
  for (let index = 0; index < tileImages.length; index += 1) {
    emit({
      progress: 0.1 + (index / tileImages.length) * 0.18,
      status: `Building Laplacian pyramid ${index + 1} of ${tileImages.length}…`,
    });
    pyramids.push(buildGaussianPyramid(tileImages[index]!, PYRAMID_LEVELS));
    await yieldToBrowser();
  }

  emit({ progress: 0.3, status: "Solving overlap exposure across neighboring crops…" });
  const preparedTiles: PreparedTile[] = manifest.tiles.map((tile, index) => ({
    basis: spatialTileBasis(tile),
    descriptor: tile,
    pyramid: pyramids[index]!,
    tangent: Math.tan((manifest.tileFovDegrees * Math.PI) / 360),
    cameraPosition: manifest.cameraPosition,
    tileFovDegrees: manifest.tileFovDegrees,
    gain: 1,
  }));
  const gains = estimateExposureGains(manifest, preparedTiles);
  for (let index = 0; index < preparedTiles.length; index += 1) preparedTiles[index]!.gain = gains[index] ?? 1;
  const output = document.createElement("canvas");
  output.width = outputWidth;
  output.height = outputHeight;
  const outputContext = canvas2d(output, { willReadFrequently: true });
  const outputImage = outputContext.createImageData(outputWidth, outputHeight);
  const outputData = outputImage.data;
  let covered = 0;
  let valid = 0;
  const surfacePointForUv = createSpatialSurfacePointMapper(manifest.spatialSpec);

  for (let y = 0; y < outputHeight; y += 1) {
    const v = (y + 0.5) / outputHeight;
    for (let x = 0; x < outputWidth; x += 1) {
      const u = (x + 0.5) / outputWidth;
      const offset = (y * outputWidth + x) * 4;
      const point = surfacePointForUv(u, v);
      if (!point) {
        outputData[offset + 3] = manifest.spatialSpec.exterior === "transparent" ? 0 : 255;
        continue;
      }
      valid += 1;
      const color = blendPyramidSample(point, manifest, preparedTiles);
      if (!color) {
        outputData[offset + 3] = 255;
        continue;
      }
      covered += 1;
      outputData[offset] = linearToSrgbByte(color[0]);
      outputData[offset + 1] = linearToSrgbByte(color[1]);
      outputData[offset + 2] = linearToSrgbByte(color[2]);
      outputData[offset + 3] = 255;
    }
    if (y % 48 === 0) {
      emit({
        progress: 0.32 + (y / outputHeight) * 0.58,
        status: `Reprojecting and blending row ${y + 1} of ${outputHeight}…`,
      });
      await yieldToBrowser();
    }
  }
  outputContext.putImageData(outputImage, 0, 0);

  const coverage = valid > 0 ? covered / valid : 0;
  if (coverage < 0.995) {
    throw new Error(`The imported atlas covers only ${(coverage * 100).toFixed(1)}% of the carrier.`);
  }
  const spatialSpec: ImageSpatialSpec = {
    ...structuredClone(manifest.spatialSpec),
    sourceWidth: outputWidth,
    sourceHeight: outputHeight,
    sourceAspectRatio: outputWidth / outputHeight,
    targetWidth: outputWidth,
    targetHeight: outputHeight,
  };
  const provenance: SpatialUpscaleProvenance = {
    version: 1,
    projectId: manifest.projectId,
    compositionId: manifest.compositionId,
    sourceTargetKind: manifest.sourceTargetKind,
    sourceTargetId: manifest.sourceTargetId,
    sourceMediaAssetId: manifest.sourceMediaAssetId,
    capturedAt: manifest.capturedAt,
    reconstructedAt,
    audience: structuredClone(manifest.audience),
    layout: manifest.tiles.some((tile) => tile.verticalWarp)
      ? "angular-rim-warped-cap"
      : "oriented-overlapping-cubemap",
    tileCount: 6,
    tileFovDegrees: manifest.tileFovDegrees,
    tileSize: manifest.tileSize,
    atlasPadding: manifest.padding,
    scale,
    blend: "laplacian-pyramid",
    pyramidLevels: pyramids[0]?.length ?? 1,
    exposureCompensation: true,
  };
  emit({ progress: 0.93, status: "Writing portable reconstruction provenance…" });
  const plainPng = await canvasToBlob(output, "image/png");
  const image = await embedSpatialUpscalePngMetadata(plainPng, {
    format: "zenith-spatial-upscale",
    version: 1,
    spatialSpec,
    provenance,
  });
  emit({ progress: 1, status: "Spatial master reconstructed locally." });
  return {
    image,
    manifest,
    spatialSpec,
    provenance,
    filename: `zenith-spatial-upscale-${slug(manifest.sourceLabel)}-${outputWidth}x${outputHeight}.png`,
    coverage,
    scale,
  };
}

/** Accepts either the legacy complete atlas or six independently upscaled tile PNGs. */
export async function reconstructSpatialTileFiles(
  files: ReadonlyArray<File>,
  fallbackManifest: SpatialTileAtlasManifest | null,
  emit: (progress: SpatialTileProgress) => void = () => {},
): Promise<SpatialTileReconstructionResult> {
  const pngFiles = files.filter((file) => file.type === "image/png" || file.name.toLowerCase().endsWith(".png"));
  const jsonFile = files.find((file) => file.type === "application/json" || file.name.toLowerCase().endsWith(".json"));
  if (pngFiles.length === 1 && !jsonFile) {
    return reconstructSpatialTileAtlas(pngFiles[0]!, fallbackManifest, emit);
  }
  if (pngFiles.length !== 6) {
    throw new Error("Select the six independently upscaled tile PNGs, or one complete 3×2 atlas PNG.");
  }

  emit({ progress: 0.01, status: "Matching six independently upscaled spatial tiles…" });
  let manifest = fallbackManifest;
  if (jsonFile) manifest = parseSpatialTileAtlasManifest(JSON.parse(await jsonFile.text()) as unknown);
  const identified: IdentifiedSpatialTileFile[] = [];
  for (const file of pngFiles) {
    const embedded = await readSpatialTilePngMetadata(file).catch(() => null);
    if (!manifest && embedded) manifest = embedded.manifest;
    const id = embedded?.tileId ?? tileIdFromFilename(file.name);
    if (!id) {
      throw new Error(`Could not identify ${file.name}. Preserve the numbered Zenith tile filenames.`);
    }
    identified.push({ id, file });
  }
  if (!manifest) {
    throw new Error("Tile metadata is missing. Select zenith-spatial-manifest.json with the six PNGs.");
  }
  const ids = new Set(identified.map((tile) => tile.id));
  if (ids.size !== 6 || manifest.tiles.some((tile) => !ids.has(tile.id))) {
    throw new Error("The selection must contain each of the six Zenith spatial tile identities exactly once.");
  }
  const atlas = await assembleSpatialTileAtlas(identified, manifest);
  return reconstructSpatialTileAtlas(atlas, manifest, (update) =>
    emit({ progress: 0.05 + update.progress * 0.95, status: update.status }),
  );
}

async function assembleSpatialTileAtlas(
  files: ReadonlyArray<IdentifiedSpatialTileFile>,
  manifest: SpatialTileAtlasManifest,
): Promise<Blob> {
  const bitmaps = new Map<SpatialTileDescriptor["id"], ImageBitmap>();
  try {
    for (const tile of files)
      bitmaps.set(tile.id, await createImageBitmap(tile.file, { imageOrientation: "from-image" }));
    const first = bitmaps.values().next().value as ImageBitmap | undefined;
    if (!first || first.width !== first.height) throw new Error("Each independently upscaled tile must remain square.");
    for (const bitmap of bitmaps.values()) {
      if (bitmap.width !== first.width || bitmap.height !== first.height) {
        throw new Error("All six independently upscaled tiles must have the same square dimensions.");
      }
    }
    const scale = first.width / manifest.tileSize;
    const cellSize = manifest.tileSize + manifest.padding * 2;
    const atlas = document.createElement("canvas");
    atlas.width = Math.round(cellSize * manifest.columns * scale);
    atlas.height = Math.round(cellSize * manifest.rows * scale);
    const context = canvas2d(atlas);
    context.fillStyle = "#000";
    context.fillRect(0, 0, atlas.width, atlas.height);
    manifest.tiles.forEach((tile, index) => {
      const bitmap = bitmaps.get(tile.id)!;
      const x = ((index % manifest.columns) * cellSize + manifest.padding) * scale;
      const y = (Math.floor(index / manifest.columns) * cellSize + manifest.padding) * scale;
      context.drawImage(bitmap, x, y, manifest.tileSize * scale, manifest.tileSize * scale);
    });
    return embedSpatialTileAtlasManifest(await canvasToBlob(atlas, "image/png"), manifest);
  } finally {
    for (const bitmap of bitmaps.values()) bitmap.close();
  }
}

function tileIdFromFilename(filename: string): SpatialTileDescriptor["id"] | null {
  const match = /^\d{2}-(front|right|back|left|up|down)(?:-|\.)/i.exec(filename.trim());
  return (match?.[1]?.toLowerCase() as SpatialTileDescriptor["id"] | undefined) ?? null;
}

function extractTiles(bitmap: ImageBitmap, manifest: SpatialTileAtlasManifest, scale: number): HTMLCanvasElement[] {
  const sourceCell = manifest.tileSize + manifest.padding * 2;
  const outputTileSize = Math.max(1, Math.round(manifest.tileSize * scale));
  return manifest.tiles.map((_, index) => {
    const sourceX = ((index % manifest.columns) * sourceCell + manifest.padding) * scale;
    const sourceY = (Math.floor(index / manifest.columns) * sourceCell + manifest.padding) * scale;
    const sourceSize = manifest.tileSize * scale;
    const tile = document.createElement("canvas");
    tile.width = outputTileSize;
    tile.height = outputTileSize;
    const context = canvas2d(tile, { willReadFrequently: true });
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = "high";
    context.drawImage(bitmap, sourceX, sourceY, sourceSize, sourceSize, 0, 0, outputTileSize, outputTileSize);
    return tile;
  });
}

function buildGaussianPyramid(source: HTMLCanvasElement, maxLevels: number): PyramidImage[] {
  const levels: PyramidImage[] = [];
  let current = source;
  for (let level = 0; level < maxLevels; level += 1) {
    const context = canvas2d(current, { willReadFrequently: true });
    levels.push({
      width: current.width,
      height: current.height,
      data: context.getImageData(0, 0, current.width, current.height).data,
    });
    if (current.width <= 32 || current.height <= 32) break;
    const next = document.createElement("canvas");
    next.width = Math.max(1, Math.ceil(current.width / 2));
    next.height = Math.max(1, Math.ceil(current.height / 2));
    const nextContext = canvas2d(next, { willReadFrequently: true });
    nextContext.imageSmoothingEnabled = true;
    nextContext.imageSmoothingQuality = "high";
    nextContext.drawImage(current, 0, 0, next.width, next.height);
    current = next;
  }
  return levels;
}

function blendPyramidSample(
  point: Vec3,
  manifest: SpatialTileAtlasManifest,
  preparedTiles: ReadonlyArray<PreparedTile>,
): [number, number, number] | null {
  const mapped: Array<{ tile: PreparedTile; sample: SpatialTileSample }> = [];
  let strongest = 0;
  let secondStrongest = 0;
  const direction = directionFromCamera(point, manifest.cameraPosition);
  for (const tile of preparedTiles) {
    const sample = directionToTileSample(direction, tile);
    if (!sample) continue;
    mapped.push({ tile, sample });
    if (sample.weight > strongest) {
      secondStrongest = strongest;
      strongest = sample.weight;
    } else if (sample.weight > secondStrongest) secondStrongest = sample.weight;
  }
  if (mapped.length === 0) return null;
  if (secondStrongest < strongest * 0.12) {
    const dominant = mapped.reduce((best, candidate) =>
      candidate.sample.weight > best.sample.weight ? candidate : best,
    );
    const color = sampleRgb(dominant.tile.pyramid[0]!, dominant.sample.u, dominant.sample.v);
    return [color[0] * dominant.tile.gain, color[1] * dominant.tile.gain, color[2] * dominant.tile.gain];
  }
  const result: [number, number, number] = [0, 0, 0];
  const levelCount = preparedTiles[0]?.pyramid.length ?? 0;
  for (let level = 0; level < levelCount; level += 1) {
    const band: [number, number, number] = [0, 0, 0];
    let totalWeight = 0;
    for (const { tile, sample } of mapped) {
      if (sample.weight < strongest * 0.015) continue;
      const pyramid = tile.pyramid;
      const current = sampleRgb(pyramid[level]!, sample.u, sample.v);
      const next = level + 1 < pyramid.length ? sampleRgb(pyramid[level + 1]!, sample.u, sample.v) : [0, 0, 0];
      const broadening = 1 / Math.max(1, level + 1);
      const weight = Math.pow(Math.max(sample.weight, 0.000001), broadening);
      const gain = tile.gain;
      band[0] += (current[0] - next[0]) * gain * weight;
      band[1] += (current[1] - next[1]) * gain * weight;
      band[2] += (current[2] - next[2]) * gain * weight;
      totalWeight += weight;
    }
    if (totalWeight > 0) {
      result[0] += band[0] / totalWeight;
      result[1] += band[1] / totalWeight;
      result[2] += band[2] / totalWeight;
    }
  }
  return result;
}

function estimateExposureGains(
  manifest: SpatialTileAtlasManifest,
  preparedTiles: ReadonlyArray<PreparedTile>,
): number[] {
  const pairSums = new Map<string, { sum: number; count: number }>();
  const gridX = 56;
  const gridY = Math.max(
    24,
    Math.round((gridX * manifest.spatialSpec.targetHeight) / manifest.spatialSpec.targetWidth),
  );
  for (let y = 0; y < gridY; y += 1) {
    for (let x = 0; x < gridX; x += 1) {
      const point = spatialSurfacePointFromSourceUv((x + 0.5) / gridX, (y + 0.5) / gridY, manifest.spatialSpec);
      if (!point) continue;
      const direction = directionFromCamera(point, manifest.cameraPosition);
      const samples = preparedTiles.flatMap((tile, index) => {
        const mapped = directionToTileSample(direction, tile);
        if (!mapped || mapped.weight < 0.03) return [];
        const rgb = sampleRgb(tile.pyramid[0]!, mapped.u, mapped.v);
        const luma = rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722;
        return luma > 0.001 ? [{ index, luma }] : [];
      });
      for (let left = 0; left < samples.length; left += 1) {
        for (let right = left + 1; right < samples.length; right += 1) {
          const a = samples[left]!;
          const b = samples[right]!;
          const key = `${a.index}:${b.index}`;
          const stat = pairSums.get(key) ?? { sum: 0, count: 0 };
          stat.sum += Math.log(b.luma / a.luma);
          stat.count += 1;
          pairSums.set(key, stat);
        }
      }
    }
  }
  const logs = new Array(manifest.tiles.length).fill(0) as number[];
  for (let iteration = 0; iteration < 16; iteration += 1) {
    const sums = new Array(logs.length).fill(0) as number[];
    const counts = new Array(logs.length).fill(0) as number[];
    for (const [key, stat] of pairSums) {
      if (stat.count < 3) continue;
      const [left, right] = key.split(":").map(Number) as [number, number];
      const relation = stat.sum / stat.count;
      sums[left] += logs[right]! + relation;
      counts[left] += 1;
      sums[right] += logs[left]! - relation;
      counts[right] += 1;
    }
    for (let index = 0; index < logs.length; index += 1) {
      if (counts[index]! > 0) logs[index] = sums[index]! / counts[index]!;
    }
    const mean = logs.reduce((sum, value) => sum + value, 0) / logs.length;
    for (let index = 0; index < logs.length; index += 1) logs[index] -= mean;
  }
  return logs.map((value) => clamp(Math.exp(value), 0.75, 1.333333));
}

function sampleRgb(image: PyramidImage, u: number, v: number): [number, number, number] {
  const x = clamp(u, 0, 1) * (image.width - 1);
  const y = clamp(v, 0, 1) * (image.height - 1);
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const x1 = Math.min(image.width - 1, x0 + 1);
  const y1 = Math.min(image.height - 1, y0 + 1);
  const tx = x - x0;
  const ty = y - y0;
  const a = pixelRgb(image, x0, y0);
  const b = pixelRgb(image, x1, y0);
  const c = pixelRgb(image, x0, y1);
  const d = pixelRgb(image, x1, y1);
  return [0, 1, 2].map((channel) => {
    const top = a[channel]! + (b[channel]! - a[channel]!) * tx;
    const bottom = c[channel]! + (d[channel]! - c[channel]!) * tx;
    return top + (bottom - top) * ty;
  }) as [number, number, number];
}

function pixelRgb(image: PyramidImage, x: number, y: number): [number, number, number] {
  const offset = (y * image.width + x) * 4;
  return [
    SRGB_TO_LINEAR[image.data[offset]!]!,
    SRGB_TO_LINEAR[image.data[offset + 1]!]!,
    SRGB_TO_LINEAR[image.data[offset + 2]!]!,
  ];
}

function linearToSrgbByte(value: number): number {
  const linear = clamp(value, 0, 1);
  const encoded = linear <= 0.0031308 ? linear * 12.92 : 1.055 * linear ** (1 / 2.4) - 0.055;
  return clamp(Math.round(encoded * 255), 0, 255);
}

function directionFromCamera(point: Vec3, camera: Vec3): Vec3 {
  const x = point[0] - camera[0];
  const y = point[1] - camera[1];
  const z = point[2] - camera[2];
  const length = Math.hypot(x, y, z) || 1;
  return [x / length, y / length, z / length];
}

function directionToTileSample(direction: Vec3, tile: PreparedTile): SpatialTileSample | null {
  const forward =
    direction[0] * tile.basis.forward[0] + direction[1] * tile.basis.forward[1] + direction[2] * tile.basis.forward[2];
  if (forward <= 0.000001) return null;
  const horizontal =
    direction[0] * tile.basis.right[0] + direction[1] * tile.basis.right[1] + direction[2] * tile.basis.right[2];
  const vertical = direction[0] * tile.basis.up[0] + direction[1] * tile.basis.up[1] + direction[2] * tile.basis.up[2];
  const nx = horizontal / (forward * tile.tangent);
  const ny = vertical / (forward * tile.tangent);
  if (Math.abs(nx) > 1.000001 || Math.abs(ny) > 1.000001) return null;
  const u = clamp(nx * 0.5 + 0.5, 0, 1);
  const v = clamp(0.5 - ny * 0.5, 0, 1);
  return remapSpatialTileSampleToAtlas({ u, v, weight: 1 }, tile.cameraPosition, tile.descriptor, tile.tileFovDegrees);
}

function normalizeAngularRimTile(
  source: HTMLCanvasElement,
  tile: SpatialTileDescriptor,
  cameraPosition: Vec3,
  tileFovDegrees: number,
): HTMLCanvasElement {
  if (!tile.verticalWarp) return source;
  const output = document.createElement("canvas");
  output.width = source.width;
  output.height = source.height;
  const context = canvas2d(output);
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = "high";
  for (let x = 0; x < output.width; x += 1) {
    const boundaryV = spatialTileRimBoundaryV((x + 0.5) / output.width, cameraPosition, tile, tileFovDegrees);
    if (boundaryV === null) continue;
    const boundaryY = boundaryV * source.height;
    const sourceY = tile.verticalWarp.validSide === "above" ? 0 : Math.min(source.height - 1, boundaryY + 1);
    const sourceHeight =
      tile.verticalWarp.validSide === "above" ? Math.max(1, boundaryY - 1) : Math.max(1, source.height - sourceY);
    context.drawImage(source, x, sourceY, 1, sourceHeight, x, 0, 1, output.height);
  }
  return output;
}

function drawPaddedTile(
  context: CanvasRenderingContext2D,
  source: HTMLCanvasElement,
  x: number,
  y: number,
  size: number,
  padding: number,
): void {
  context.drawImage(source, x + padding, y + padding, size, size);
  if (padding <= 0) return;
  context.drawImage(source, 0, 0, size, 1, x + padding, y, size, padding);
  context.drawImage(source, 0, size - 1, size, 1, x + padding, y + padding + size, size, padding);
  context.drawImage(source, 0, 0, 1, size, x, y + padding, padding, size);
  context.drawImage(source, size - 1, 0, 1, size, x + padding + size, y + padding, padding, size);
  context.drawImage(source, 0, 0, 1, 1, x, y, padding, padding);
  context.drawImage(source, size - 1, 0, 1, 1, x + padding + size, y, padding, padding);
  context.drawImage(source, 0, size - 1, 1, 1, x, y + padding + size, padding, padding);
  context.drawImage(source, size - 1, size - 1, 1, 1, x + padding + size, y + padding + size, padding, padding);
}

function canvas2d(canvas: HTMLCanvasElement, settings?: CanvasRenderingContext2DSettings): CanvasRenderingContext2D {
  const context = canvas.getContext("2d", settings);
  if (!context) throw new Error("A 2D canvas is required for spatial tile processing.");
  return context;
}

function yieldToBrowser(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}

function slug(value: string): string {
  return (
    value
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 54) || "media"
  );
}

export function spatialTileAtlasScale(
  width: number,
  height: number,
  manifest: SpatialTileAtlasManifest,
): number | null {
  const expectedWidth = (manifest.tileSize + manifest.padding * 2) * manifest.columns;
  const expectedHeight = (manifest.tileSize + manifest.padding * 2) * manifest.rows;
  const x = width / expectedWidth;
  const y = height / expectedHeight;
  return x >= 0.5 && Math.abs(x - y) <= Math.max(x, y) * 0.01 ? (x + y) * 0.5 : null;
}

export function spatialTileOverlapDegrees(
  tileFovDegrees = DEFAULT_TILE_FOV_DEGREES,
  centerSpacingDegrees = 90,
): number {
  return Math.max(0, tileFovDegrees - centerSpacingDegrees);
}

export function spatialTileDescriptorById(
  manifest: SpatialTileAtlasManifest,
  id: SpatialTileDescriptor["id"],
): SpatialTileDescriptor | null {
  return manifest.tiles.find((tile) => tile.id === id) ?? null;
}
