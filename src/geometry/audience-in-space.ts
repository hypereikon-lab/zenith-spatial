import { eulerDegreesFromQuaternion, quaternionFromEulerDegrees } from "./camera-rig.js";
import type { SourceProjectionMode } from "./source-projection.js";
import {
  normalizeProjectionSurfaceForMode,
  planarRoofProfile,
  type ProjectionSurface,
} from "../lib/shared/contracts/projection-authoring.js";
import { clamp, wrapDegrees, type Vec3 } from "../projection.js";
import type { AudienceInSpace } from "../domain/schema.js";
import type { PlateEditorCamera } from "../plates/plate-editor-view.js";

export type AudienceVenuePlan = {
  readonly shape: "rectangle" | "circle";
  readonly label: string;
  readonly widthMeters: number;
  readonly depthMeters: number;
  readonly heightMeters: number;
  readonly projectionObserver: {
    readonly xMeters: number;
    readonly zMeters: number;
    readonly eyeHeightMeters: number;
  };
};

const WALL_CLEARANCE_METERS = 0.2;

export function audienceVenuePlan(
  audience: AudienceInSpace,
  mode: SourceProjectionMode,
  surface?: ProjectionSurface | null,
): AudienceVenuePlan {
  const normalized = normalizeProjectionSurfaceForMode(surface, mode);
  if (normalized.kind === "box-room") {
    return {
      shape: "rectangle",
      label: "Measured room",
      widthMeters: normalized.width,
      depthMeters: normalized.depth,
      heightMeters: normalized.height,
      projectionObserver: {
        xMeters: normalized.eyeX,
        zMeters: normalized.eyeZ,
        eyeHeightMeters: normalized.eyeHeight,
      },
    };
  }
  if (normalized.kind === "double-gable-room") {
    return {
      shape: "rectangle",
      label: "Profiled hall",
      widthMeters: normalized.length,
      depthMeters: normalized.width,
      heightMeters: Math.max(...planarRoofProfile(normalized).map((anchor) => anchor.height)),
      projectionObserver: {
        xMeters: normalized.eyeX,
        zMeters: normalized.eyeZ,
        eyeHeightMeters: normalized.eyeHeight,
      },
    };
  }
  if (normalized.kind === "cylinder") {
    return {
      shape: "circle",
      label: "Measured cylinder",
      widthMeters: normalized.radius * 2,
      depthMeters: normalized.radius * 2,
      heightMeters: normalized.height,
      projectionObserver: { xMeters: 0, zMeters: 0, eyeHeightMeters: normalized.eyeHeight },
    };
  }
  const diameter = audience.domeRadiusMeters * 2;
  return {
    shape: "circle",
    label: "Physical dome",
    widthMeters: diameter,
    depthMeters: diameter,
    heightMeters: audience.domeRadiusMeters,
    projectionObserver: { xMeters: 0, zMeters: 0, eyeHeightMeters: 0 },
  };
}

export function normalizeAudienceInSpace(
  audience: AudienceInSpace,
  mode: SourceProjectionMode,
  surface?: ProjectionSurface | null,
): AudienceInSpace {
  const domeRadiusMeters = clamp(finiteOr(audience.domeRadiusMeters, 7.5), 2, 100);
  const withRadius = { ...audience, domeRadiusMeters };
  const plan = audienceVenuePlan(withRadius, mode, surface);
  const minimumEyeHeight = 0.5;
  let maximumEyeHeight = Math.max(minimumEyeHeight, plan.heightMeters - WALL_CLEARANCE_METERS);
  let eyeHeightMeters = clamp(finiteOr(audience.eyeHeightMeters, 1.65), minimumEyeHeight, maximumEyeHeight);
  const horizontalLimit = Math.max(0, plan.widthMeters * 0.5 - WALL_CLEARANCE_METERS);
  const depthLimit = Math.max(0, plan.depthMeters * 0.5 - WALL_CLEARANCE_METERS);
  let xMeters = clamp(finiteOr(audience.xMeters, 0), -horizontalLimit, horizontalLimit);
  let zMeters = clamp(finiteOr(audience.zMeters, 0), -depthLimit, depthLimit);

  if (plan.shape === "circle") {
    const normalizedSurface = normalizeProjectionSurfaceForMode(surface, mode);
    const shellRadius = plan.widthMeters * 0.5;
    const verticalClearance = Math.max(0, shellRadius * shellRadius - eyeHeightMeters * eyeHeightMeters);
    const maximumRadius = Math.max(
      0,
      (normalizedSurface.kind === "angular" ? Math.sqrt(verticalClearance) : shellRadius) - WALL_CLEARANCE_METERS,
    );
    const radial = Math.hypot(xMeters, zMeters);
    if (radial > maximumRadius && radial > 0.000001) {
      xMeters = (xMeters / radial) * maximumRadius;
      zMeters = (zMeters / radial) * maximumRadius;
    }
  }

  const normalizedSurface = normalizeProjectionSurfaceForMode(surface, mode);
  if (normalizedSurface.kind === "double-gable-room") {
    maximumEyeHeight = Math.max(
      minimumEyeHeight,
      planarRoofHeightAtZ(normalizedSurface, zMeters) - WALL_CLEARANCE_METERS,
    );
    eyeHeightMeters = clamp(eyeHeightMeters, minimumEyeHeight, maximumEyeHeight);
  }

  return {
    xMeters,
    zMeters,
    eyeHeightMeters,
    yawDegrees: wrapDegrees(finiteOr(audience.yawDegrees, 0)),
    pitchDegrees: clamp(finiteOr(audience.pitchDegrees, 0), -85, 85),
    fovDegrees: clamp(finiteOr(audience.fovDegrees, 82), 30, 130),
    domeRadiusMeters,
  };
}

