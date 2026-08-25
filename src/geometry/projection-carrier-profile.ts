import {
  SOURCE_PROJECTION_DEFAULT_GUIDES,
  type SourceProjectionMode,
} from "../lib/shared/contracts/projection-profile.js";
export type ProjectionCarrierRenderTarget = "source-map" | "cave-carrier" | "cylinder-carrier";

export type ProjectionCarrierTopology =
  | "circular-fisheye"
  | "square-perimeter"
  | "gabled-shell"
  | "circular-cylinder"
  | "unwrapped-cylinder";
export type ProjectionCarrierCenter = "zenith" | "nadir";

export type ProjectionCarrierProfile = {
  mode: SourceProjectionMode;
  label: string;
  shortLabel: string;
  topology: ProjectionCarrierTopology;
  center: ProjectionCarrierCenter;
  fieldOfViewDegrees: number | null;
  coverageLabel: string;
  innerSplit: {
    default: number;
    min: number;
    max: number;
    label: string;
  };
  hasCarrierHorizon: boolean;
  carrierHorizonWallFraction: number;
  surface?: {
    width: number;
    depth: number;
    radius: number;
    height: number;
    eyeHeight: number;
    eyeX: number;
    eyeZ: number;
  };
};

const STANDARD_SPLIT = { default: 1 / 3, min: 0.18, max: 0.72 } as const;
const CYLINDER_CAP_SPLIT = {
  default: SOURCE_PROJECTION_DEFAULT_GUIDES["cylinder-nadir"].innerSplit,
  min: 0.005,
  max: 0.25,
} as const;
const CYLINDER_WALL_HORIZON = { default: 0.5, min: 0.1, max: 0.9 } as const;

/**
 * Authoritative numerical and semantic projection registry.
 *
 * CPU projection functions, GPU uniform encoders, guide controls and prompt
 * language all derive their mode decisions from this record. WGSL still has
 * to execute its own arithmetic, but it receives these normalized parameters
 * rather than inventing mode-specific clamps or dimensions.
 */
export const PROJECTION_CARRIER_PROFILES: Readonly<Record<SourceProjectionMode, ProjectionCarrierProfile>> = {
  "zenith-180": {
    mode: "zenith-180",
    label: "Zenith 180",
    shortLabel: "Z180",
    topology: "circular-fisheye",
    center: "zenith",
    fieldOfViewDegrees: 180,
    coverageLabel: "180° fisheye",
    innerSplit: { ...STANDARD_SPLIT, label: "Sky / horizon split" },
    hasCarrierHorizon: false,
    carrierHorizonWallFraction: 1,
  },
  "zenith-230": {
    mode: "zenith-230",
    label: "Zenith 230",
    shortLabel: "Z230",
    topology: "circular-fisheye",
    center: "zenith",
    fieldOfViewDegrees: 230,
    coverageLabel: "230° fisheye",
    innerSplit: { ...STANDARD_SPLIT, label: "Sky / human-level split" },
    hasCarrierHorizon: true,
    carrierHorizonWallFraction: 18 / 23,
  },
  "nadir-180": {
    mode: "nadir-180",
    label: "Nadir 180",
    shortLabel: "N180",
    topology: "circular-fisheye",
    center: "nadir",
    fieldOfViewDegrees: 180,
    coverageLabel: "180° fisheye",
    innerSplit: { ...STANDARD_SPLIT, label: "Floor / horizon split" },
    hasCarrierHorizon: false,
    carrierHorizonWallFraction: 1,
  },
  "cave-270": {
    mode: "cave-270",
    label: "CAVE · Perimeter Carrier",
    shortLabel: "CAVE",
    topology: "square-perimeter",
    center: "nadir",
    fieldOfViewDegrees: null,
    coverageLabel: "4-wall + floor continuity carrier",
    innerSplit: { ...STANDARD_SPLIT, label: "Floor / wall seam" },
    hasCarrierHorizon: true,
    carrierHorizonWallFraction: 0.5,
    surface: { width: 4, depth: 4, radius: 0, height: 4, eyeHeight: 2, eyeX: 0, eyeZ: 0 },
  },
  "hall-double-gable": {
    mode: "hall-double-gable",
    label: "Hall · Planar Profile",
    shortLabel: "HALL P",
    topology: "gabled-shell",
    center: "zenith",
    fieldOfViewDegrees: null,
    coverageLabel: "4 walls + 2–7 planar roof faces · no floor",
    innerSplit: { default: 0.36, min: 0.18, max: 0.68, label: "Roof / wall seam" },
    hasCarrierHorizon: true,
    carrierHorizonWallFraction: 0.5,
  },
  "cylinder-nadir": {
    mode: "cylinder-nadir",
    label: "Cylinder · Nadir Cap",
    shortLabel: "CYL N",
    topology: "circular-cylinder",
    center: "nadir",
    fieldOfViewDegrees: null,
    coverageLabel: "360° cylinder + floor cap",
    innerSplit: { ...CYLINDER_CAP_SPLIT, label: "Floor cap / wall seam" },
    hasCarrierHorizon: true,
    carrierHorizonWallFraction: 0.5,
    surface: { width: 0, depth: 0, radius: 2, height: 4, eyeHeight: 2, eyeX: 0, eyeZ: 0 },
  },
  "cylinder-zenith": {
    mode: "cylinder-zenith",
    label: "Cylinder · Zenith Cap",
    shortLabel: "CYL Z",
    topology: "circular-cylinder",
    center: "zenith",
    fieldOfViewDegrees: null,
    coverageLabel: "360° cylinder + ceiling cap",
    innerSplit: { ...CYLINDER_CAP_SPLIT, label: "Ceiling cap / wall seam" },
    hasCarrierHorizon: true,
    carrierHorizonWallFraction: 0.5,
    surface: { width: 0, depth: 0, radius: 2, height: 4, eyeHeight: 2, eyeX: 0, eyeZ: 0 },
  },
  "cylinder-wall": {
    mode: "cylinder-wall",
    label: "Cylinder · Wall Unwrap",
    shortLabel: "CYL 360",
    topology: "unwrapped-cylinder",
    // The carrier traversal is floor-to-ceiling, matching the nadir radial
    // carrier's vertical sense for placement compensation.
    center: "nadir",
    fieldOfViewDegrees: null,
    coverageLabel: "360° unwrapped wall · identified seam",
    innerSplit: { ...CYLINDER_WALL_HORIZON, label: "Lower / upper wall allocation" },
    hasCarrierHorizon: false,
    carrierHorizonWallFraction: 0.5,
    surface: { width: 0, depth: 0, radius: 2, height: 4, eyeHeight: 2, eyeX: 0, eyeZ: 0 },
  },
};

