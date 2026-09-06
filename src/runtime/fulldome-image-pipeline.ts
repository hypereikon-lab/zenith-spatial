/**
 * Narrow reusable boundary for the curated-reference → Plate Sketch PNG stage.
 *
 * Geometry stays pure and testable; browser media ownership and exact WebGPU
 * rendering stay in the existing Workbench runtime.
 */
export {
  arrangeFulldomeBundle,
  isFulldomeBundleSize,
  FULLDOME_BUNDLE_ORIENTATIONS,
  type FulldomeBundleArrangement,
  type FulldomeBundleArrangementOptions,
  type FulldomeBundleOrientation,
  type FulldomeBundleSlot,
} from "../plates/fulldome-bundle-arrangement.js";

export {
  arrangeFulldomePlateBundle,
  exactPlateDraftPreviewInput,
  prepareAndRenderFulldomePlateBundlePng,
  prepareFulldomePlateBundle,
  renderExactPlateDraftPng,
  type ExactPlateDraftPng,
  type FulldomePlateBundleResult,
  type PreparedFulldomePlateBundlePng,
} from "./browser-workbench-commands.js";
