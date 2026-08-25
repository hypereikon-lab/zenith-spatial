import { DOME_SCENE_EDITOR_MODES, type DomeSceneEditorModeId } from "../lib/shared/contracts/dome-scene-editor.js";
import type { ArtifactSlotId, ArtifactStatus } from "../artifacts/artifact-types.js";
import { getArtifactList, getSelectedMode, selectArtifact, selectSceneMode, workbench } from "../artifacts/artifact-store.svelte.js";

export function domeSceneModeNavView() {
  const activeMode = getSelectedMode();
  const artifacts = getArtifactList();
  return {
    modeLabel: activeMode.label,
    modes: DOME_SCENE_EDITOR_MODES.map((mode) => {
      const modeArtifacts = artifacts.filter((artifact) => mode.artifactIds.includes(artifact.id));
      const ready = modeArtifacts.filter((artifact) => artifactIsReadyForNav(artifact.status)).length;
      const completed = mode.id === "compose"
        ? workbench.project.sequence.compositions.filter((item) => Boolean(item.plateSketchRevisionId)).length
        : workbench.project.sequence.compositions.filter((item) => Boolean(item.imageRevisionId)).length;
      return {
        id: mode.id,
        number: mode.number,
        label: mode.shortLabel,
        technicalLabel: mode.label,
        roleLabel: mode.id === "compose" ? "Plate map" : mode.id === "inpaint" ? "Image model" : "Spatial view",
        active: mode.id === activeMode.id,
        readySummary: mode.id === "project"
          ? (ready + "/" + modeArtifacts.length)
          : (completed + "/" + workbench.project.sequence.compositions.length),
      };
    }),
    activeArtifacts: artifacts
      .filter((artifact) => activeMode.artifactIds.includes(artifact.id))
      .map((artifact) => {
        const status = artifact.stale ? "stale" : artifact.status;
        return {
          id: artifact.id,
          label: artifact.label,
          status,
          statusLabel: status,
          selected: artifact.id === workbench.project.workspace.selectedArtifactId,
          ariaLabel: "Select " + artifact.label + ". Status " + status + ".",
        };
      }),
  };
}

export function openDomeSceneMode(modeId: DomeSceneEditorModeId): void {
  selectSceneMode(modeId);
}

export function selectDomeSceneArtifact(artifactId: ArtifactSlotId): void {
  selectArtifact(artifactId);
}

function artifactIsReadyForNav(status: ArtifactStatus): boolean {
  return status === "ready" || status === "done" || status === "warning";
}
