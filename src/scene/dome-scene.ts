import {
  cloneDefaultDomeScene,
  parseDomeScene,
  type DomeScene,
  type DomeSceneFrame0,
  type DomeScenePlateLayer,
} from "../lib/shared/contracts/dome-scene.js";
import { normalizeProjectionSurfaceForMode } from "../lib/shared/contracts/projection-authoring.js";

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
