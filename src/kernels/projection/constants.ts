import type { SourceProjectionMode } from "../../lib/shared/contracts/projection-profile.js";

export const KERNEL_EPSILON = 0.000001;
/** Maximum expected component drift from canonical WebGPU f32 execution. */
export const PROJECTION_F32_COMPONENT_TOLERANCE = 0.00002;
/** Angular comparison tolerance in radians for normalized f32 vectors. */
export const PROJECTION_F32_ANGULAR_TOLERANCE = 0.001;

export const ProjectionModeCode = {
  Zenith180: 0,
  Zenith230: 1,
  Nadir180: 2,
  Cave270: 3,
  CylinderNadir: 4,
  CylinderZenith: 5,
  CylinderWall: 6,
  HallDoubleGable: 7,
} as const;

export type ProjectionModeCode = (typeof ProjectionModeCode)[keyof typeof ProjectionModeCode];

export const ProjectionTopologyCode = {
  Fisheye: 0,
  CavePerimeter: 1,
  CylinderRadial: 2,
  CylinderWall: 3,
  GabledShell: 4,
} as const;

export type ProjectionTopologyCode = (typeof ProjectionTopologyCode)[keyof typeof ProjectionTopologyCode];

export const ProjectionCenterCode = {
  Zenith: 0,
  Nadir: 1,
} as const;

export type ProjectionCenterCode = (typeof ProjectionCenterCode)[keyof typeof ProjectionCenterCode];

export const ProjectionDomainCode = {
  Circular: 0,
  Square: 1,
  Rectangular: 2,
} as const;

export type ProjectionDomainCode = (typeof ProjectionDomainCode)[keyof typeof ProjectionDomainCode];

export const ProjectionSurfaceCode = {
  Invalid: 0,
  Angular: 1,
  CaveFloor: 2,
  CaveFront: 3,
  CaveRight: 4,
  CaveBack: 5,
  CaveLeft: 6,
  CylinderCap: 7,
  CylinderWall: 8,
  GabledRoof: 9,
} as const;

export type ProjectionSurfaceCode = (typeof ProjectionSurfaceCode)[keyof typeof ProjectionSurfaceCode];

export const ProjectionKernelFlag = {
  RadialRemap: 1 << 0,
  SurfaceCarrier: 1 << 1,
  CircularDomain: 1 << 2,
  HorizontalWrap: 1 << 3,
} as const;

const MODE_CODES: Readonly<Record<SourceProjectionMode, ProjectionModeCode>> = {
  "zenith-180": ProjectionModeCode.Zenith180,
  "zenith-230": ProjectionModeCode.Zenith230,
  "nadir-180": ProjectionModeCode.Nadir180,
  "cave-270": ProjectionModeCode.Cave270,
  "hall-double-gable": ProjectionModeCode.HallDoubleGable,
  "cylinder-nadir": ProjectionModeCode.CylinderNadir,
  "cylinder-zenith": ProjectionModeCode.CylinderZenith,
  "cylinder-wall": ProjectionModeCode.CylinderWall,
};

export function projectionModeCode(mode: SourceProjectionMode): ProjectionModeCode {
  return MODE_CODES[mode];
}

export function projectionModeFromCode(code: number): SourceProjectionMode | null {
  if (code === ProjectionModeCode.Zenith180) return "zenith-180";
  if (code === ProjectionModeCode.Zenith230) return "zenith-230";
  if (code === ProjectionModeCode.Nadir180) return "nadir-180";
  if (code === ProjectionModeCode.Cave270) return "cave-270";
  if (code === ProjectionModeCode.HallDoubleGable) return "hall-double-gable";
  if (code === ProjectionModeCode.CylinderNadir) return "cylinder-nadir";
  if (code === ProjectionModeCode.CylinderZenith) return "cylinder-zenith";
  if (code === ProjectionModeCode.CylinderWall) return "cylinder-wall";
  return null;
}