export function projectionCarrierProfile(mode: SourceProjectionMode): ProjectionCarrierProfile {
  return PROJECTION_CARRIER_PROFILES[mode];
}

export function sourceProjectionIsCaveCarrier(mode: SourceProjectionMode): boolean {
  return projectionCarrierProfile(mode).topology === "square-perimeter";
}

export function sourceProjectionIsGabledShellCarrier(mode: SourceProjectionMode): boolean {
  return projectionCarrierProfile(mode).topology === "gabled-shell";
}

export function sourceProjectionIsCylinderCarrier(mode: SourceProjectionMode): boolean {
  const topology = projectionCarrierProfile(mode).topology;
  return topology === "circular-cylinder" || topology === "unwrapped-cylinder";
}

export function sourceProjectionIsRadialCylinderCarrier(mode: SourceProjectionMode): boolean {
  return projectionCarrierProfile(mode).topology === "circular-cylinder";
}

export function sourceProjectionIsUnwrappedCylinderCarrier(mode: SourceProjectionMode): boolean {
  return projectionCarrierProfile(mode).topology === "unwrapped-cylinder";
}

export function sourceProjectionIsSurfaceCarrier(mode: SourceProjectionMode): boolean {
  const topology = projectionCarrierProfile(mode).topology;
  return (
    topology === "square-perimeter" ||
    topology === "gabled-shell" ||
    topology === "circular-cylinder" ||
    topology === "unwrapped-cylinder"
  );
}

export function sourceProjectionUsesCircularDomain(mode: SourceProjectionMode): boolean {
  const topology = projectionCarrierProfile(mode).topology;
  return topology === "circular-fisheye" || topology === "circular-cylinder";
}

export function projectionCarrierRenderTarget(mode: SourceProjectionMode): ProjectionCarrierRenderTarget {
  const topology = projectionCarrierProfile(mode).topology;
  if (topology === "square-perimeter" || topology === "gabled-shell") return "cave-carrier";
  if (topology === "circular-cylinder" || topology === "unwrapped-cylinder") return "cylinder-carrier";
  return "source-map";
}
