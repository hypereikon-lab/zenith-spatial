import {
  cloneDefaultDomeScene,
  parseDomeScene,
  type DomeScene,
  type DomeSceneFrame0,
  type DomeScenePlateFit,
  type DomeScenePlateLayer,
  type DomeScenePlatePlacement,
} from "../lib/shared/contracts/dome-scene.js";
import { normalizeProjectionSurfaceForMode } from "../lib/shared/contracts/projection-authoring.js";
import type { PlateSketchPreviewInput } from "../plates/plate-sketch-preview-session.js";
import type { PlateSketchImage } from "../plates/plate-sketch-sources.js";
import type { NormalizedPlatePlacement } from "../plates/plate-placement.js";

export { cloneDefaultDomeScene, parseDomeScene };
export type { DomeScene, DomeSceneFrame0, DomeScenePlateLayer };

export function createDefaultDomeScene(overrides: Partial<DomeScene> = {}): DomeScene {
  const defaults = cloneDefaultDomeScene();
  const projectionMode = overrides.projectionMode || defaults.projectionMode;
  return parseDomeScene({
    ...defaults,
    ...overrides,
    version: defaults.version,
    projectionMode,
    surface: normalizeProjectionSurfaceForMode(overrides.surface || defaults.surface, projectionMode),
    frame0: { ...defaults.frame0, ...overrides.frame0 },
  });
}

export function domeSceneWithFrame0FromPlateSketchInput(
  scene: DomeScene,
  input: PlateSketchPreviewInput,
  { activeIndex = 0 }: { activeIndex?: number } = {},
): DomeScene {
  return parseDomeScene({
    ...scene,
    projectionMode: input.sourceProjectionMode,
    surface: normalizeProjectionSurfaceForMode(input.projectionSurface || scene.surface, input.sourceProjectionMode),
    guideSplit: input.domeGuideSemanticSplit,
    horizonSplit: input.domeGuideHorizonSplit,
    frame0: domeSceneFrame0FromPlateSketchInput(input, { activeIndex }),
  });
}

export function domeSceneFrame0FromPlateSketchInput(
  input: PlateSketchPreviewInput,
  { activeIndex = 0 }: { activeIndex?: number } = {},
): DomeSceneFrame0 {
  const count = Math.min(input.plates.length, input.placements.length);
  const plateLayers: DomeScenePlateLayer[] = [];
  for (let index = 0; index < count; index += 1) {
    plateLayers.push(domeScenePlateLayerFromPlateSketch(input.plates[index], input.placements[index], index));
  }
  return {
    plateFit: domeScenePlateFit(input.plateFit),
    plateFeather: input.plateFeather,
    activeLayerId: plateLayers[activeIndex]?.id || plateLayers[0]?.id || null,
    plateLayers,
  };
}

export function domeScenePlateLayerFromPlateSketch(
  plate: PlateSketchImage,
  placement: NormalizedPlatePlacement,
  index: number,
): DomeScenePlateLayer {
  const id = plate.layerId || domeScenePlateLayerId(index, plate.name);
  return {
    id,
    name: plate.name,
    index,
    source: {
      ...(plate.assetId ? { assetId: plate.assetId } : {}),
      name: plate.name,
      width: plate.width,
      height: plate.height,
      aspect: plate.aspect || plate.width / Math.max(plate.height, 1),
      ...(plate.sourceUrl && !plate.sourceUrl.startsWith("blob:") ? { url: plate.sourceUrl } : {}),
      ...(plate.mime ? { mime: plate.mime } : {}),
    },
    placement: clonePlatePlacement(placement),
    visible: true,
    locked: false,
  };
}

export function domeScenePlateLayerId(index: number, name: string): string {
  const slug = name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "plate";
  return `plate-layer-${index + 1}-${slug}`;
}

export function domeScenePlateSourceSignature(frame0: DomeSceneFrame0): string {
  return JSON.stringify({
    fit: frame0.plateFit,
    feather: frame0.plateFeather,
    layers: frame0.plateLayers.map((layer) => ({
      id: layer.id,
      name: layer.name,
      source: layer.source,
      placement: layer.placement,
      visible: layer.visible,
      locked: layer.locked,
    })),
  });
}

export function domeScenePlateImageFromLayer(layer: DomeScenePlateLayer, canvas: HTMLCanvasElement): PlateSketchImage {
  return {
    name: layer.source.name,
    width: Math.max(1, Math.round(layer.source.width || canvas.width)),
    height: Math.max(1, Math.round(layer.source.height || canvas.height)),
    aspect: layer.source.aspect || canvas.width / Math.max(canvas.height, 1),
    canvas,
    layerId: layer.id,
    ...(layer.source.assetId ? { assetId: layer.source.assetId } : {}),
    ...(layer.source.url ? { sourceUrl: layer.source.url } : {}),
    ...(layer.source.mime ? { mime: layer.source.mime } : {}),
  };
}

export function plateLikeFromDomeSceneLayer(
  layer: DomeScenePlateLayer,
): Pick<PlateSketchImage, "name" | "width" | "height" | "aspect"> {
  return {
    name: layer.source.name,
    width: layer.source.width,
    height: layer.source.height,
    aspect: layer.source.aspect,
  };
}

export function clonePlatePlacement(placement: DomeScenePlatePlacement): NormalizedPlatePlacement {
  return {
    azimuth: placement.azimuth,
    radius: placement.radius,
    scale: placement.scale,
    spin: placement.spin,
    opacity: placement.opacity,
    flipX: placement.flipX,
    flipY: placement.flipY,
    cornerOffsets: {
      nw: { ...placement.cornerOffsets.nw },
      ne: { ...placement.cornerOffsets.ne },
      se: { ...placement.cornerOffsets.se },
      sw: { ...placement.cornerOffsets.sw },
    },
  };
}

function domeScenePlateFit(value: string): DomeScenePlateFit {
  return value === "cover" || value === "stretch" ? value : "contain";
}
