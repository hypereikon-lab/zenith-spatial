import { caveGuideLineWidthForSize } from "../geometry/cave-handoff-guide.js";
import { type SourceProjectionMode } from "../geometry/source-projection.js";
import { preparePlatePlacement } from "./plate-placement.js";
import { type PlacementUniformOptions } from "./plate-gpu-compositor-types.js";
import { encodeTypeGpuData } from "../graphics/typegpu/encoding.js";
import { plateCompositeUniformSchema, plateGuideUniformSchema } from "../graphics/typegpu/contracts.js";
import { compileProjectionKernelParams } from "../geometry/projection-kernel-parameters.js";
import { PlateFitCode } from "../kernels/plates/placement.js";
import type { ProjectionSurface } from "../lib/shared/contracts/projection-authoring.js";

export function placementUniformData({
  placement,
  plate,
  plateFit,
  plateFeather,
  outputWidth,
  outputHeight,
  sourceProjectionMode,
  projectionSurface,
  domeGuideSemanticSplit,
  domeGuideHorizonSplit,
  rasterInnerSplit,
}: PlacementUniformOptions): Float32Array {
  return encodeTypeGpuData(
    plateCompositeUniformSchema,
    placementUniformValue({
      placement,
      plate,
      plateFit,
      plateFeather,
      outputWidth,
      outputHeight,
      sourceProjectionMode,
      projectionSurface,
      domeGuideSemanticSplit,
      domeGuideHorizonSplit,
      rasterInnerSplit,
    }),
  );
}

export function placementUniformValue({
  placement,
  plate,
  plateFit,
  plateFeather,
  outputWidth,
  outputHeight,
  sourceProjectionMode,
  projectionSurface,
  domeGuideSemanticSplit,
  domeGuideHorizonSplit,
  rasterInnerSplit,
}: PlacementUniformOptions) {
  const prepared = preparePlatePlacement(
    placement,
    plate,
    sourceProjectionMode,
    domeGuideSemanticSplit,
    domeGuideHorizonSplit,
    projectionSurface,
  );
  return {
    plate: {
      center: prepared.center,
      right: prepared.right,
      down: prepared.down,
      angularSize: [prepared.angularWidth, prepared.angularHeight] as const,
      spin: [prepared.spinSin, prepared.spinCos] as const,
      opacity: Number(prepared.opacity) || 0,
      feather: Number(plateFeather) || 0,
      sourceAspect: Number(plate.aspect) || 1,
      fit: plateFitMode(plateFit),
      flipX: prepared.flipX ? 1 : 0,
      flipY: prepared.flipY ? 1 : 0,
      warpNorth: [
        prepared.cornerOffsets.nw.x,
        prepared.cornerOffsets.nw.y,
        prepared.cornerOffsets.ne.x,
        prepared.cornerOffsets.ne.y,
      ] as const,
      warpSouth: [
        prepared.cornerOffsets.sw.x,
        prepared.cornerOffsets.sw.y,
        prepared.cornerOffsets.se.x,
        prepared.cornerOffsets.se.y,
      ] as const,
    },
    projection: compileProjectionKernelParams({
      mode: sourceProjectionMode,
      width: outputWidth,
      height: outputHeight,
      innerSplit: domeGuideSemanticSplit,
      rasterInnerSplit,
      horizonSplit: domeGuideHorizonSplit,
      surface: projectionSurface,
    }),
  };
}

export function plateFitMode(value: string): number {
  if (value === "cover") return PlateFitCode.Cover;
  if (value === "stretch") return PlateFitCode.Stretch;
  return PlateFitCode.Contain;
}

export function guideUniformData(
  outputWidth: number,
  outputHeight: number,
  sourceProjectionMode: SourceProjectionMode,
  domeGuideSemanticSplit: number | string | null | undefined,
  domeGuideHorizonSplit?: number | string | null,
  projectionSurface?: ProjectionSurface,
): Float32Array {
  return encodeTypeGpuData(
    plateGuideUniformSchema,
    guideUniformValue(
      outputWidth,
      outputHeight,
      sourceProjectionMode,
      domeGuideSemanticSplit,
      domeGuideHorizonSplit,
      projectionSurface,
    ),
  );
}

export function guideUniformValue(
  outputWidth: number,
  outputHeight: number,
  sourceProjectionMode: SourceProjectionMode,
  domeGuideSemanticSplit: number | string | null | undefined,
  domeGuideHorizonSplit?: number | string | null,
  projectionSurface?: ProjectionSurface,
) {
  const shortEdge = Math.max(Math.min(outputWidth, outputHeight), 1);
  return {
    projection: compileProjectionKernelParams({
      mode: sourceProjectionMode,
      width: outputWidth,
      height: outputHeight,
      innerSplit: domeGuideSemanticSplit,
      horizonSplit: domeGuideHorizonSplit,
      surface: projectionSurface,
    }),
    lineWidth:
      sourceProjectionMode === "cave-270" || sourceProjectionMode === "hall-double-gable"
        ? caveGuideLineWidthForSize(shortEdge)
        : 1 / shortEdge,
  };
}
