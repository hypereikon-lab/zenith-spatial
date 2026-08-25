import {
  addArtifactResultToState,
  artifactInputsReadyInState,
  artifactIsReadyInState,
  getArtifactRecord,
  replaceArtifactMediaInState,
  replaceArtifactRecords,
  selectArtifactResultInState,
  setArtifactProjectionProfilesInState,
  updateArtifactRecord,
} from "./artifact-graph-store.js";
import type {
  ArtifactMedia,
  ArtifactMediaHandle,
  ArtifactRecord,
  ArtifactResult,
  ArtifactSlotId,
  JobState,
} from "./artifact-types.js";
import {
  clearMediaPreviewInState,
  finishWorkbenchJob,
  recordWorkbenchErrorInState,
  replaceMediaPreviewInState,
  setDropActiveInState,
  setMediaPreviewInState,
  startWorkbenchJob,
  syncWorkbenchServerJob,
  toggleWorkbenchJobDetails,
  updateWorkbenchJob,
} from "./workbench-session-store.js";
import {
  updateWorkbenchDomeScene,
  updateWorkbenchRepairDirection,
  updateWorkbenchRepairMode,
} from "./workbench-drafts.js";
import { ARTIFACT_PHASES } from "./workbench-defaults.js";
import {
  DOME_SCENE_EDITOR_MODES,
  domeSceneEditorModeForId,
  domeSceneEditorModeIdForArtifact,
  type DomeSceneEditorModeId,
} from "../lib/shared/contracts/dome-scene-editor.js";
import { PROJECT_ARTIFACT_SLOT_IDS } from "../lib/shared/contracts/artifact-topology.js";
import type { SourceProjectionMode } from "../geometry/source-projection.js";
import type { JobV1 } from "../lib/shared/contracts/jobs.js";
import type { DomeScene } from "../scene/dome-scene.js";
import { activeWorkbenchRuntime } from "./workbench-runtime.svelte.js";
import type { PlateIntegrationMode } from "../inpaint/inpaint-prompts.js";

export { DOME_SCENE_EDITOR_MODES, ARTIFACT_PHASES, activeWorkbenchRuntime };
export const workbench = activeWorkbenchRuntime.state;

const selectedModeValue = $derived.by(() => domeSceneEditorModeForId(workbench.project.workspace.modeId));
const selectedArtifactValue = $derived.by(() => getArtifact(workbench.project.workspace.selectedArtifactId));
const artifactListValue = $derived.by(() => PROJECT_ARTIFACT_SLOT_IDS.map((id) => workbench.project.artifacts[id]));

export function getSelectedMode() {
  return selectedModeValue;
}

export function getSelectedArtifact() {
  return selectedArtifactValue;
}

export function getArtifactList() {
  return artifactListValue;
}

export function selectSceneMode(modeId: DomeSceneEditorModeId): void {
  const mode = domeSceneEditorModeForId(modeId);
  workbench.project.workspace.modeId = mode.id;
  if (!mode.artifactIds.includes(workbench.project.workspace.selectedArtifactId)) {
    workbench.project.workspace.selectedArtifactId = mode.primaryArtifactId;
  }
}

export function selectArtifact(artifactId: ArtifactSlotId): void {
  workbench.project.workspace.selectedArtifactId = getArtifact(artifactId).id;
  workbench.project.workspace.modeId = domeSceneEditorModeIdForArtifact(artifactId);
}

export function setMediaPreviewOpen(open: boolean): void {
  workbench.project.workspace.mediaPreview.open = open;
}

export function getArtifact(artifactId: ArtifactSlotId): ArtifactRecord {
  return getArtifactRecord(workbench, artifactId);
}

export function artifactIsReady(artifactId: ArtifactSlotId): boolean {
  return artifactIsReadyInState(workbench, artifactId);
}

export function artifactInputsReady(artifact: Pick<ArtifactRecord, "inputs">): boolean {
  return artifactInputsReadyInState(workbench, artifact);
}

export function updateArtifact(artifactId: ArtifactSlotId, patch: Partial<Omit<ArtifactRecord, "id" | "type">>): void {
  updateArtifactRecord(workbench, artifactId, patch);
  activeWorkbenchRuntime.touch();
}

export function replaceArtifacts(artifacts: Record<ArtifactSlotId, ArtifactRecord>): void {
  replaceArtifactRecords(workbench, artifacts);
  activeWorkbenchRuntime.touch();
}

export function addArtifactResult(artifactId: ArtifactSlotId, result: Omit<ArtifactResult, "id" | "createdAt">): void {
  addArtifactResultToState(workbench, artifactId, result);
  activeWorkbenchRuntime.touch();
}

export function replaceArtifactMedia(
  artifactId: ArtifactSlotId,
  payload: {
    patch: Partial<Omit<ArtifactRecord, "id" | "type">> & Pick<ArtifactRecord, "media">;
    handle?: ArtifactMediaHandle;
    result?: Omit<ArtifactResult, "id" | "createdAt">;
  },
): void {
  replaceArtifactMediaInState(workbench, artifactId, payload);
  activeWorkbenchRuntime.touch();
}

export function selectArtifactResult(artifactId: ArtifactSlotId, resultId: string): void {
  selectArtifactResultInState(workbench, artifactId, resultId);
  activeWorkbenchRuntime.touch();
}

export function setArtifactProjectionProfiles(profile: SourceProjectionMode): void {
  setArtifactProjectionProfilesInState(workbench, profile);
  activeWorkbenchRuntime.touch({ render: true });
}

export function startJob(operatorId: JobState["operatorId"], label: string, stage = "Starting"): void {
  startWorkbenchJob(workbench, operatorId, label, stage);
}

export function updateJob(operatorId: JobState["operatorId"], stage: string, progress: number | null = null): void {
  updateWorkbenchJob(workbench, operatorId, stage, progress);
}

export function finishJob(operatorId: JobState["operatorId"], stage = "Done"): void {
  finishWorkbenchJob(workbench, operatorId, stage);
}

export function syncServerJob(job: JobV1): void {
  syncWorkbenchServerJob(workbench, job);
}

export function toggleJobDetails(jobId: string): void {
  toggleWorkbenchJobDetails(workbench, jobId);
}

export function recordWorkbenchError(message: string, scope?: string): void {
  recordWorkbenchErrorInState(workbench, message, scope);
}

export function setMediaPreview(media: ArtifactMedia, summary: string): void {
  setMediaPreviewInState(workbench, media, summary);
}

export function replaceMediaPreview(media: ArtifactMedia, summary: string, handle: ArtifactMediaHandle): void {
  replaceMediaPreviewInState(workbench, media, summary, handle);
}

export function clearMediaPreview(): void {
  clearMediaPreviewInState(workbench);
}

export function setDropActive(active: boolean, depth = 0): void {
  setDropActiveInState(workbench, active, depth);
}

export function updateDomeScene(scene: DomeScene, options: { assumeChanged?: boolean } = {}): void {
  if (updateWorkbenchDomeScene(workbench, scene, options)) activeWorkbenchRuntime.touch({ render: true });
}

export function updateRepairDirection(value: string): void {
  updateWorkbenchRepairDirection(workbench, value);
  activeWorkbenchRuntime.touch();
}

export function updateRepairMode(value: PlateIntegrationMode): void {
  updateWorkbenchRepairMode(workbench, value);
  activeWorkbenchRuntime.touch();
}
