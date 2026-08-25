import type { WorkbenchState } from "./workbench-defaults.js";
import { parseDomeScene, type DomeScene } from "../scene/dome-scene.js";
import type { PlateIntegrationMode } from "../inpaint/inpaint-prompts.js";

export function updateWorkbenchDomeScene(
  state: WorkbenchState,
  scene: DomeScene,
  { assumeChanged = false }: { assumeChanged?: boolean } = {},
): boolean {
  const normalized = parseDomeScene(scene);
  if (!assumeChanged && JSON.stringify(state.project.scene) === JSON.stringify(normalized)) return false;
  state.project.scene = normalized;
  return true;
}

export function updateWorkbenchRepairDirection(state: WorkbenchState, value: string): void {
  if (state.project.generation.direction === value) return;
  state.project.generation.direction = value;
}

export function updateWorkbenchRepairMode(state: WorkbenchState, value: PlateIntegrationMode): void {
  if (state.project.generation.mode === value) return;
  state.project.generation.mode = value;
}
