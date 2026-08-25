import { clamp } from "../projection.js";
import {
  DEFAULT_SOURCE_INNER_GUIDE_SPLIT,
  MAX_SOURCE_INNER_GUIDE_SPLIT,
  MIN_SOURCE_INNER_GUIDE_SPLIT,
  normalizeSourceInnerGuideSplit,
  sourceGuideCarrierHorizonRadius,
} from "./source-guide-semantics.js";
import type { SourceProjectionMode } from "./source-projection.js";

export type DomeGuideRgb = readonly [number, number, number];
export type DomeGuideScaffold = {
  semanticSplit: number;
  spokeStartRadius: number;
  ringRadii: number[];
};

const OUTER_GUIDE_STEPS = [0.5] as const;

export const DOME_HANDOFF_GUIDE = {
  defaultSemanticSplit: DEFAULT_SOURCE_INNER_GUIDE_SPLIT,
  colors: {
    sky: [0, 222, 255] as const,
    horizon: [0, 255, 176] as const,
    floor: [0, 255, 0] as const,
    line: [0, 0, 0] as const,
  },
  semanticTransitionWidth: 0.012,
  promptTerms: {
    skyColor:
      "cyan/blue guide fill marks missing pixels allocated to overhead projection directions; it does not request literal sky, ceiling, or canopy",
    horizonColor:
      "aqua/green guide fill marks missing pixels allocated to human-level projection directions; it does not request literal landscape, horizon, garden, or wall imagery",
    floorColor:
      "neon green guide fill marks missing pixels allocated below the viewing horizon; it does not request literal ground, terrain, floor, or water",
    split:
      "the authored color stops reserve source-map area for directional carrier bands; the continuous field provides positional evidence without prescribing subject matter or baking rings and spokes",
    zenith180:
      "the inner disk is the overhead directional band and the outer field is the human-level directional band; both must continue the source-derived visual medium rather than inventing a literal environment",
    zenith230:
      "the inner disk is the overhead band, the middle field is the human-level band, and the outer annulus is the below-horizon band; these are spatial allocations, not subject prompts",
    nadir180:
      "the inner disk is the downward directional band and the outer field approaches human-level directions; these are spatial allocations, not requests for ground, walls, landscape, or sky",
  },
} as const;

export function domeGuideBackgroundColor(
  mode: SourceProjectionMode,
  radius: number,
  horizonRadius: number,
  semanticSplit = DOME_HANDOFF_GUIDE.defaultSemanticSplit,
  carrierHorizonRadius?: number | string | null,
): [number, number, number] {
  const split = normalizeDomeGuideSemanticSplit(semanticSplit);
  const carrierHorizon = sourceGuideCarrierHorizonRadius(mode, split, carrierHorizonRadius);
  const transition = DOME_HANDOFF_GUIDE.semanticTransitionWidth;

  if (mode === "nadir-180") {
    const horizonAmount = smoothstep(split - transition, split + transition, radius);
    return mixGuideColors(DOME_HANDOFF_GUIDE.colors.floor, DOME_HANDOFF_GUIDE.colors.horizon, horizonAmount);
  }

  if (mode === "zenith-230") {
    const horizonAmount = smoothstep(split - transition, split + transition, radius);
    const floorAmount = smoothstep(carrierHorizon - transition, carrierHorizon + transition, radius);
    return mixGuideColors(
      mixGuideColors(DOME_HANDOFF_GUIDE.colors.sky, DOME_HANDOFF_GUIDE.colors.horizon, horizonAmount),
      DOME_HANDOFF_GUIDE.colors.floor,
      floorAmount,
    );
  }

  const horizonAmount = smoothstep(split - transition, split + transition, radius);
  return mixGuideColors(DOME_HANDOFF_GUIDE.colors.sky, DOME_HANDOFF_GUIDE.colors.horizon, horizonAmount);
}

export function domeGuidePromptClause(
  mode: SourceProjectionMode,
  semanticSplit: number | string | null | undefined = DOME_HANDOFF_GUIDE.defaultSemanticSplit,
  carrierHorizonRadius?: number | string | null,
): string {
  const terms = DOME_HANDOFF_GUIDE.promptTerms;
  const splitPercent = Math.round(normalizeDomeGuideSemanticSplit(semanticSplit) * 100);
  if (mode === "zenith-230") {
    const horizonPercent = Math.round(sourceGuideCarrierHorizonRadius(mode, semanticSplit, carrierHorizonRadius) * 100);
    return `Visual harness: ${terms.skyColor}; ${terms.horizonColor}; ${terms.floorColor}; ${terms.zenith230}. The current inner overhead/human-level split is ${splitPercent}% from the center, and the physical horizon is remapped to a second guide boundary at ${horizonPercent}% of the source radius; ${terms.split}.`;
  }
  if (mode === "nadir-180") {
    return `Visual harness: ${terms.floorColor}; ${terms.horizonColor}; ${terms.skyColor}; ${terms.nadir180}. The current downward/human-level spatial split is ${splitPercent}% from the center; ${terms.split}.`;
  }
  return `Visual harness: ${terms.skyColor}; ${terms.horizonColor}; ${terms.zenith180}. The current overhead/human-level spatial split is ${splitPercent}% from the center; ${terms.split}.`;
}

export function domeGuideScaffold(
  mode: SourceProjectionMode,
  horizonRadius: number,
  semanticSplit: number | string | null | undefined = DOME_HANDOFF_GUIDE.defaultSemanticSplit,
  carrierHorizonRadius?: number | string | null,
): DomeGuideScaffold {
  const split = normalizeDomeGuideSemanticSplit(semanticSplit);
  const horizon = clamp(horizonRadius, 0, 1);
  const carrierHorizon = sourceGuideCarrierHorizonRadius(mode, split, carrierHorizonRadius);
  const wallEnd = mode === "zenith-230" ? clamp(carrierHorizon, split + 0.04, 0.98) : 1;
  const ringRadii = uniqueSortedRadii([
    split,
    ...OUTER_GUIDE_STEPS.map((step) => mixRadius(split, wallEnd, step)),
    ...(mode === "zenith-230" && horizon < 0.98 ? [carrierHorizon, mixRadius(carrierHorizon, 1, 0.5)] : []),
  ]);
  return {
    semanticSplit: split,
    spokeStartRadius: split,
    ringRadii,
  };
}

export function normalizeDomeGuideSemanticSplit(value: number | string | null | undefined): number {
  return clamp(normalizeSourceInnerGuideSplit(value), MIN_SOURCE_INNER_GUIDE_SPLIT, MAX_SOURCE_INNER_GUIDE_SPLIT);
}

function uniqueSortedRadii(values: number[]): number[] {
  return [...new Set(values.map((value) => Math.round(clamp(value, 0, 1) * 10000) / 10000))]
    .filter((value) => value > 0.001 && value < 0.999)
    .sort((a, b) => a - b);
}

function mixRadius(from: number, to: number, amount: number): number {
  return from + (to - from) * amount;
}

function mixGuideColors(from: DomeGuideRgb, to: DomeGuideRgb, amount: number): [number, number, number] {
  const t = clamp(amount, 0, 1);
  return [
    Math.round(from[0] + (to[0] - from[0]) * t),
    Math.round(from[1] + (to[1] - from[1]) * t),
    Math.round(from[2] + (to[2] - from[2]) * t),
  ];
}

function smoothstep(edge0: number, edge1: number, value: number): number {
  const t = clamp((value - edge0) / Math.max(edge1 - edge0, 0.000001), 0, 1);
  return t * t * (3 - 2 * t);
}
