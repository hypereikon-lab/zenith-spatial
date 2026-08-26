import type { MediaAsset } from "../domain/schema.js";

export const DEFAULT_REVIEW_MEDIA_ID = "media-demo-forest-domemaster-180";
export const DEFAULT_REVIEW_TAKE_ID = "image-take-demo-forest-domemaster-180";

export function defaultReviewMediaAsset(createdAt: string): MediaAsset {
  return {
    id: DEFAULT_REVIEW_MEDIA_ID,
    kind: "image",
    filename: "forest-domemaster-180.png",
    mime: "image/png",
    width: 1920,
    height: 1920,
    storageRef: "/demo-media/forest-domemaster-180.png",
    alt: "Forest canopy demo in an equidistant 180-degree domemaster",
    createdAt,
  };
}
