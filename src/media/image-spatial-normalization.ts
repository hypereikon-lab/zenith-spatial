import { projectionCarrierProfile } from "../geometry/projection-carrier-profile.js";
import type {
  CompositionRevision,
  CompositionRevisionMedia,
  ImageSpatialSpec,
} from "../lib/shared/contracts/composition-sequence.js";

export const IMAGE_SPATIAL_NORMALIZATION_VERSION = 2;
export const IMAGE_SPATIAL_NORMALIZATION_CONFIG_KEY = "imageSpatialNormalizationVersion";

export function currentImageSpatialNormalizationConfig(
  config: CompositionRevision["config"] = undefined,
): NonNullable<CompositionRevision["config"]> {
  return {
    ...(config || {}),
    [IMAGE_SPATIAL_NORMALIZATION_CONFIG_KEY]: IMAGE_SPATIAL_NORMALIZATION_VERSION,
  };
}

export function imageSpatialNormalizationIsCurrent(revision: CompositionRevision): boolean {
  return revision.config?.[IMAGE_SPATIAL_NORMALIZATION_CONFIG_KEY] === IMAGE_SPATIAL_NORMALIZATION_VERSION;
}

export type ImageSpatialDrawPlan = {
  sourceWidth: number;
  sourceHeight: number;
  targetWidth: number;
  targetHeight: number;
  drawWidth: number;
  drawHeight: number;
  centerX: number;
  centerY: number;
  rotationRadians: number;
  clip: ImageSpatialClip;
  /** Circular clip compatibility for angular consumers. Cylinder clips are elliptical. */
  clipRadius: number | null;
};

export type ImageSpatialClip =
  | { kind: "circle"; radius: number }
  | { kind: "ellipse"; radiusX: number; radiusY: number }
  | null;

export function imageSpatialDrawPlan(
  sourceWidth: number,
  sourceHeight: number,
  spec: ImageSpatialSpec,
): ImageSpatialDrawPlan {
  const safeSourceWidth = Math.max(1, sourceWidth);
  const safeSourceHeight = Math.max(1, sourceHeight);
  const targetWidth = Math.max(1, Math.round(spec.targetWidth));
  const targetHeight = Math.max(1, Math.round(spec.targetHeight));
  const containScale = Math.min(targetWidth / safeSourceWidth, targetHeight / safeSourceHeight);
  const coverScale = Math.max(targetWidth / safeSourceWidth, targetHeight / safeSourceHeight);
  const topology = projectionCarrierProfile(spec.projectionMode).topology;
  const projectionAwareStretch = spec.fit === "projection-aware" && topology !== "circular-fisheye";
  const baseScale = spec.fit === "cover" ? coverScale : containScale;
  const stretch = spec.fit === "stretch" || projectionAwareStretch;
  const drawWidth = stretch ? targetWidth * spec.scale : safeSourceWidth * baseScale * spec.scale;
  const drawHeight = stretch ? targetHeight * spec.scale : safeSourceHeight * baseScale * spec.scale;
  const clip = imageSpatialClip(spec, targetWidth, targetHeight);
  return {
    sourceWidth: safeSourceWidth,
    sourceHeight: safeSourceHeight,
    targetWidth,
    targetHeight,
    drawWidth,
    drawHeight,
    centerX: targetWidth * (0.5 + spec.offsetX * 0.5),
    centerY: targetHeight * (0.5 + spec.offsetY * 0.5),
    rotationRadians: (spec.rotationDegrees * Math.PI) / 180,
    clip,
    clipRadius: clip?.kind === "circle" ? clip.radius : null,
  };
}

export async function normalizeImageRevisionMedia(
  media: CompositionRevisionMedia,
  spec: ImageSpatialSpec,
): Promise<{ media: CompositionRevisionMedia; spatialSpec: ImageSpatialSpec }> {
  if (media.kind !== "image" || typeof document === "undefined" || typeof Image === "undefined") {
    return { media, spatialSpec: spec };
  }
  const image = await loadImage(media.url);
  const sourceWidth = Math.max(1, image.naturalWidth || spec.sourceWidth || 1);
  const sourceHeight = Math.max(1, image.naturalHeight || spec.sourceHeight || 1);
  const spatialSpec: ImageSpatialSpec = {
    ...spec,
    sourceWidth,
    sourceHeight,
    sourceAspectRatio: sourceWidth / sourceHeight,
  };
  const plan = imageSpatialDrawPlan(sourceWidth, sourceHeight, spatialSpec);
  const canvas = document.createElement("canvas");
  canvas.width = plan.targetWidth;
  canvas.height = plan.targetHeight;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Canvas 2D is required to normalize a Composition image.");

  if (spatialSpec.exterior === "black") {
    context.fillStyle = "#000";
    context.fillRect(0, 0, plan.targetWidth, plan.targetHeight);
  } else {
    context.clearRect(0, 0, plan.targetWidth, plan.targetHeight);
  }
  context.save();
  if (plan.clip?.kind === "circle") {
    context.beginPath();
    context.arc(plan.targetWidth / 2, plan.targetHeight / 2, plan.clip.radius, 0, Math.PI * 2);
    context.clip();
  } else if (plan.clip?.kind === "ellipse") {
    context.beginPath();
    context.ellipse(
      plan.targetWidth / 2,
      plan.targetHeight / 2,
      plan.clip.radiusX,
      plan.clip.radiusY,
      0,
      0,
      Math.PI * 2,
    );
    context.clip();
  }
  context.translate(plan.centerX, plan.centerY);
  context.rotate(plan.rotationRadians);
  context.drawImage(image, -plan.drawWidth / 2, -plan.drawHeight / 2, plan.drawWidth, plan.drawHeight);
  context.restore();

  return {
    media: {
      kind: "image",
      url: canvas.toDataURL("image/png"),
      name: normalizedName(media.name),
      mime: "image/png",
      alt: media.alt || "Canonical normalized composition image",
    },
    spatialSpec,
  };
}

function imageSpatialClip(spec: ImageSpatialSpec, targetWidth: number, targetHeight: number): ImageSpatialClip {
  const topology = projectionCarrierProfile(spec.projectionMode).topology;
  if (topology === "circular-fisheye") {
    return {
      kind: "circle",
      radius: Math.min(targetWidth, targetHeight) * 0.5 * spec.safeRimRadius,
    };
  }
  if (topology === "circular-cylinder") {
    return {
      kind: "ellipse",
      radiusX: targetWidth * 0.5 * spec.safeRimRadius,
      radiusY: targetHeight * 0.5 * spec.safeRimRadius,
    };
  }
  return null;
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.decoding = "async";
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("Could not decode the Composition image for spatial normalization."));
    image.src = url;
  });
}

function normalizedName(name: string | undefined): string {
  const stem = (name || "composition-image").replace(/\.[^.]+$/, "");
  return `${stem}-canonical.png`;
}
