import { updateDomeScene, workbench } from "../artifacts/artifact-store.svelte.js";
import { domeSceneWithFrame0FromPlateSketchInput, type DomeScene } from "../scene/dome-scene.js";
import { syncDomeScenePlateRuntimeFromPreviewInput } from "../scene/dome-scene-runtime.js";
import type { PlateSketchPreviewInput } from "../plates/plate-sketch-preview-session.js";

export function applyPlateSketchFrame0ToDomeScene(
  input: PlateSketchPreviewInput,
  { activeIndex = 0 }: { activeIndex?: number } = {},
): DomeScene | null {
  if (input.plates.length === 0 || input.placements.length < input.plates.length) return null;
  const nextScene = domeSceneWithFrame0FromPlateSketchInput(workbench.project.scene, input, { activeIndex });
  syncDomeScenePlateRuntimeFromPreviewInput(nextScene, input);
  updateDomeScene(nextScene);
  return nextScene;
}