export function audienceCameraForProjection(
  audience: AudienceInSpace,
  mode: SourceProjectionMode,
  surface?: ProjectionSurface | null,
): PlateEditorCamera {
  const normalizedAudience = normalizeAudienceInSpace(audience, mode, surface);
  const normalizedSurface = normalizeProjectionSurfaceForMode(surface, mode);
  const observer = audienceVenuePlan(normalizedAudience, mode, normalizedSurface).projectionObserver;
  const physicalPosition: Vec3 = [
    normalizedAudience.xMeters - observer.xMeters,
    normalizedAudience.eyeHeightMeters - observer.eyeHeightMeters,
    normalizedAudience.zMeters - observer.zMeters,
  ];
  const angularScale = normalizedSurface.kind === "angular" ? 1 / normalizedAudience.domeRadiusMeters : 1;
  const position: Vec3 = [
    physicalPosition[0] * angularScale,
    physicalPosition[1] * angularScale,
    physicalPosition[2] * angularScale,
  ];
  const plan = audienceVenuePlan(normalizedAudience, mode, normalizedSurface);
  const farMeters =
    normalizedSurface.kind === "angular"
      ? 4
      : Math.max(20, Math.hypot(plan.widthMeters, plan.depthMeters, plan.heightMeters) * 2);
  return {
    position,
    orientation: quaternionFromEulerDegrees(normalizedAudience.yawDegrees, normalizedAudience.pitchDegrees, 0),
    pivot: null,
    fovDegrees: normalizedAudience.fovDegrees,
    nearMeters: normalizedSurface.kind === "angular" ? 0.001 : 0.02,
    farMeters,
    mode: "inside",
  };
}

export function audienceFromProjectionCamera(
  camera: PlateEditorCamera,
  audience: AudienceInSpace,
  mode: SourceProjectionMode,
  surface?: ProjectionSurface | null,
): AudienceInSpace {
  const normalizedSurface = normalizeProjectionSurfaceForMode(surface, mode);
  const observer = audienceVenuePlan(audience, mode, normalizedSurface).projectionObserver;
  const angularScale = normalizedSurface.kind === "angular" ? audience.domeRadiusMeters : 1;
  const euler = eulerDegreesFromQuaternion(camera.orientation);
  return normalizeAudienceInSpace(
    {
      ...audience,
      xMeters: camera.position[0] * angularScale + observer.xMeters,
      eyeHeightMeters: camera.position[1] * angularScale + observer.eyeHeightMeters,
      zMeters: camera.position[2] * angularScale + observer.zMeters,
      yawDegrees: euler.yawDegrees,
      pitchDegrees: euler.pitchDegrees,
      fovDegrees: camera.fovDegrees,
    },
    mode,
    normalizedSurface,
  );
}

export function walkAudienceInSpace(
  audience: AudienceInSpace,
  distanceMeters: number,
  mode: SourceProjectionMode,
  surface?: ProjectionSurface | null,
): AudienceInSpace {
  const yawRadians = (audience.yawDegrees * Math.PI) / 180;
  return normalizeAudienceInSpace(
    {
      ...audience,
      xMeters: audience.xMeters + Math.sin(yawRadians) * distanceMeters,
      zMeters: audience.zMeters + Math.cos(yawRadians) * distanceMeters,
    },
    mode,
    surface,
  );
}

function finiteOr(value: number, fallback: number): number {
  return Number.isFinite(value) ? value : fallback;
}

function planarRoofHeightAtZ(
  surface: Extract<ProjectionSurface, { kind: "double-gable-room" }>,
  zMeters: number,
): number {
  const profile = planarRoofProfile(surface);
  const position = clamp(zMeters / surface.width + 0.5, 0, 1);
  for (let index = 0; index < profile.length - 1; index += 1) {
    const start = profile[index]!;
    const end = profile[index + 1]!;
    if (position > end.position) continue;
    const amount = (position - start.position) / Math.max(end.position - start.position, 0.000001);
    return start.height + (end.height - start.height) * amount;
  }
  return profile.at(-1)!.height;
}
